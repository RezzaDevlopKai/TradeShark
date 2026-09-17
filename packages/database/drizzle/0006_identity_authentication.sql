CREATE TABLE IF NOT EXISTS "user_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id"),
  "password_hash" text NOT NULL,
  "password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx"
  ON "auth_sessions" ("user_id", "expires_at");

CREATE INDEX IF NOT EXISTS "auth_sessions_active_idx"
  ON "auth_sessions" ("token_hash", "expires_at")
  WHERE "revoked_at" IS NULL;
