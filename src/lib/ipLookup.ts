/**
 * Server-side IP → company lookup via ipapi.co (free tier).
 * Returns null for telecom / ISP / cloud provider addresses so we
 * never pollute company fields with "Airtel" or "AWS".
 */

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

export function isTelecomOrISP(org: string): boolean {
  return TELECOM_PATTERNS.some(p => p.test(org))
}

export type IpInfo = {
  company: string | null
  country: string | null
  city:    string | null
  ip:      string | null
}

export async function lookupIp(ip: string | null): Promise<IpInfo> {
  const empty: IpInfo = { company: null, country: null, city: null, ip }

  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return empty
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CEP-Tracker/1.0' },
    })
    clearTimeout(timeout)
    if (!res.ok) return empty

    const d = await res.json()
    if (d.error) return empty

    const rawOrg  = d.org  ? String(d.org).replace(/^AS\d+\s+/i, '').trim() : ''
    const company = rawOrg && !isTelecomOrISP(rawOrg) ? rawOrg : null

    return {
      ip,
      company,
      country: d.country_name ?? null,
      city:    d.city ?? null,
    }
  } catch {
    return empty
  }
}
