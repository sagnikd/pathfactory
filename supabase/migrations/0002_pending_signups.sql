CREATE TABLE IF NOT EXISTS "pending_signups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "auth_user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pending_signups_auth_user_id_unique" UNIQUE("auth_user_id"),
  CONSTRAINT "pending_signups_email_unique" UNIQUE("email")
);
