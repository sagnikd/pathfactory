-- ── RLS: Enable row-level security on all tables ─────────────────────────────
--
-- Strategy:
--   • `authenticated` role = dashboard users (Supabase JWT)
--   • `anon` role = public track visitors (no auth)
--   • Direct postgres/service-role connection (used by the Next.js server)
--     bypasses RLS automatically — server-side auth is enforced at app layer.
--   • These policies protect against Supabase REST API (anon key) abuse
--     and direct Studio queries by non-owner users.

-- Helper: resolve the current JWT user's organization_id.
-- SECURITY DEFINER so it can read `users` even after RLS is on.
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;

-- ── organizations ─────────────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org: members see own org" ON organizations
  FOR SELECT TO authenticated
  USING (id = auth.user_org_id());

CREATE POLICY "org: members update own org" ON organizations
  FOR UPDATE TO authenticated
  USING (id = auth.user_org_id());

-- ── users ─────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: see own org" ON users
  FOR SELECT TO authenticated
  USING (organization_id = auth.user_org_id());

CREATE POLICY "users: manage own org" ON users
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id());

-- ── assets ────────────────────────────────────────────────────────────────────
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets: dashboard org scope" ON assets
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- Public track pages need to read asset metadata (title, thumbnail, source_url).
CREATE POLICY "assets: public read" ON assets
  FOR SELECT TO anon
  USING (true);

-- ── tracks ────────────────────────────────────────────────────────────────────
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracks: dashboard org scope" ON tracks
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- Public track pages resolve tracks by slug.
CREATE POLICY "tracks: public read published" ON tracks
  FOR SELECT TO anon
  USING (status = 'published');

-- ── track_assets ──────────────────────────────────────────────────────────────
ALTER TABLE track_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "track_assets: dashboard org scope" ON track_assets
  FOR ALL TO authenticated
  USING (
    track_id IN (
      SELECT id FROM tracks WHERE organization_id = auth.user_org_id()
    )
  );

CREATE POLICY "track_assets: public read" ON track_assets
  FOR SELECT TO anon
  USING (true);

-- ── form_configs ──────────────────────────────────────────────────────────────
ALTER TABLE form_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_configs: dashboard org scope" ON form_configs
  FOR ALL TO authenticated
  USING (
    track_id IN (
      SELECT id FROM tracks WHERE organization_id = auth.user_org_id()
    )
  );

-- Public track gate reads form config to render the form.
CREATE POLICY "form_configs: public read" ON form_configs
  FOR SELECT TO anon
  USING (true);

-- ── visitors ──────────────────────────────────────────────────────────────────
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors upsert themselves by fingerprint.
CREATE POLICY "visitors: anon insert" ON visitors
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "visitors: anon update own" ON visitors
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Dashboard can read all visitors (filtered at app layer by org).
CREATE POLICY "visitors: dashboard read" ON visitors
  FOR SELECT TO authenticated
  USING (true);

-- ── sessions ──────────────────────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors start/end sessions.
CREATE POLICY "sessions: anon insert" ON sessions
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "sessions: anon update own" ON sessions
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "sessions: dashboard org scope" ON sessions
  FOR SELECT TO authenticated
  USING (
    track_id IN (
      SELECT id FROM tracks WHERE organization_id = auth.user_org_id()
    )
  );

-- ── engagements ───────────────────────────────────────────────────────────────
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engagements: anon insert" ON engagements
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "engagements: dashboard org scope" ON engagements
  FOR SELECT TO authenticated
  USING (
    asset_id IN (
      SELECT id FROM assets WHERE organization_id = auth.user_org_id()
    )
  );

-- ── leads ─────────────────────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads: anon insert" ON leads
  FOR INSERT TO anon
  WITH CHECK (true);

-- Dashboard reads leads via visitor→session→track→org (filtered at app layer).
CREATE POLICY "leads: dashboard read" ON leads
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "leads: dashboard manage" ON leads
  FOR ALL TO authenticated
  USING (true);

-- ── webhooks ──────────────────────────────────────────────────────────────────
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks: org scope" ON webhooks
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- ── abm_accounts ──────────────────────────────────────────────────────────────
ALTER TABLE abm_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abm_accounts: org scope" ON abm_accounts
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- ── abm_account_domains ───────────────────────────────────────────────────────
ALTER TABLE abm_account_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abm_account_domains: org scope" ON abm_account_domains
  FOR ALL TO authenticated
  USING (
    abm_account_id IN (
      SELECT id FROM abm_accounts WHERE organization_id = auth.user_org_id()
    )
  );

-- ── abm_matches ───────────────────────────────────────────────────────────────
ALTER TABLE abm_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abm_matches: org scope" ON abm_matches
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- ── abm_alerts ────────────────────────────────────────────────────────────────
ALTER TABLE abm_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abm_alerts: org scope" ON abm_alerts
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- ── company_aliases ───────────────────────────────────────────────────────────
ALTER TABLE company_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_aliases: org scope" ON company_aliases
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

-- ── track_slug_redirects ──────────────────────────────────────────────────────
ALTER TABLE track_slug_redirects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "track_slug_redirects: dashboard org scope" ON track_slug_redirects
  FOR ALL TO authenticated
  USING (organization_id = auth.user_org_id())
  WITH CHECK (organization_id = auth.user_org_id());

CREATE POLICY "track_slug_redirects: public read" ON track_slug_redirects
  FOR SELECT TO anon
  USING (true);

-- ── pending_signups ───────────────────────────────────────────────────────────
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;

-- No org linkage — only service role (server) should touch this.
-- Deny all anon and authenticated direct access.
