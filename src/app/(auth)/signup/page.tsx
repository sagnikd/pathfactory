import { signup } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { Layers } from 'lucide-react'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <div className="flex h-screen w-full">
      {/* Left branded panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(135deg, oklch(0.49 0.22 264.05) 0%, oklch(0.38 0.2 290) 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-semibold text-xl tracking-tight">PathFactory</span>
        </div>
        <div className="space-y-6">
          <blockquote className="text-white/90 text-2xl font-light leading-relaxed">
            Your content deserves to be experienced, not just downloaded.
          </blockquote>
          <ul className="space-y-2 text-white/70 text-sm">
            <li className="flex items-center gap-2"><span className="text-white">✓</span> Build binge-worthy content tracks</li>
            <li className="flex items-center gap-2"><span className="text-white">✓</span> Gate assets with smart forms</li>
            <li className="flex items-center gap-2"><span className="text-white">✓</span> Measure every scroll & click</li>
          </ul>
        </div>
        <p className="text-white/40 text-xs">© 2025 PathFactory Clone</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-8 bg-background">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
              <Layers className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-xl tracking-tight">PathFactory</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Create an account</h1>
            <p className="text-muted-foreground">Set up your workspace in under a minute</p>
          </div>

          <form action={signup} className="space-y-4">
            {params?.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {params.error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="orgName" className="text-sm font-medium">Organization name</Label>
              <Input
                id="orgName"
                name="orgName"
                placeholder="Acme Corp"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Min 6 characters"
                required
                minLength={6}
                className="h-11"
              />
            </div>
            <Button type="submit" className="w-full h-11 text-base font-medium mt-2">
              Get started
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
