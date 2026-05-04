'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EditableSettingsSection({
  title,
  description,
  preview,
  children,
}: {
  title: string
  description?: string
  preview?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground mt-0.5">{description}</p> : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>

      {!open && preview ? (
        <div className="text-sm text-muted-foreground">
          {preview}
        </div>
      ) : null}

      {open ? <div className="pt-1">{children}</div> : null}
    </section>
  )
}
