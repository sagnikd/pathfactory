'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ListFilter } from 'lucide-react'

const ALL_TRACKS = '__all__'

export function TrackFilter({ tracks }: { tracks: { id: string; title: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const trackId = searchParams.get('trackId') ?? ALL_TRACKS

  // Select.Value only shows a real label when Select.Root knows about an
  // `items` map — without it, it falls back to rendering the raw `value`.
  const items = { [ALL_TRACKS]: 'All tracks', ...Object.fromEntries(tracks.map(t => [t.id, t.title])) }

  function push(value: string | null) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value && value !== ALL_TRACKS) sp.set('trackId', value)
    else sp.delete('trackId')
    router.push(`${pathname}?${sp.toString()}`)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-1.5">
      <ListFilter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <Select items={items} value={trackId} onValueChange={(v) => push(v)}>
        <SelectTrigger className="h-8 w-[200px] text-xs">
          <SelectValue placeholder="All tracks" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TRACKS}>All tracks</SelectItem>
          {tracks.map(t => (
            <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
