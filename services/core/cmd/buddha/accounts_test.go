package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vasinl124/buddha-gpt/services/core/internal/store"
)

func TestPasswordHash(t *testing.T) {
	h, err := hashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !checkPassword(h, "correct horse") || checkPassword(h, "correct horsf") {
		t.Fatal("a hash should match its own password and no other")
	}
	if again, _ := hashPassword("correct horse"); again == h {
		t.Fatal("two hashes of one password should differ by their salt")
	}
	if checkPassword("pbkdf2-sha256$1$bad", "x") || checkPassword("", "") {
		t.Fatal("a malformed hash should match nothing")
	}
}

// fakeAccounts keeps users, sessions and conversations in maps.
type fakeAccounts struct {
	users    map[string]fakeUser // by username
	sessions map[string]int64    // user id by token hash
	chats    map[int64]map[string]store.SavedChat
}

type fakeUser struct {
	id   int64
	hash string
}

func (f *fakeAccounts) CreateUser(_ context.Context, name, hash string) (int64, error) {
	if _, ok := f.users[name]; ok {
		return 0, store.ErrTaken
	}
	id := int64(len(f.users) + 1)
	f.users[name] = fakeUser{id, hash}
	return id, nil
}
func (f *fakeAccounts) User(_ context.Context, name string) (int64, string, error) {
	u, ok := f.users[name]
	if !ok {
		return 0, "", store.ErrNotFound
	}
	return u.id, u.hash, nil
}
func (f *fakeAccounts) CreateSession(_ context.Context, user int64, hash []byte, _ time.Time) error {
	f.sessions[string(hash)] = user
	return nil
}
func (f *fakeAccounts) SessionUser(_ context.Context, hash []byte) (int64, string, error) {
	if id, ok := f.sessions[string(hash)]; ok {
		for name, u := range f.users {
			if u.id == id {
				return id, name, nil
			}
		}
	}
	return 0, "", store.ErrNotFound
}
func (f *fakeAccounts) DeleteSession(_ context.Context, hash []byte) error {
	delete(f.sessions, string(hash))
	return nil
}
func (f *fakeAccounts) Chats(_ context.Context, user int64) ([]store.ChatSummary, error) {
	out := []store.ChatSummary{}
	for _, c := range f.chats[user] {
		out = append(out, c.ChatSummary)
	}
	return out, nil
}
func (f *fakeAccounts) Chat(_ context.Context, user int64, id string) (store.SavedChat, error) {
	c, ok := f.chats[user][id]
	if !ok {
		return c, store.ErrNotFound
	}
	return c, nil
}
func (f *fakeAccounts) PutChat(_ context.Context, user int64, c store.SavedChat) error {
	if f.chats[user] == nil {
		f.chats[user] = map[string]store.SavedChat{}
	}
	f.chats[user][c.ID] = c
	return nil
}
func (f *fakeAccounts) DeleteChat(_ context.Context, user int64, id string) error {
	delete(f.chats[user], id)
	return nil
}

func TestAccountRoutes(t *testing.T) {
	mux := http.NewServeMux()
	accountRoutes(mux, &fakeAccounts{map[string]fakeUser{}, map[string]int64{}, map[int64]map[string]store.SavedChat{}})
	do := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}
	expect := func(rec *httptest.ResponseRecorder, code int, what string) {
		t.Helper()
		if rec.Code != code {
			t.Fatalf("%s: got %d %s, want %d", what, rec.Code, rec.Body, code)
		}
	}
	signUp := func(name string) string {
		rec := do("POST", "/v1/users", "", `{"username":"`+name+`","password":"long enough"}`)
		expect(rec, http.StatusCreated, "sign up "+name)
		var got struct {
			User  struct{ Username string }
			Token string
		}
		json.Unmarshal(rec.Body.Bytes(), &got)
		if got.User.Username != strings.ToLower(strings.TrimSpace(name)) || got.Token == "" {
			t.Fatalf("sign up %s: got %s", name, rec.Body)
		}
		return got.Token
	}

	expect(do("POST", "/v1/users", "", `{"username":"a!","password":"long enough"}`), http.StatusBadRequest, "a bad username")
	expect(do("POST", "/v1/users", "", `{"username":"max","password":"short"}`), http.StatusBadRequest, "a short password")
	token := signUp(" Max ")
	expect(do("POST", "/v1/users", "", `{"username":"max","password":"another one"}`), http.StatusConflict, "a taken username")

	// a wrong password and an unknown name get the same answer
	expect(do("POST", "/v1/sessions", "", `{"username":"max","password":"wrong one!"}`), http.StatusUnauthorized, "a wrong password")
	expect(do("POST", "/v1/sessions", "", `{"username":"nobody","password":"long enough"}`), http.StatusUnauthorized, "an unknown name")
	expect(do("POST", "/v1/sessions", "", `{"username":"MAX","password":"long enough"}`), http.StatusOK, "the right password")

	expect(do("GET", "/v1/chats", "", ""), http.StatusUnauthorized, "chats without a session")
	expect(do("PUT", "/v1/chats/c1", token, `{"title":"Hi","messages":{}}`), http.StatusBadRequest, "messages that aren't a list")
	expect(do("PUT", "/v1/chats/a.b", token, `{"title":"Hi","messages":[]}`), http.StatusBadRequest, "a bad conversation id")
	expect(do("PUT", "/v1/chats/c1", token, `{"title":" Hi ","updated":5,"messages":[{"id":"u1"}]}`), http.StatusNoContent, "save")

	rec := do("GET", "/v1/chats/c1", token, "")
	expect(rec, http.StatusOK, "open")
	var got struct{ Chat store.SavedChat }
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Chat.Title != "Hi" || got.Chat.Updated != 5 || string(got.Chat.Messages) != `[{"id":"u1"}]` {
		t.Fatalf("open: got %s", rec.Body)
	}
	if rec := do("GET", "/v1/chats", token, ""); !strings.Contains(rec.Body.String(), `"id":"c1"`) {
		t.Fatalf("list: got %s", rec.Body)
	}
	expect(do("GET", "/v1/chats/c1", signUp("ana"), ""), http.StatusNotFound, "someone else's conversation")

	expect(do("DELETE", "/v1/chats/c1", token, ""), http.StatusNoContent, "delete")
	expect(do("GET", "/v1/chats/c1", token, ""), http.StatusNotFound, "a deleted conversation")
	expect(do("DELETE", "/v1/sessions", token, ""), http.StatusNoContent, "sign out")
	expect(do("GET", "/v1/me", token, ""), http.StatusUnauthorized, "a session after sign-out")
}
