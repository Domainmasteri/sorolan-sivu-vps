CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    is_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guestbook (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_admin INTEGER NOT NULL DEFAULT 0,
    admin_reply TEXT,
    CONSTRAINT guestbook_name_length CHECK (length(name) <= 100),
    CONSTRAINT guestbook_message_length CHECK (length(message) <= 2000),
    CONSTRAINT guestbook_reply_length CHECK (admin_reply IS NULL OR length(admin_reply) <= 2000)
);

CREATE TABLE IF NOT EXISTS links (
    id SERIAL PRIMARY KEY,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS srla_links (
    id SERIAL PRIMARY KEY,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS srl_links (
    id SERIAL PRIMARY KEY,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pastes (
    id SERIAL PRIMARY KEY,
    short_path TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_files (
    id SERIAL PRIMARY KEY,
    s3_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    expires_at BIGINT,
    max_downloads INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO invites (code_hash) VALUES ('root') ON CONFLICT (code_hash) DO NOTHING;
