CREATE TYPE "public"."abm_match_source" AS ENUM('email_domain', 'reverse_ip', 'fuzzy');
--> statement-breakpoint
CREATE TYPE "public"."abm_confidence" AS ENUM('high', 'medium', 'low');
--> statement-breakpoint

CREATE TABLE "abm_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "account_name" text NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "owner_email" text,
  "notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abm_account_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "abm_account_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abm_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "visitor_id" uuid NOT NULL,
  "session_id" uuid,
  "lead_id" uuid,
  "abm_account_id" uuid NOT NULL,
  "match_source" "abm_match_source" NOT NULL,
  "confidence" "abm_confidence" NOT NULL,
  "matched_value" text NOT NULL,
  "payload_json" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abm_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "abm_account_id" uuid NOT NULL,
  "lead_id" uuid,
  "visitor_id" uuid,
  "trigger_type" text NOT NULL,
  "recipients_json" jsonb NOT NULL,
  "payload_json" jsonb,
  "sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "abm_accounts" ADD CONSTRAINT "abm_accounts_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_account_domains" ADD CONSTRAINT "abm_account_domains_abm_account_id_abm_accounts_id_fk"
FOREIGN KEY ("abm_account_id") REFERENCES "public"."abm_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_matches" ADD CONSTRAINT "abm_matches_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_matches" ADD CONSTRAINT "abm_matches_visitor_id_visitors_id_fk"
FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_matches" ADD CONSTRAINT "abm_matches_session_id_sessions_id_fk"
FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_matches" ADD CONSTRAINT "abm_matches_lead_id_leads_id_fk"
FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_matches" ADD CONSTRAINT "abm_matches_abm_account_id_abm_accounts_id_fk"
FOREIGN KEY ("abm_account_id") REFERENCES "public"."abm_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_alerts" ADD CONSTRAINT "abm_alerts_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_alerts" ADD CONSTRAINT "abm_alerts_abm_account_id_abm_accounts_id_fk"
FOREIGN KEY ("abm_account_id") REFERENCES "public"."abm_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_alerts" ADD CONSTRAINT "abm_alerts_lead_id_leads_id_fk"
FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "abm_alerts" ADD CONSTRAINT "abm_alerts_visitor_id_visitors_id_fk"
FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "abm_domains_domain_idx" ON "abm_account_domains" ("domain");
--> statement-breakpoint
CREATE INDEX "abm_accounts_org_idx" ON "abm_accounts" ("organization_id");
