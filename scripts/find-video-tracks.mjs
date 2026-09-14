import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
}

const { default: postgres } = await import('postgres')
const sql = postgres(process.env.DATABASE_URL, { max: 1 })

const rows = await sql`
  SELECT a.title, a.source_url, a.file_url, a.duration_seconds,
         t.slug as track_slug, o.slug as org_slug
  FROM assets a
  JOIN track_assets ta ON ta.asset_id = a.id
  JOIN tracks t ON t.id = ta.track_id
  JOIN organizations o ON o.id = t.organization_id
  WHERE a.type = 'video'
  LIMIT 10
`
console.log(JSON.stringify(rows, null, 2))
await sql.end()
