package store

// Accounts and the conversations they keep. Passwords arrive hashed, and a session is found by the
// hash of its token.

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNotFound = errors.New("not found")
	ErrTaken    = errors.New("username taken")
)

// ChatSummary is a conversation as the sidebar lists it.
type ChatSummary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Updated int64  `json:"updated"` // ms since the epoch, as the browser keeps it
}

type SavedChat struct {
	ChatSummary
	Messages json.RawMessage `json:"messages"` // the AI SDK's UI messages, as the browser shows them
}

func (s *Store) CreateUser(ctx context.Context, username, hash string) (int64, error) {
	var id int64
	err := s.Pool.QueryRow(ctx, `insert into users (username, password) values ($1, $2) returning id`, username, hash).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return 0, ErrTaken
	}
	return id, err
}

// User returns a user's id and password hash.
func (s *Store) User(ctx context.Context, username string) (id int64, hash string, err error) {
	err = s.Pool.QueryRow(ctx, `select id, password from users where username = $1`, username).Scan(&id, &hash)
	return id, hash, notFound(err)
}

// CreateSession stores a new session, clearing out expired ones while it's there.
func (s *Store) CreateSession(ctx context.Context, userID int64, tokenHash []byte, expires time.Time) error {
	_, err := s.Pool.Exec(ctx, `with expired as (delete from sessions where expires_at < now())
		insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)`, tokenHash, userID, expires)
	return err
}

// SessionUser returns the user a live session belongs to.
func (s *Store) SessionUser(ctx context.Context, tokenHash []byte) (id int64, username string, err error) {
	err = s.Pool.QueryRow(ctx, `select u.id, u.username from sessions s join users u on u.id = s.user_id
		where s.token_hash = $1 and s.expires_at > now()`, tokenHash).Scan(&id, &username)
	return id, username, notFound(err)
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.Pool.Exec(ctx, `delete from sessions where token_hash = $1`, tokenHash)
	return err
}

// Chats lists a user's conversations, newest first, without their messages.
// ponytail: the newest 50, as a browser keeps; page the list if accounts need more
func (s *Store) Chats(ctx context.Context, userID int64) ([]ChatSummary, error) {
	rows, err := s.Pool.Query(ctx, `select id, title, (extract(epoch from updated_at) * 1000)::bigint from chats
		where user_id = $1 order by updated_at desc limit 50`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ChatSummary])
}

func (s *Store) Chat(ctx context.Context, userID int64, id string) (SavedChat, error) {
	var c SavedChat
	err := s.Pool.QueryRow(ctx, `select id, title, (extract(epoch from updated_at) * 1000)::bigint, messages
		from chats where user_id = $1 and id = $2`, userID, id).Scan(&c.ID, &c.Title, &c.Updated, &c.Messages)
	return c, notFound(err)
}

// PutChat adds or replaces a conversation. Its time comes from the browser, so a conversation moved
// in from a browser keeps its day in the list, and a save that arrives late never undoes a newer one.
func (s *Store) PutChat(ctx context.Context, userID int64, c SavedChat) error {
	_, err := s.Pool.Exec(ctx, `insert into chats (user_id, id, title, messages, updated_at)
		values ($1, $2, $3, $4, to_timestamp($5::float8 / 1000))
		on conflict (user_id, id) do update set title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at
		where chats.updated_at <= excluded.updated_at`,
		userID, c.ID, c.Title, c.Messages, c.Updated)
	return err
}

func (s *Store) DeleteChat(ctx context.Context, userID int64, id string) error {
	_, err := s.Pool.Exec(ctx, `delete from chats where user_id = $1 and id = $2`, userID, id)
	return err
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
