'use client'

/**
 * Client-side geo lookup via ipapi.co (auto-detects the visitor's own IP).
 * Because each visitor calls from their own IP the free-tier 1000 req/day
 * limit never hits — unlike server-side lookups that share the Netlify IP.
 *
 * The company field is set to null for telecom providers, ISPs, mobile
 * carriers and cloud/hosting orgs — so WFH visitors don't show "Airtel"
 * or "Comcast" as their company in the anonymous traffic table.
 */

export type GeoResult = {
  company: string | null
  country: string | null
  city:    string | null
}

// ── Telecom / ISP / cloud-hosting patterns ────────────────────────────────────
// Mirrors the list in src/lib/ipLookup.ts (server-side).
// Kept here so this 'use client' module has no server-only imports.
const TELECOM_PATTERNS: RegExp[] = [
  /\btelecom(munication)?s?\b/i,
  /\b(mobile|wireless|cellular)\b/i,
  /\bbroadband\b/i,
  /\b(internet\s+service|isp)\b/i,
  /\bcable\b/i,
  /\bfi(b|r)re?\b/i,
  /\b(network|networking)\b/i,
  /\bcommunications?\b/i,
  /\b(lte|dsl|fios|xfinity)\b/i,
  /\b(carrier|telco)\b/i,
  /\b(comcast|verizon|at&t|t-?mobile|sprint|spectrum|charter)\b/i,
  /\b(airtel|jio|vodafone|bsnl|reliance)\b/i,
  /\b(bt\s+(group|plc)?|sky\s+broadband|virgin\s+media|talktalk)\b/i,
  /\b(deutsche\s+telekom|telef[oó]nica|orange|sfr|bouygues)\b/i,
  /\b(singtel|telstra|optus|ntt|softbank|kddi)\b/i,
  /\bchina\s+(telecom|mobile|unicom)\b/i,
  /\b(zayo|level\s+3|cogent|hurricane\s+electric|centurylink|lumen)\b/i,
  /\b(amazon|google\s+cloud|microsoft\s+azure|digitalocean|cloudflare)\b/i,
  /\b(hetzner|ovh|linode|vultr)\b/i,
  /\b(hosting|datacenter|data\s+center|colocation)\b/i,
]

function isTelecomOrISP(org: string): boolean {
  return TELECOM_PATTERNS.some(p => p.test(org))
}
// ─────────────────────────────────────────────────────────────────────────────

async function tryIpApiCo(): Promise<GeoResult | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const d = await res.json()
    if (d.error) return null

    const rawOrg = d.org ? String(d.org).replace(/^AS\d+\s+/i, '').trim() : ''
    const company = rawOrg && !isTelecomOrISP(rawOrg) ? rawOrg : null
    return {
      company,
      country: d.country_name ?? null,
      city:    d.city ?? null,
    }
  } catch {
    return null
  }
}

async function tryIpApiCom(): Promise<GeoResult | null> {
  // ip-api.com has better accuracy for Asian ISPs and broader IPv6 coverage.
  // Free tier: no key needed, 45 req/min per IP (well within visitor usage).
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch('https://ip-api.com/json/?fields=status,country,city,org', { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const d = await res.json()
    if (d.status !== 'success') return null

    const rawOrg = d.org ? String(d.org).replace(/^AS\d+\s+/i, '').trim() : ''
    const company = rawOrg && !isTelecomOrISP(rawOrg) ? rawOrg : null
    return {
      company,
      country: d.country ?? null,
      city:    d.city    ?? null,
    }
  } catch {
    return null
  }
}

export async function clientGeoLookup(): Promise<GeoResult> {
  const empty: GeoResult = { company: null, country: null, city: null }

  // ip-api.com blocks browser-origin / HTTPS requests with 403 (free-tier restriction).
  // Use ipapi.co only — it allows browser-side calls on the free tier.
  const result = await tryIpApiCo()
  return result ?? empty
}
