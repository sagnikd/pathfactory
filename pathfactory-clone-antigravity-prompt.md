# Build a PathFactory-style Content Experience Platform

Build a B2B content experience platform inspired by PathFactory: marketers curate "content tracks" (videos, PDFs, articles, images) into binge-able streams; anonymous visitors consume the content; the platform captures granular engagement events and converts visitors into leads via inline forms.

Plan the work in phases, scaffold first, then verify each phase end-to-end in the browser before moving on.

---

## Tech stack (use these unless you find a strong reason not to)

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js Route Handlers + Server Actions
- **Database**: PostgreSQL (Supabase or Neon) + Drizzle ORM, with `pgvector` enabled
- **Auth**: Supabase Auth — email + Google OAuth for marketer admins; lightweight email-only capture for visitors
- **File storage**: Supabase Storage (or S3-compatible)
- **Analytics events**: custom `/api/events` endpoint, batched on the client, written to Postgres; aggregate in materialized views
- **Charts**: Recharts
- **Drag & drop**: dnd-kit
- **PDF viewer**: react-pdf with custom scroll-depth tracking
- **Video**: react-player (YouTube / Vimeo / MP4 / HLS)
- **Visitor fingerprint**: FingerprintJS open-source build, fall back to first-party cookie + localStorage

---

## Data model

- `Organization` — tenant; has many users, assets, tracks
- `User` — org member; role: `admin | editor`
- `Asset` — `type`: `pdf | video | article | image`; fields: title, description, thumbnailUrl, sourceUrl, fileUrl, durationSeconds, metadataJson (OG tags)
- `Track` — title, slug, layout (`binge | hub | single`), themeJson (brand color, logo, font), gateConfigJson, status (`draft | published`), assets ordered via join table `TrackAsset(position)`
- `FormConfig` — fields[], position (`gate | after_asset_n | exit_intent`), requiredFields[], triggerRule
- `Visitor` — fingerprintId, capturedEmail (nullable), firstSeenAt, lastSeenAt, utmJson
- `Session` — visitorId, trackId, startedAt, endedAt, deviceJson, referrer
- `Engagement` — sessionId, assetId, eventType (`view | scroll_25 | scroll_50 | scroll_75 | scroll_100 | video_play | video_pause | video_complete | click | dwell_tick`), payloadJson, ts
- `Lead` — visitorId, email, formResponsesJson, score (computed), createdAt
- `Webhook` — orgId, url, secret, events[]

Multi-tenant: every query is scoped by `organizationId`. Use Drizzle's relations + RLS in Supabase as a backstop.

---

## Build phases

### Phase 1 — Marketer admin
1. Org signup, invite teammates, role-based access
2. **Asset library**: drag-drop PDF upload, paste video URL (resolve oEmbed for YouTube/Vimeo), paste article URL (server-side OG scrape for thumbnail + title), bulk select, search, tag
3. **Track builder**:
   - Three layouts: **Binge** (vertical auto-advancing stream), **Hub** (grid of tiles), **Single** (one asset + related sidebar)
   - dnd-kit reorder, inline rename, asset preview
   - Live preview pane that mirrors the visitor experience at desktop + mobile breakpoints
4. **Theme editor**: brand color (with auto-derived accent palette), logo upload, font picker (Google Fonts subset), CSS-variable-driven theming
5. **Form builder**: pick fields (email required, plus first name / company / role / custom), choose position (gate the whole track / inline after asset N / exit-intent modal), required toggle
6. **Publish**: generate public URL `/t/[orgSlug]/[trackSlug]`, copy embed snippet

### Phase 2 — Visitor experience
1. Public track page — server-rendered, mobile-first, sticky progress bar
2. PDF viewer with per-page scroll-depth events
3. Video player with play/pause/complete + percent-watched milestones
4. Article: render in iframe sandbox; track time-on-asset via visibility API
5. Form rendering per FormConfig; gated assets are blurred + locked until submit; remember capture across sessions via fingerprint
6. Auto-advance to next asset in Binge mode with a 3-second skippable countdown
7. UTM capture on first visit, persisted with the visitor

### Phase 3 — Analytics
1. Events SDK: queue on client, batch POST every 5s or on `visibilitychange`, retry with exponential backoff
2. **Track dashboard**: visitors, sessions, avg session duration, asset completion %, drop-off funnel, top assets table
3. **Visitor timeline**: chronological event stream per lead, grouped by session
4. **Asset heatmap**: for PDFs, which pages get the most dwell time; for videos, retention curve
5. **Lead list**: filter, sort by engagement score (weighted: dwell + completion + revisits + form depth), CSV export

### Phase 4 — Polish & integrations
1. Three starter track templates (product launch, webinar follow-up, sales enablement)
2. Embed widget: a `<script>` snippet that mounts a track in a sized iframe on a customer's site, with cross-frame event passthrough
3. Webhooks on lead capture + signed payload (HMAC-SHA256)
4. AI "next best content" recommendation: embed asset titles+descriptions with `text-embedding-3-small`, store in pgvector, recommend based on dwell-weighted visitor history
5. Slack notification on high-score lead

---

## Design direction

- **Admin app**: Linear/Vercel-grade polish — sidebar nav, dense tables with sticky headers, inline editing, command-K palette, optimistic updates. No generic Bootstrap aesthetic.
- **Visitor experience**: editorial, content-first, generous whitespace, type-driven hierarchy. The marketer's brand (color, logo, font) should clearly take over the page.
- Dark mode in admin; visitor experience inherits the configured theme only.

---

## Acceptance criteria for v1 (end of Phase 3)

A clean signup-to-insight flow must work end-to-end:

1. Sign up, create an org, upload one PDF, paste one YouTube URL, paste one article URL.
2. Build a Binge track with all three assets, set a gate form requiring email + company on asset 2, apply a brand color and logo, publish.
3. Open the public URL in an incognito window, scroll the PDF, watch 30s of the video, submit the form, finish the track.
4. In the admin dashboard, within 5 seconds: see 1 visitor, 1 session, the captured lead, the chronological timeline of events, and a populated funnel chart.

---

## Verification approach

- Unit tests with Vitest for scoring + event aggregation logic.
- Playwright E2E for: signup → publish → visitor consumption → analytics appearance.
- Run the visitor flow on a mobile viewport in Playwright as part of CI.
- After each phase, open the actual app in a browser and confirm the acceptance criterion for that phase before moving on.

---

## Start here

1. Scaffold the Next.js + TypeScript + Tailwind + shadcn/ui project.
2. Set up Supabase project, Drizzle schema for the data model above, run initial migration.
3. Implement auth + org creation + the asset library page (upload + URL paste + OG scrape).
4. Write a Playwright test for "sign up → upload PDF → see it in library" and confirm green before starting the track builder.

Ask me before introducing any major dependency not listed above.
