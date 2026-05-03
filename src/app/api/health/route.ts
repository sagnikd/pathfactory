import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'

type CheckResult = {
  ok: boolean
  message: string
}

export async function GET() {
  const checks: Record<string, CheckResult> = {
    env: { ok: true, message: 'Required env vars are present' },
    db: { ok: true, message: 'Database reachable' },
    supabaseAuth: { ok: true, message: 'Supabase auth client reachable' },
  }

  const missing: string[] = []
  const requiredEnv = ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
  for (const key of requiredEnv) {
    if (!process.env[key]?.trim()) missing.push(key)
  }

  if (missing.length > 0) {
    checks.env = {
      ok: false,
      message: `Missing env vars: ${missing.join(', ')}`,
    }
  }

  if (checks.env.ok) {
    try {
      await db.execute(sql`select 1`)
    } catch (error: unknown) {
      checks.db = {
        ok: false,
        message: error instanceof Error ? error.message : 'Database query failed',
      }
    }

    try {
      const supabase = await createClient()
      await supabase.auth.getUser()
    } catch (error: unknown) {
      checks.supabaseAuth = {
        ok: false,
        message: error instanceof Error ? error.message : 'Supabase auth check failed',
      }
    }
  } else {
    checks.db = { ok: false, message: 'Skipped because env check failed' }
    checks.supabaseAuth = { ok: false, message: 'Skipped because env check failed' }
  }

  const ok = Object.values(checks).every((c) => c.ok)

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 500 }
  )
}
