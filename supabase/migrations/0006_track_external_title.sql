ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "external_title" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "track_slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"old_slug" text NOT NULL,
	"track_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_slug_redirects" ADD CONSTRAINT "track_slug_redirects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "track_slug_redirects" ADD CONSTRAINT "track_slug_redirects_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_old_slug_idx" ON "track_slug_redirects" ("organization_id","old_slug");
