package main

// The account routes: sign up, sign in and out, and the conversations an account keeps (PRD §8.6).
// The agent is the only caller. It keeps the session token in an HttpOnly cookie and sends it here
// as a bearer token.

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/vasinl124/buddha-gpt/services/core/internal/store"
)

// accounts is what the account routes need: the store implements it, the tests fake it.
type accounts interface {
	CreateUser(ctx context.Context, username, hash string) (int64, error)
	User(ctx context.Context, username string) (id int64, hash string, err error)
	CreateSession(ctx context.Context, userID int64, tokenHash []byte, expires time.Time) error
	SessionUser(ctx context.Context, tokenHash []byte) (id int64, username string, err error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	Chats(ctx context.Context, userID int64) ([]store.ChatSummary, error)
	Chat(ctx context.Context, userID int64, id string) (store.SavedChat, error)
	PutChat(ctx context.Context, userID int64, c store.SavedChat) error
	DeleteChat(ctx context.Context, userID int64, id string) error
}

const (
	rounds      = 600_000 // PBKDF2-HMAC-SHA256 from the standard library, at OWASP's floor; argon2id would need x/crypto
	sessionLife = 30 * 24 * time.Hour
	maxChat     = 2 << 20 // one conversation's JSON, cards and all
	maxGuesses  = 10      // wrong passwords for one username in guessWindow, from anywhere
	guessWindow = 15 * time.Minute
)

var (
	usernameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)
	chatIDRE   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	b64        = base64.RawStdEncoding
	// checked when a username doesn't exist, so a wrong name takes as long as a wrong password
	decoy = sync.OnceValue(func() string { h, _ := hashPassword("not anyone's password"); return h })
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	rand.Read(salt)
	key, err := pbkdf2.Key(sha256.New, password, salt, rounds, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", rounds, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// checkPassword reports, in constant time, whether password is the one hashPassword hashed. The
// rounds are read from the hash, so raising them later leaves old passwords working.
func checkPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	n, err1 := strconv.Atoi(parts[1])
	salt, err2 := b64.DecodeString(parts[2])
	want, err3 := b64.DecodeString(parts[3])
	if errors.Join(err1, err2, err3) != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, n, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// guesses counts wrong passwords per username, so no one account can be guessed at quickly, from
// however many addresses. The agent limits each address as well.
// ponytail: in this process's memory; a table if the core runs as several instances
type guesses struct {
	mu sync.Mutex
	at map[string][]time.Time
}

// recent returns name's wrong passwords inside the window; the caller holds mu.
func (g *guesses) recent(name string) []time.Time {
	var in []time.Time
	for _, t := range g.at[name] {
		if time.Since(t) < guessWindow {
			in = append(in, t)
		}
	}
	return in
}

func (g *guesses) blocked(name string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.recent(name)) >= maxGuesses
}

func (g *guesses) wrong(name string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.at) > 10_000 { // forget the names whose window has passed
		for k := range g.at {
			if len(g.recent(k)) == 0 {
				delete(g.at, k)
			}
		}
	}
	g.at[name] = append(g.recent(name), time.Now())
}

func (g *guesses) right(name string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.at, name)
}

func tokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func accountRoutes(mux *http.ServeMux, a accounts) {
	tries := &guesses{at: map[string][]time.Time{}}
	fail := func(w http.ResponseWriter, what string) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": what + " failed"})
	}
	// starts a session and answers {user, token, expires}
	signIn := func(w http.ResponseWriter, r *http.Request, code int, id int64, username string) {
		raw := make([]byte, 32)
		rand.Read(raw)
		token := base64.RawURLEncoding.EncodeToString(raw)
		expires := time.Now().Add(sessionLife)
		if err := a.CreateSession(r.Context(), id, tokenHash(token), expires); err != nil {
			fail(w, "sign-in")
			return
		}
		writeJSON(w, code, map[string]any{"user": map[string]string{"username": username}, "token": token, "expires": expires.UnixMilli()})
	}
	// the signed-in user, from the bearer token; otherwise it answers 401 itself
	session := func(w http.ResponseWriter, r *http.Request) (int64, string, bool) {
		if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && token != "" {
			id, name, err := a.SessionUser(r.Context(), tokenHash(token))
			if err == nil {
				return id, name, true
			}
			if !errors.Is(err, store.ErrNotFound) {
				fail(w, "session")
				return 0, "", false
			}
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in first."})
		return 0, "", false
	}
	// the signed-in user and the conversation's id from the path; otherwise it answers 401 or 400 itself
	conversation := func(w http.ResponseWriter, r *http.Request) (int64, string, bool) {
		user, _, ok := session(w, r)
		if !ok {
			return 0, "", false
		}
		id := r.PathValue("id")
		if !chatIDRE.MatchString(id) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a conversation id is 1 to 64 of A-Z a-z 0-9 _ -"})
			return 0, "", false
		}
		return user, id, true
	}

	mux.HandleFunc("POST /v1/users", func(w http.ResponseWriter, r *http.Request) {
		c, ok := readCredentials(w, r)
		if !ok {
			return
		}
		switch n := utf8.RuneCountInString(c.Password); {
		case !usernameRE.MatchString(c.Username):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A username is 3 to 32 letters, digits, dots, dashes or underscores."})
			return
		case n < 8 || len(c.Password) > 1024:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A password is at least 8 characters."})
			return
		}
		hash, err := hashPassword(c.Password)
		if err != nil {
			fail(w, "sign-up")
			return
		}
		id, err := a.CreateUser(r.Context(), c.Username, hash)
		switch {
		case errors.Is(err, store.ErrTaken):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "That username is taken."})
		case err != nil:
			fail(w, "sign-up")
		default:
			signIn(w, r, http.StatusCreated, id, c.Username)
		}
	})

	mux.HandleFunc("POST /v1/sessions", func(w http.ResponseWriter, r *http.Request) {
		c, ok := readCredentials(w, r)
		if !ok {
			return
		}
		if tries.blocked(c.Username) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many wrong passwords for this username. Wait a few minutes."})
			return
		}
		id, hash, err := a.User(r.Context(), c.Username)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			fail(w, "sign-in")
			return
		}
		if err != nil {
			hash = decoy()
		}
		if match := checkPassword(hash, c.Password); !match || err != nil {
			tries.wrong(c.Username)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "That username and password don't match."})
			return
		}
		tries.right(c.Username)
		signIn(w, r, http.StatusOK, id, c.Username)
	})

	mux.HandleFunc("DELETE /v1/sessions", func(w http.ResponseWriter, r *http.Request) {
		token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if err := a.DeleteSession(r.Context(), tokenHash(token)); err != nil {
			fail(w, "sign-out")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /v1/me", func(w http.ResponseWriter, r *http.Request) {
		if _, name, ok := session(w, r); ok {
			writeJSON(w, http.StatusOK, map[string]any{"user": map[string]string{"username": name}})
		}
	})

	mux.HandleFunc("GET /v1/chats", func(w http.ResponseWriter, r *http.Request) {
		user, _, ok := session(w, r)
		if !ok {
			return
		}
		chats, err := a.Chats(r.Context(), user)
		if err != nil {
			fail(w, "chats")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"chats": chats})
	})

	mux.HandleFunc("GET /v1/chats/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, id, ok := conversation(w, r)
		if !ok {
			return
		}
		c, err := a.Chat(r.Context(), user, id)
		switch {
		case errors.Is(err, store.ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such conversation"})
		case err != nil:
			fail(w, "chat")
		default:
			writeJSON(w, http.StatusOK, map[string]any{"chat": c})
		}
	})

	mux.HandleFunc("PUT /v1/chats/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, id, ok := conversation(w, r)
		if !ok {
			return
		}
		var c store.SavedChat
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxChat)).Decode(&c); err != nil {
			if errors.As(err, new(*http.MaxBytesError)) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "a conversation is at most 2 MB"})
			} else {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send {\"title\": …, \"updated\": ms, \"messages\": […]}"})
			}
			return
		}
		c.ID, c.Title = id, strings.TrimSpace(c.Title)
		if c.Title == "" || len(c.Messages) == 0 || c.Messages[0] != '[' {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a conversation needs a title and a list of messages"})
			return
		}
		if t := []rune(c.Title); len(t) > 200 {
			c.Title = string(t[:200])
		}
		// the browser's clock orders the list; a time that can't be right becomes now
		if now := time.Now().UnixMilli(); c.Updated <= 0 || c.Updated > now+int64(time.Hour/time.Millisecond) {
			c.Updated = now
		}
		if err := a.PutChat(r.Context(), user, c); err != nil {
			fail(w, "save")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("DELETE /v1/chats/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, id, ok := conversation(w, r)
		if !ok {
			return
		}
		if err := a.DeleteChat(r.Context(), user, id); err != nil {
			fail(w, "delete")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

type credentials struct{ Username, Password string }

// readCredentials decodes {username, password}, the name in lower case; otherwise it answers 400 itself.
func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var c credentials
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&c)
	c.Username = strings.ToLower(strings.TrimSpace(c.Username))
	if err != nil || c.Username == "" || c.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Enter a username and a password."})
		return c, false
	}
	return c, true
}
