#!/usr/bin/env node
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

// Load .env.local
const envFile = readFileSync(join(root, '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
}

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1) }

const sqlText = readFileSync(join(root, 'supabase/migrations/0008_enable_rls.sql'), 'utf8')

// Dynamically import postgres (ESM package)
const { default: postgres } = await import('postgres')
const sql = postgres(dbUrl, { max: 1 })

console.log('Running 0008_enable_rls.sql …')
try {
  await sql.unsafe(sqlText)
  console.log('Done.')
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
} finally {
  await sql.end()
}
