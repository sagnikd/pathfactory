import { db } from '@/db'
import { organizations, webhooks } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Settings, Globe, Webhook, Trash2 } from 'lucide-react'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

async function updateOrgName(formData: FormData) {
  'use server'
  const orgId = formData.get('orgId') as string
  const name = formData.get('name') as string
  if (!name?.trim()) return
  await db.update(organizations).set({ name: name.trim() }).where(eq(organizations.id, orgId))
  revalidatePath('/dashboard/settings')
}

async function addWebhook(formData: FormData) {
  'use server'
  const orgId = formData.get('orgId') as string
  const url = formData.get('url') as string
  if (!url?.trim()) return
  const secret = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
  await db.insert(webhooks).values({
    organizationId: orgId,
    url: url.trim(),
    secret,
    events: ['lead.created', 'session.started'],
  })
  revalidatePath('/dashboard/settings')
}

async function removeWebhook(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  await db.delete(webhooks).where(eq(webhooks.id, id))
  revalidatePath('/dashboard/settings')
}

export default async function SettingsPage() {
  const { dbUser } = await getDashboardAuthContext()

  const [org] = await db.select().from(organizations).where(eq(organizations.id, dbUser.organizationId))
  const orgWebhooks = await db.select().from(webhooks).where(eq(webhooks.organizationId, dbUser.organizationId))

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your workspace and integrations</p>
      </div>

      {/* Organization */}
      <section className="rounded-xl border bg-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <Globe className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Organization</h2>
            <p className="text-xs text-muted-foreground">Your workspace details</p>
          </div>
        </div>
        <form action={updateOrgName} className="space-y-4">
          <input type="hidden" name="orgId" value={org.id} />
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input id="org-name" name="name" defaultValue={org.name} className="max-w-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Organization slug</Label>
            <code className="block text-sm bg-muted px-3 py-2 rounded-lg text-muted-foreground max-w-sm">
              {org.slug}
            </code>
          </div>
          <Button type="submit" size="sm">Save name</Button>
        </form>
      </section>

      {/* Account */}
      <section className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <Settings className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Account</h2>
            <p className="text-xs text-muted-foreground">Your user details</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{dbUser.email}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-muted-foreground">Role</span>
            <span className="text-sm font-medium capitalize">{dbUser.role}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">Member since</span>
            <span className="text-sm font-medium">
              {new Date(dbUser.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </section>

      {/* Webhooks */}
      <section className="rounded-xl border bg-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <Webhook className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Webhooks</h2>
            <p className="text-xs text-muted-foreground">Get notified when leads are captured or sessions start</p>
          </div>
        </div>

        {orgWebhooks.length > 0 && (
          <div className="space-y-2">
            {orgWebhooks.map((wh) => (
              <div key={wh.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{wh.url}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Secret: <code className="font-mono">{wh.secret.substring(0, 12)}…</code>
                  </p>
                </div>
                <form action={removeWebhook}>
                  <input type="hidden" name="id" value={wh.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={addWebhook} className="flex gap-2">
          <input type="hidden" name="orgId" value={org.id} />
          <Input name="url" type="url" placeholder="https://your-endpoint.com/webhook" className="flex-1" />
          <Button type="submit" size="sm" className="shrink-0">Add webhook</Button>
        </form>
      </section>
    </div>
  )
}
