import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NavSidebar } from '@/components/NavSidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      <NavSidebar />
      <div className="flex flex-col flex-1 sm:pl-60">
        <main className="flex-1 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
