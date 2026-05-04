'use client'

/**
 * Client-side geo lookup via ipapi.co (auto-detects the visitor's own IP).
 * Because each visitor calls from their own IP the free-tier 1000 req/day
 * limit never hits — unlike server-side lookups that share the Netlify IP.
 *
 * Intentionally does NOT filter telecom/ISP for the company field here;
 * callers can apply isTelecomOrISP from ipLookup.ts if they need filtering
 * (GateOverlay does this before pre-filling the form).
 */

export type GeoResult = {
  company: string | null
  country: string | null
  city:    string | null
}

export async function clientGeoLookup(): Promise<GeoResult> {
  const empty: GeoResult = { company: null, country: null, city: null }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return empty
    const d = await res.json()
    if (d.error) return empty

    const rawOrg = d.org ? String(d.org).replace(/^AS\d+\s+/i, '').trim() : ''
    return {
      company: rawOrg || null,
      country: d.country_name ?? null,
      city:    d.city ?? null,
    }
  } catch {
    return empty
  }
}
