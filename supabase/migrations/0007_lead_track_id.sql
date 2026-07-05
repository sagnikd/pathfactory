ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "track_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE set null ON UPDATE no action;
