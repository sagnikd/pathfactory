# PRD: Flows — Automated Sales & Marketing Workflows

**Product:** PathFactory  
**Feature:** Flows Tab  
**Status:** Draft  
**Date:** 2026-05-15  

---

## 1. Problem Statement

PathFactory surfaces rich behavioral signals — dwell time, asset views, company identity, binge rate — but acting on those signals today requires a human to watch the analytics dashboard and manually follow up. By the time a seller sees the notification, the prospect may have already gone cold. Marketing has no way to programmatically respond to engagement events with personalised content or CTAs.

**Flows** closes that gap: a no-code automation layer that lets sales and marketing ops define trigger → condition → action chains, so the right response fires automatically the moment a signal fires.

---

## 2. Goals

1. Reduce median time-to-follow-up from hours to seconds on high-intent signals.
2. Enable marketing to run always-on nurture without manual intervention.
3. Give sellers context-rich, timely alerts rather than raw session dumps.
4. Surface PathFactory as a revenue tool, not just a content portal.

---

## 3. Non-Goals (v1)

- Native CRM bi-directional sync (webhook out only in v1; full HubSpot/Salesforce integration is v2).
- AI-generated email copy (v2).
- A/B testing within flows.
- Multi-branch conditional logic (AND/OR trees are v2; v1 is linear trigger → condition → action).

---

## 4. User Personas

| Persona | Job | Pain today |
|---|---|---|
| **Sales rep** | Works named accounts | Misses live sessions; follows up too late |
| **Marketing ops** | Owns nurture programs | Can't personalise follow-ups at scale |
| **Revenue ops** | Owns tooling | Has to build bespoke Zapier hacks |
| **SDR** | Qualifies inbound | Doesn't know which visitors are worth calling |

---

## 5. Concept Overview

A **Flow** is a saved rule: **"When [TRIGGER] and [CONDITIONS], do [ACTIONS]."**

Flows live in a dedicated **Flows** tab in the dashboard sidebar (between Experiences and Analytics). Each flow targets a specific **Track** or **Experience** (or "All content"). Flows are toggled on/off without deleting them.

### 5.1 Triggers (what starts the flow)

| # | Trigger | Description |
|---|---|---|
| T1 | **Visitor views asset** | Any asset-view event fires |
| T2 | **Visitor completes track** | Reaches last asset in binge/hub track |
| T3 | **Engagement time threshold** | Cumulative dwell ≥ N minutes in a session |
| T4 | **Asset binge** | Viewer watches ≥ N assets in one session |
| T5 | **Lead form submitted** | Gate form filled with email |
| T6 | **Known visitor returns** | Visitor with captured email starts new session |
| T7 | **High-intent company detected** | IP geo / form company matches ABM target list |
| T8 | **Multiple contacts from same account** | ≥ N distinct emails from same company in 7 days |
| T9 | **Visitor goes idle / exits** | No activity for 5 min or tab closes (exit intent) |
| T10 | **Scheduled** | Daily/weekly digest of all sessions above threshold |

### 5.2 Conditions (filters on the trigger)

| # | Condition |
|---|---|
| C1 | Track / Experience is X |
| C2 | Asset type is [pdf / video / article] |
| C3 | Visitor tag / topic viewed contains X |
| C4 | Company name contains / matches ABM list |
| C5 | Session dwell ≥ / ≤ N minutes |
| C6 | Visitor is known (has email) / anonymous |
| C7 | Time of day / day of week |
| C8 | Country / city is X |
| C9 | Engagement score ≥ N (computed: dwell × assets viewed × recency) |

### 5.3 Actions (what fires)

| # | Action | Description |
|---|---|---|
| A1 | **Notify seller (email)** | Send context-rich email to assigned rep: visitor, company, assets viewed, dwell, session link |
| A2 | **Notify seller (Slack)** | Post to a configured Slack webhook URL |
| A3 | **Send prospect an email** | Send a personalised email to captured prospect address — with a direct link back to the track, or a curated "you might also like" asset list |
| A4 | **Send prospect a content recommendation** | Auto-pick next-best asset based on tags of assets already viewed; include in email or inject as in-track banner |
| A5 | **Send prospect a meeting link** | Email a Calendly / cal.com link with personalised subject ("Saw you exploring our security content — grab 15 min?") |
| A6 | **Add to nurture sequence** | POST to HubSpot / Mailchimp / webhook with visitor + engagement payload to enrol in an existing sequence |
| A7 | **Push to CRM (webhook)** | Generic outbound webhook: POST JSON payload with full session data to any URL |
| A8 | **Show in-track CTA banner** | Inject a dismissable banner into the active track session (e.g. "Want a demo? → Book here") — only for known visitors |
| A9 | **Create internal task / note** | POST to Linear, Jira, or Notion with session summary as a new task |
| A10 | **Log to Slack digest** | Queue event for end-of-day digest rather than immediate ping |

---

## 6. Workflow Ideas (Inspiration for Sellers & Marketing)

These are pre-built **templates** surfaced in the Flows UI:

### 🔥 Hot Prospect Alert
*T3 (dwell ≥ 5 min) + C4 (ABM company) → A1 (notify seller) + A2 (Slack)*  
"Someone from [Target Co] just spent 7 minutes in your security track."

### 📬 Auto Content Follow-up
*T4 (binge ≥ 3 assets) + C6 (visitor is anonymous) → A4 (recommend next asset via email)*  
"You watched 3 pieces on zero-trust. Here's one more you'll find useful."

### 📅 Book a Meeting (Post-Binge)
*T2 (track completed) + C6 (known visitor) → A5 (send meeting link)*  
"You finished the entire track — impressive. Want to talk to an expert?"

### 🏢 Account Surge Alert
*T8 (≥ 3 contacts from same account in 7 days) → A1 (notify AE) + A9 (create CRM task)*  
"3 people from Acme Corp viewed your DevOps track this week."

### 🔁 Re-engagement Nudge
*T6 (known visitor returns after ≥ 7 days idle) → A3 (send welcome-back email with latest content)*  
"Welcome back! Here's what's new since your last visit."

### 🎯 Exit-Intent Offer
*T9 (visitor exits) + C5 (dwell ≥ 2 min) + C6 (anonymous) → A8 (in-track CTA banner before exit)*  
"Before you go — get the full PDF version of this guide."

### 📊 Daily Digest for Sales Team
*T10 (scheduled daily) → A10 (Slack digest)*  
"Yesterday's top 5 sessions: [visitor] [company] [dwell] [assets viewed]"

### 🧲 Lead Enrichment Push
*T5 (lead form submitted) → A6 (enrol in HubSpot sequence) + A1 (notify SDR instantly)*  
Immediately fires the SDR workflow the moment intent + identity are both confirmed.

### 🔔 Competitor Content Alert
*T1 (asset viewed) + C3 (topic = "competitive" / "vs") → A1 (notify product marketing)*  
"Prospect viewed your competitor comparison page — loop in PMM?"

### ⏱ Long Dwell on Pricing Page
*T3 (dwell ≥ 3 min) + C3 (asset tag = "pricing") → A5 (send meeting link)*  
"They're clearly evaluating. Strike while hot."

---

## 7. Engagement Score (for Condition C9)

Computed per session, stored on sessions table:

```
score = (dwell_secs / 60) * 1.0
      + (assets_viewed) * 2.0
      + (is_known_visitor ? 5 : 0)
      + (abm_match ? 10 : 0)
      - (days_since_last_session * 0.5)   // recency decay
```

Thresholds (suggested defaults, configurable):
- **Low:** 0–10
- **Medium:** 11–25  
- **High:** 26+

---

## 8. Data Model

### `flows` table
```sql
id              uuid PK
organization_id uuid FK
name            text
description     text
status          'active' | 'paused' | 'draft'
trigger_type    text   -- T1..T10 enum
trigger_config  jsonb  -- { dwell_threshold_mins: 5 }
conditions      jsonb  -- [{ field, op, value }, ...]
actions         jsonb  -- [{ type, config }, ...]
cooldown_mins   int    -- prevent re-firing for same visitor (default 60)
target_scope    jsonb  -- { type: 'track'|'experience'|'all', id: uuid|null }
created_at      timestamptz
updated_at      timestamptz
```

### `flow_executions` table
```sql
id          uuid PK
flow_id     uuid FK
session_id  uuid FK
visitor_id  uuid FK
fired_at    timestamptz
actions_run jsonb   -- log of what fired and result
status      'success' | 'partial' | 'failed'
error       text
```

---

## 9. UI Design

### 9.1 Flows List Page (`/dashboard/flows`)
- Table: Name, Trigger, Target, Status toggle, Last fired, Executions count
- "New Flow" button → opens Flow Builder
- Template gallery row above table: 10 pre-built cards

### 9.2 Flow Builder (modal or full page)
```
[1. Name & target]   → [2. Trigger]   → [3. Conditions]   → [4. Actions]   → [5. Review & Save]
```
Step-by-step wizard. Each step is a card. Conditions step allows adding 0–N condition rows with AND logic. Actions step allows stacking up to 3 actions (v1 limit).

### 9.3 Flow Execution Log
Drawer from the flows list row. Shows last 50 executions: visitor, fired_at, actions run, status.

---

## 10. Email Action Detail (A3 / A5)

PathFactory sends from the org's configured sender (SMTP / Resend). Email template:

**Subject options (configurable):**
- `"{{firstName}}, here's more on {{topic}} from {{org.name}}"`
- `"{{org.name}} thought you'd find this useful"`
- Custom subject line field

**Body blocks (drag-reorder):**
- Personalised greeting (uses gate form firstName or email prefix)
- Asset recommendation cards (title + thumbnail + link to track at specific asset)
- Meeting CTA button
- Unsubscribe link (required, uses `leads.unsubscribed` flag)

Emails sent via `/api/flow-email` — reuses Resend integration already in place.

---

## 11. Implementation Phases

### Phase 1 — Core Engine (2–3 weeks)
- `flows` + `flow_executions` schema + migration
- Flow evaluation engine: hook into session-geo route (already processes every session) — evaluate active flows after geo resolves
- Actions: A1 (email seller) + A2 (Slack webhook) — both already partially implemented
- Basic Flow Builder UI (wizard, no templates)
- Flows list page with on/off toggle

### Phase 2 — Prospect Actions (2 weeks)
- Actions A3 (prospect email), A4 (content recommendation), A5 (meeting link)
- Unsubscribe handling
- Email template builder
- Cooldown logic to prevent spam

### Phase 3 — Advanced Triggers + Integrations (2 weeks)
- Triggers T8 (account surge), T9 (exit intent), T10 (scheduled digest)
- Action A6 (webhook / HubSpot), A9 (Linear/Notion task)
- Engagement score computed + stored on sessions
- Template gallery (10 pre-built flows)

### Phase 4 — Analytics & Optimisation (1 week)
- Flow performance dashboard: executions, open rates on A3/A5, meeting bookings
- Flow execution log drawer
- Multi-action stacking (up to 5 in v2)

---

## 12. Success Metrics

| Metric | Target (90 days post-launch) |
|---|---|
| Flows created per org | ≥ 3 |
| % orgs with ≥ 1 active flow | 70% |
| Seller response time to high-intent alert | < 30 min (vs. baseline hours) |
| Prospect email open rate (A3/A5) | ≥ 35% |
| Meeting bookings attributed to A5 | Track week-over-week |
| Execution success rate | ≥ 95% |

---

## 13. Open Questions

1. **Sender identity for A3/A5:** send as `noreply@pathfactory` or allow org to configure custom domain? Custom domain preferred but adds DKIM/SPF setup friction.
2. **GDPR / unsubscribe:** prospect emails need one-click unsubscribe. Flag on `leads` table exists — need to honour it in flow engine.
3. **Cooldown scope:** per-visitor-per-flow or per-visitor-per-org? Per-visitor-per-flow is safer to start.
4. **Exit intent (T9):** technically hard — `visibilitychange` fires on tab switch too. May produce false positives. Scope to binge-complete + idle > 5 min instead.
5. **Content recommendation (A4):** needs basic tag-overlap scoring across all org assets. Simple enough for v1 without ML.

---

*End of PRD*
