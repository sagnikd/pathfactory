/**
 * Single source of truth for "is this org name actually the visitor's employer,
 * or just the pipe their packets travelled through".
 *
 * An IP lookup returns whoever owns the address block — a home ISP, a mobile
 * carrier, a cloud region, or a VPN/SASE provider. None of those are the
 * visitor's company, and attributing them as such pollutes the analytics
 * tables, the ABM matcher and gate-form autofill alike.
 *
 * This list previously existed as three divergent copies (server ipLookup,
 * client geoLookup, GateOverlay). Adding a pattern to one silently left the
 * other two wrong, which is how "Cato Networks Ltd" kept showing up after
 * being blocked. Deliberately framework-agnostic — no 'use client' / 'use
 * server' directive and no imports — so every call site can share this one.
 */

const TELECOM_PATTERNS: RegExp[] = [
  // Generic descriptors
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

  // Carriers / ISPs
  /\b(comcast|verizon|at&t|t-?mobile|sprint|spectrum|charter)\b/i,
  /\bcox\s+(communications|cable)?\b/i,
  /\b(airtel|jio|vodafone|bsnl|reliance)\b/i,
  /\b(bt\s+(group|plc)?|sky\s+broadband|virgin\s+media|talktalk)\b/i,
  /\b(deutsche\s+telekom|telef[oó]nica|orange|sfr|bouygues)\b/i,
  /\b(singtel|starhub|m1\s+limited|telstra|optus|ntt|softbank|kddi)\b/i,
  /\bchina\s+(telecom|mobile|unicom)\b/i,
  /\b(zayo|level\s+3|cogent|hurricane\s+electric|centurylink|lumen)\b/i,
  /\bfrontier\s+communications\b/i,

  // Cloud / hosting — the visitor is on their infrastructure, not their payroll
  /\bamazon(\s+(web\s+services|aws))?\b/i,
  /\bgoogle(\s+(cloud|fiber))?\b/i,
  /\bmicrosoft(\s+azure)?\b/i,
  /\bdigital\s*ocean\b/i,
  /\bcloudflare\b/i,
  /\b(hetzner|ovh|linode|vultr)\b/i,
  /\b(hosting|datacenter|data\s+center|colocation)\b/i,

  // Resolvers / security middleboxes the traffic exits through
  /\b(opendns|quad9|nextdns)\b/i,

  // VPN / SASE / zero-trust egress — the org owns the exit node, not the visitor
  /\bcato\s+networks?\b/i,
  /\b(zscaler|netskope|cloudflare\s+warp|perimeter\s*81|twingate|tailscale)\b/i,
  /\b(nordvpn|expressvpn|surfshark|private\s+internet\s+access|mullvad|proton\s*vpn)\b/i,
  /\bvpn\b/i,
]

export function isTelecomOrISP(org: string): boolean {
  return TELECOM_PATTERNS.some((p) => p.test(org))
}

/**
 * Turn a raw `org` field from an IP-geolocation provider into a usable company
 * name, or null. Strips the leading AS number ("AS13335 Cloudflare, Inc.") and
 * drops anything that is infrastructure rather than an employer.
 */
export function normalizeCompany(rawOrg: unknown): string | null {
  if (typeof rawOrg !== 'string') return null
  const cleaned = rawOrg.replace(/^AS\d+\s+/i, '').trim()
  if (!cleaned) return null
  return isTelecomOrISP(cleaned) ? null : cleaned
}
