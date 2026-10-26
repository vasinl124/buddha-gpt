-- Accounts and the conversations they keep. A guest's conversations stay in their browser.
create table users (
  id         bigint generated always as identity primary key,
  username   text not null unique,     -- lower case: 3 to 32 of a-z 0-9 . _ -
  password   text not null,            -- 'pbkdf2-sha256$rounds$salt$key'
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash bytea primary key,        -- sha256 of the cookie's token, so the table holds no live token
  user_id    bigint not null references users on delete cascade,
  expires_at timestamptz not null
);

create table chats (
  user_id    bigint not null references users on delete cascade,
  id         text not null,            -- the browser's id for the conversation
  title      text not null,
  messages   jsonb not null,           -- the AI SDK's UI messages, as the browser shows them
  updated_at timestamptz not null,
  primary key (user_id, id)
);
create index chats_newest on chats (user_id, updated_at desc);
