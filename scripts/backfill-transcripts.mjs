#!/usr/bin/env node
/**
 * Backfill asset transcripts / extracted text into the DB cache.
 *
 * WHY: YouTube blocks transcript fetches from datacenter IPs (Netlify), so the
 * production chat assistant cannot extract transcripts live. Run this script
 * from a normal (residential) network to populate assets.metadataJson.extractedText
 * for every video / PDF asset. The chat assistant then reads from this cache.
 *
 * USAGE:
 *   node scripts/backfill-transcripts.mjs            # all orgs, only missing/stale
 *   node scripts/backfill-transcripts.mjs --force    # re-extract everything
 *
 * Reads DATABASE_URL (or POSTGRES_URL) from .env.local.
 */
import { readFileSync } from 'fs'

// ── Load .env.local ──────────────────────────────────────────────────────────
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch {
  // .env.local optional if vars already in environment
}

const FORCE = process.argv.includes('--force')
const EXTRACT_VERSION = 2          // keep in sync with src/lib/trackChatServer.ts
const YT_LIMIT = 20000
const PDF_LIMIT = 6000

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!DB_URL) {
  console.error('No DATABASE_URL / POSTGRES_URL found in env or .env.local')
  process.exit(1)
}

const postgres = (await import('postgres')).default
const sql = postgres(DB_URL, { ssl: 'require' })

// ── Extractors ───────────────────────────────────────────────────────────────
function isPdfUrl(url) {
  return !!url && /\.pdf(\?.*)?$/i.test(url)
}
function youTubeId(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
  } catch {}
  return null
}

async function extractPdfText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = new Uint8Array(await res.arrayBuffer())
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(buffer)
  const { text } = await extractText(pdf, { mergePages: true })
  const merged = Array.isArray(text) ? text.join('\n') : text
  return merged.replace(/\s+/g, ' ').trim().slice(0, PDF_LIMIT)
}

let _proxyFetch
async function getProxyFetch() {
  if (_proxyFetch !== undefined) return _proxyFetch
  const proxyUrl = process.env.YOUTUBE_PROXY_URL?.trim()
  if (!proxyUrl) { _proxyFetch = null; return null }
  const { ProxyAgent } = await import('undici')
  const agent = new ProxyAgent(proxyUrl)
  _proxyFetch = (input, init) => fetch(input, { ...(init ?? {}), dispatcher: agent })
  return _proxyFetch
}

async function extractYouTubeTranscript(url) {
  const { YoutubeTranscript } = await import('youtube-transcript')
  const proxyFetch = await getProxyFetch()
  const config = proxyFetch ? { fetch: proxyFetch } : undefined
  const segments = await YoutubeTranscript.fetchTranscript(url, config)
  return segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, YT_LIMIT)
}

// ── Main ──────────────────────────────────────────────────────────────────────
const rows = await sql`
  SELECT id, title, type, source_url, file_url, metadata_json
  FROM assets
  ORDER BY title`

let done = 0, skipped = 0, failed = 0
for (const a of rows) {
  const url = a.file_url ?? a.source_url
  const isPdf = a.type === 'pdf' || isPdfUrl(url)
  const isYt = !!youTubeId(url)
  if (!url || (!isPdf && !isYt)) { skipped++; continue }

  const meta = (a.metadata_json && typeof a.metadata_json === 'object') ? a.metadata_json : {}
  const cachedLen = typeof meta.extractedText === 'string' ? meta.extractedText.length : 0
  const cachedVer = typeof meta.extractedVersion === 'number' ? meta.extractedVersion : 1
  if (!FORCE && cachedLen > 0 && cachedVer >= EXTRACT_VERSION) {
    console.log(`✓ cached  ${a.title.slice(0, 50)} (${cachedLen} chars)`)
    skipped++
    continue
  }

  try {
    const text = isPdf ? await extractPdfText(url) : await extractYouTubeTranscript(url)
    if (!text) throw new Error('empty result')
    await sql`
      UPDATE assets
      SET metadata_json = ${sql.json({
        ...meta,
        extractedText: text,
        extractedAt: new Date().toISOString(),
        extractedVersion: EXTRACT_VERSION,
      })}
      WHERE id = ${a.id}`
    console.log(`✔ saved   ${a.title.slice(0, 50)} (${text.length} chars)`)
    done++
  } catch (e) {
    console.log(`✗ FAILED  ${a.title.slice(0, 50)} — ${e.message}`)
    failed++
  }
}

console.log(`\nDone. saved=${done} skipped=${skipped} failed=${failed}`)
await sql.end()
