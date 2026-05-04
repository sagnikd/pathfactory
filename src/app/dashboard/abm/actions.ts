'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { abmAccountDomains, abmAccounts } from '@/db/schema'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { isAbmSchemaReady } from '@/lib/abm'

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  out.push(current.trim())
  return out
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function pickColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeaderName)
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeHeaderName(alias))
    if (idx >= 0) return idx
  }
  return -1
}

export async function importAbmCsv(formData: FormData) {
  if (!(await isAbmSchemaReady())) return
  const { dbUser } = await getDashboardAuthContext()
  const csv = String(formData.get('csv') ?? '')
  if (!csv.trim()) return

  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return

  const [first, ...rest] = lines
  const header = parseCsvLine(first)
  const hasHeader = header.some((h) => {
    const n = normalizeHeaderName(h)
    return ['accountname', 'account', 'company', 'domain', 'domains'].includes(n)
  })
  const dataLines = hasHeader ? rest : lines

  const accountIdx = hasHeader
    ? pickColumnIndex(header, ['account_name', 'account name', 'account', 'company', 'company name'])
    : 0
  const domainIdx = hasHeader
    ? pickColumnIndex(header, ['domain', 'domains', 'website', 'web site'])
    : 1
  const priorityIdx = hasHeader
    ? pickColumnIndex(header, ['priority', 'tier'])
    : 2
  const ownerEmailIdx = hasHeader
    ? pickColumnIndex(header, ['owner_email', 'owner email', 'admin_email', 'admin email'])
    : 3
  const notesIdx = hasHeader
    ? pickColumnIndex(header, ['notes', 'note', 'comments', 'comment'])
    : 4

  for (const line of dataLines) {
    const cols = parseCsvLine(line)
    const accountName = (cols[accountIdx] ?? '').trim()
    const domainRaw = (cols[domainIdx] ?? '').trim()
    const priority = (priorityIdx >= 0 ? (cols[priorityIdx] ?? 'medium') : 'medium').trim() || 'medium'
    const ownerEmail = (ownerEmailIdx >= 0 ? (cols[ownerEmailIdx] ?? '') : '').trim() || null
    const notes = (notesIdx >= 0 ? (cols[notesIdx] ?? '') : '').trim() || null
    if (!accountName || !domainRaw) continue

    const [account] = await db.insert(abmAccounts).values({
      organizationId: dbUser.organizationId,
      accountName,
      priority,
      ownerEmail,
      notes,
      status: 'active',
    }).returning({ id: abmAccounts.id })

    const domains = Array.from(new Set(domainRaw.split(/[,\n;|]/).map(normalizeDomain).filter(Boolean)))
    if (domains.length > 0) {
      await db.insert(abmAccountDomains).values(
        domains.map((d, idx) => ({
          abmAccountId: account.id,
          domain: d,
          isPrimary: idx === 0,
        }))
      )
    }
  }

  revalidatePath('/dashboard/abm')
}

export async function addAbmAccount(formData: FormData) {
  if (!(await isAbmSchemaReady())) return
  const { dbUser } = await getDashboardAuthContext()
  const accountName = String(formData.get('accountName') ?? '').trim()
  const domainsRaw = String(formData.get('domains') ?? '').trim()
  const priority = String(formData.get('priority') ?? 'medium').trim() || 'medium'
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!accountName || !domainsRaw) return

  const [account] = await db.insert(abmAccounts).values({
    organizationId: dbUser.organizationId,
    accountName,
    priority,
    ownerEmail,
    notes,
    status: 'active',
  }).returning({ id: abmAccounts.id })

  const domains = Array.from(new Set(domainsRaw.split(/[,\n;|]/).map(normalizeDomain).filter(Boolean)))
  await db.insert(abmAccountDomains).values(
    domains.map((d, idx) => ({
      abmAccountId: account.id,
      domain: d,
      isPrimary: idx === 0,
    }))
  )

  revalidatePath('/dashboard/abm')
}

export async function deleteAbmAccount(formData: FormData) {
  if (!(await isAbmSchemaReady())) return
  const { dbUser } = await getDashboardAuthContext()
  const accountId = String(formData.get('accountId') ?? '')
  if (!accountId) return

  await db.delete(abmAccounts)
    .where(and(eq(abmAccounts.id, accountId), eq(abmAccounts.organizationId, dbUser.organizationId)))

  revalidatePath('/dashboard/abm')
}

export async function updateAbmAccount(formData: FormData) {
  if (!(await isAbmSchemaReady())) return
  const { dbUser } = await getDashboardAuthContext()
  const accountId = String(formData.get('accountId') ?? '').trim()
  const accountName = String(formData.get('accountName') ?? '').trim()
  const domainsRaw = String(formData.get('domains') ?? '').trim()
  const priority = String(formData.get('priority') ?? 'medium').trim() || 'medium'
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const status = String(formData.get('status') ?? 'active').trim() || 'active'
  if (!accountId || !accountName || !domainsRaw) return

  const [account] = await db.select({ id: abmAccounts.id })
    .from(abmAccounts)
    .where(and(eq(abmAccounts.id, accountId), eq(abmAccounts.organizationId, dbUser.organizationId)))
  if (!account) return

  await db.update(abmAccounts).set({
    accountName,
    priority,
    ownerEmail,
    notes,
    status,
    updatedAt: new Date(),
  }).where(eq(abmAccounts.id, accountId))

  await db.delete(abmAccountDomains).where(eq(abmAccountDomains.abmAccountId, accountId))
  const domains = Array.from(new Set(domainsRaw.split(/[,\n;|]/).map(normalizeDomain).filter(Boolean)))
  if (domains.length > 0) {
    await db.insert(abmAccountDomains).values(
      domains.map((d, idx) => ({
        abmAccountId: accountId,
        domain: d,
        isPrimary: idx === 0,
      }))
    )
  }

  revalidatePath('/dashboard/abm')
}
