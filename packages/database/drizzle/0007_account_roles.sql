DO $$ BEGIN
  CREATE TYPE "account_role" AS ENUM ('user', 'support', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" "account_role" NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" ("role");
