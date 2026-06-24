'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FileText, LayoutDashboard, Settings, Layers, BarChart2, Users, ShieldCheck, LogOut, PanelsTopLeft, Building2, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { stopImpersonation } from '@/app/dashboard/admin/actions'

const navItems = [
  { href: '/dashboard/assets', label: 'Asset Library', icon: FileText },
  { href: '/dashboard/tracks', label: 'Tracks', icon: LayoutDashboard },
  { href: '/dashboard/experiences', label: 'Experiences', icon: PanelsTopLeft },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/chats', label: 'Chats', icon: MessageSquare },
  { href: '/dashboard/abm', label: 'ABM Accounts', icon: Building2 },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
]

export function NavSidebar({
  isSuperAdmin = false,
  isImpersonating = false,
}: {
  isSuperAdmin?: boolean
  isImpersonating?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleStopImpersonation() {
    await stopImpersonation()
    router.refresh()
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col border-r bg-background sm:flex">
      <div className="flex h-14 items-center border-b px-5 lg:h-[60px]">
        <Link href="/dashboard" className="flex items-center gap-2.5 font-semibold">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
            <Layers className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="tracking-tight text-sm">Content Engagement Platform</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="grid gap-0.5 px-3">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
      {isSuperAdmin && (
        <div className="px-3 pb-2">
          <Link
            href="/dashboard/admin"
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/dashboard/admin')
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Admin
          </Link>
        </div>
      )}
      <div className="border-t px-3 py-3 space-y-1">
        {isSuperAdmin && isImpersonating && (
          <button
            onClick={handleStopImpersonation}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Stop Impersonating
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Log out
        </button>
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Content Engagement Platform
        </div>
      </div>
    </aside>
  )
}
