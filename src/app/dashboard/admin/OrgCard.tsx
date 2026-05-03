'use client'

import { useState } from 'react'
import { Building2, FileText, LayoutDashboard, Users, ChevronDown, ChevronUp, UserPlus, Trash2, Loader2, LogIn } from 'lucide-react'
import { addUserToOrg, removeUserFromOrg, deleteOrganization, impersonateUser } from './actions'
import { useRouter } from 'next/navigation'

type OrgUser = { id: string; email: string; role: string }

type Props = {
  org: {
    id: string
    name: string
    slug: string
    createdAt: Date
    assetCount: number
    trackCount: number
    userCount: number
  }
  orgUsers: OrgUser[]
}

export function OrgCard({ org, orgUsers: initialOrgUsers }: Props) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [members, setMembers] = useState<OrgUser[]>(initialOrgUsers)
  const [userCount, setUserCount] = useState(org.userCount)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'editor'>('editor')
  const [loading, setLoading] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [deletingOrg, setDeletingOrg] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    const res = await addUserToOrg(org.id, email, role)
    setLoading(false)
    if (res.success && res.user) {
      setSuccess(`${email} added to ${org.name}`)
      setEmail('')
      setMembers(prev => {
        // Update role if already in list, otherwise prepend
        const exists = prev.find(u => u.id === res.user!.id)
        if (exists) return prev.map(u => u.id === res.user!.id ? { ...u, role } : u)
        setUserCount(c => c + 1)
        return [...prev, res.user!]
      })
    } else if (!res.success) {
      setError(res.error ?? 'Failed')
    }
  }

  async function handleRemove(userId: string, userEmail: string) {
    if (!confirm(`Remove ${userEmail} from ${org.name}?`)) return
    setRemoving(userId)
    const res = await removeUserFromOrg(userId)
    setRemoving(null)
    if (res.success) {
      setMembers(prev => prev.filter(u => u.id !== userId))
      setUserCount(c => c - 1)
    }
  }

  async function handleDeleteOrg() {
    if (!confirm(`Delete organisation "${org.name}" and all its assets, tracks, users, and leads? This cannot be undone.`)) {
      return
    }
    setDeletingOrg(true)
    setError(null)
    setSuccess(null)
    const res = await deleteOrganization(org.id)
    setDeletingOrg(false)
    if (res.success) {
      setDeleted(true)
    } else {
      setError(res.error ?? 'Failed to delete organisation')
    }
  }

  async function handleImpersonate(userId: string, userEmail: string) {
    if (!confirm(`Login as ${userEmail}?`)) return
    setImpersonating(userId)
    const res = await impersonateUser(userId)
    setImpersonating(null)
    if (res.success) {
      router.push('/dashboard')
      router.refresh()
    } else {
      setError(res.error ?? 'Failed to login as user')
    }
  }

  if (deleted) return null

  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      {/* Header row */}
      <div className="p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{org.name}</p>
            <p className="text-xs text-muted-foreground font-mono">/{org.slug}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(org.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-6">
            <Stat icon={<FileText className="w-3.5 h-3.5" />} label="assets" value={org.assetCount} />
            <Stat icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="tracks" value={org.trackCount} />
            <Stat icon={<Users className="w-3.5 h-3.5" />} label="users" value={userCount} />
          </div>
          <button
            onClick={handleDeleteOrg}
            disabled={deletingOrg}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            title="Delete organisation"
          >
            {deletingOrg
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            title={expanded ? 'Collapse' : 'Manage users'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded: user list + add form */}
      {expanded && (
        <div className="border-t px-5 pb-5 pt-4 space-y-4">

          {/* Current users */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Members</p>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet</p>
            ) : (
              <ul className="space-y-1.5">
                {members.map(u => (
                  <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">{u.role}</p>
                    </div>
                    <button
                      onClick={() => handleRemove(u.id, u.email)}
                      disabled={removing === u.id}
                      className="shrink-0 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Remove from org"
                    >
                      {removing === u.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleImpersonate(u.id, u.email)}
                      disabled={impersonating === u.id}
                      className="shrink-0 p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                      title="Login as this user"
                    >
                      {impersonating === u.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <LogIn className="w-3.5 h-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add user form */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Add existing user</p>
            <form onSubmit={handleAdd} className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full h-9 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
              <select
                value={role}
                onChange={e => setRole(e.target.value as 'admin' | 'editor')}
                disabled={loading}
                className="h-9 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              >
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={loading}
                className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Add
              </button>
            </form>
            {error && <p className="text-xs text-destructive mt-2">{error}</p>}
            {success && <p className="text-xs text-green-600 mt-2">{success}</p>}
            <p className="text-xs text-muted-foreground mt-2">
              The user must have already signed up. Adding them here moves them into this org.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center w-14">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-bold leading-none">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
