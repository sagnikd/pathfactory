# PathFactory

A B2B Content Engagement Platform. Curate assets into binge-able content tracks, gate them with forms, track deep engagement, and score leads — all from one dashboard.

## What it does

**Content Tracks** — Organize PDFs, videos, articles, and images into curated sequences with configurable layouts (binge, hub, single asset). Share via a public `/{org}/{track}` URL.

**Asset Management** — Add assets by URL (YouTube, Vimeo, Cloudinary, article, direct MP4) or upload PDFs directly. Titles and thumbnails auto-extracted.

**Engagement Tracking** — Captures granular events per visitor per asset:
- Scroll depth milestones (25 / 50 / 75 / 100%)
- Video play, pause, seek, complete
- Dwell time ticks
- Clicks and asset opens

**Visitor Identification** — Fingerprint-based anonymous tracking (FingerprintJS) with UTM parameter capture. Email capture upgrades anonymous visitors to identified leads.

**Lead Scoring** — Configurable point-based scoring per engagement signal (asset view, deep scroll, video complete, return session). Scores updated in real time.

**Forms & Gates** — Conditional form placement: email gate before first asset, post-asset, or exit-intent. Fully configurable per track.

**ABM (Account-Based Marketing)** — Match visitors to target accounts via email domain, reverse IP lookup, or fuzzy matching. Confidence levels tracked per match.

**Analytics Dashboard** — Multi-section analytics across tracks, assets, experiences, leads, and ABM performance.

**Webhooks** — Push engagement events and lead data to CRMs or MAPs on configurable triggers.

**Multi-tenant** — Organizations own their tracks and assets. Role-based access (admin / editor).

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Database | Supabase (Postgres + pgvector) |
| ORM | Drizzle |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Email | Resend |
| UI | Tailwind CSS + shadcn/ui |
| Font | Roobert |

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill in Supabase and Resend credentials.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
```

## Project structure

```
src/
  app/
    dashboard/       # Creator dashboard (tracks, assets, analytics, leads, ABM)
    t/[org]/[track]/ # Public track viewer
    api/events/      # Engagement event ingestion endpoint
  db/
    schema.ts        # Drizzle schema (13 tables)
  lib/               # Auth, Supabase client, utilities
```
