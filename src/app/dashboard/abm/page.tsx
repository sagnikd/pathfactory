import { db } from '@/db'
import { abmAlerts, abmMatches } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { isAbmSchemaReady, listAbmAccounts } from '@/lib/abm'
import { addAbmAccount, importAbmCsv } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import AbmAccountsEditor from './AbmAccountsEditor'

export default async function AbmPage() {
  const { dbUser } = await getDashboardAuthContext()
  const schemaReady = await isAbmSchemaReady()
  const accounts = schemaReady ? await listAbmAccounts(dbUser.organizationId) : []
  const recentMatches = schemaReady
    ? await db.select().from(abmMatches)
      .where(eq(abmMatches.organizationId, dbUser.organizationId))
      .orderBy(desc(abmMatches.createdAt))
      .limit(15)
    : []
  const recentAlerts = schemaReady
    ? await db.select().from(abmAlerts)
      .where(eq(abmAlerts.organizationId, dbUser.organizationId))
      .orderBy(desc(abmAlerts.sentAt))
      .limit(15)
    : []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ABM Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload accounts of interest and get alerts when matched visitors engage.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Bulk Upload (CSV)</h2>
        <p className="text-xs text-muted-foreground">Format: account_name,domain,priority,owner_email,notes</p>
        <form action={importAbmCsv} className="space-y-3">
          <Textarea name="csv" rows={6} placeholder={`Acme Corp,acme.com,high,owner@company.com,Strategic account`} />
          <Button type="submit">Import CSV</Button>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Add Account</h2>
        <form action={addAbmAccount} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Account name</Label>
            <Input name="accountName" required />
          </div>
          <div className="space-y-1.5">
            <Label>Domains</Label>
            <Input name="domains" placeholder="acme.com, acme.co.uk" required />
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Input name="priority" defaultValue="medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Owner email</Label>
            <Input name="ownerEmail" type="email" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Notes</Label>
            <Input name="notes" />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Add account</Button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ABM accounts yet.</p>
        ) : (
          <AbmAccountsEditor accounts={accounts} />
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Recent ABM Matches</h2>
        <div className="space-y-2">
          {recentMatches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches yet.</p>
          ) : recentMatches.map((m) => (
            <div key={m.id} className="rounded border px-3 py-2 text-sm">
              {m.matchSource} • {m.confidence} • {m.matchedValue}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Recent Alerts</h2>
        <div className="space-y-2">
          {recentAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts sent yet.</p>
          ) : recentAlerts.map((a) => (
            <div key={a.id} className="rounded border px-3 py-2 text-sm">
              {a.triggerType} • {new Date(a.sentAt).toLocaleString()}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
