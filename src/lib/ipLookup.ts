/**
 * Server-side IP → company lookup via ipapi.co (free tier).
 * Returns null for telecom / ISP / cloud provider addresses so we
 * never pollute company fields with "Airtel" or "AWS".
 */

import { normalizeCompany } from './companyFilter'

export { isTelecomOrISP } from './companyFilter'

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

    const company = normalizeCompany(d.org)

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
