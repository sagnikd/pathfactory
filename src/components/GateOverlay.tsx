'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles } from 'lucide-react'
import { clientGeoLookup } from '@/lib/geoLookup'

export type LeadField = {
  name: string
  label: string
  type: 'email' | 'text' | 'tel'
  enabled: boolean
  required: boolean
}

export type GateConfig = {
  enabled: boolean
  delaySeconds: number   // 0 = hard gate (block content); >0 = timed pop-up over visible content
  heading: string
  description: string
  fields: LeadField[]
}

// Which field names we know how to pre-fill from IP data
const IP_FIELD_MAP: Record<string, keyof IpData> = {
  company: 'company',
  country: 'country',
  city:    'city',
}

type IpData = { company: string; country: string; city: string }

/**
 * Patterns that indicate a telecom operator, ISP, mobile carrier, or cloud/hosting
 * provider — i.e. the detected "org" is the network the visitor is on, NOT their
 * employer.  In these cases we leave the Company field blank rather than polluting
 * it with "Airtel" or "Comcast".
 */
const TELECOM_PATTERNS: RegExp[] = [
  // Generic service-type words
  /\btelecom(munication)?s?\b/i,
  /\b(mobile|wireless|cellular)\b/i,
  /\bbroadband\b/i,
  /\b(internet\s+service|isp)\b/i,
  /\bcable\b/i,
  /\bfi(re|b)r(e|e)\b/i,            // fibre / fiber
  /\b(network|networking)\b/i,
  /\bcommunications?\b/i,
  /\b(lte|dsl|fios|xfinity)\b/i,
  /\bcarrier\b/i,
  /\btelco\b/i,
  // Major global carriers / ISPs (partial match is intentional)
  /\b(comcast|xfinity)\b/i,
  /\bverizon\b/i,
  /\bat&t\b/i,
  /\bt-?mobile\b/i,
  /\bsprint\b/i,
  /\b(spectrum|charter)\b/i,
  /\bcox\s+(communications|cable)?\b/i,
  /\bairtel\b/i,
  /\bjio\b/i,
  /\bvodafone\b/i,
  /\bbsnl\b/i,
  /\breliance\s+(jio|communications)\b/i,
  /\bbt\s+(group|plc)?\b/i,
  /\bsky\s+broadband\b/i,
  /\bvirgin\s+media\b/i,
  /\btalktalk\b/i,
  /\bdeutsche\s+telekom\b/i,
  /\btelef[oó]nica\b/i,
  /\borange\b/i,
  /\bsfr\b/i,
  /\bbouygues\s+telecom\b/i,
  /\bsingtel\b/i,
  /\btelstra\b/i,
  /\boptus\b/i,
  /\bntt\b/i,
  /\bsoftbank\b/i,
  /\bkddi\b/i,
  /\bchina\s+(telecom|mobile|unicom)\b/i,
  /\bzayo\b/i,
  /\blevel\s+3\b/i,
  /\bcogent\b/i,
  /\bhurricane\s+electric\b/i,
  /\bcenturylink\b/i,
  /\blumen\b/i,
  /\bfrontier\s+communications\b/i,
  // Cloud / hosting providers (also not the visitor's employer)
  /\bamazon(\s+(web\s+services|aws))?\b/i,
  /\bgoogle(\s+(cloud|fiber))?\b/i,
  /\bmicrosoft(\s+azure)?\b/i,
  /\bdigital\s*ocean\b/i,
  /\bcloudflare\b/i,
  /\bhetzner\b/i,
  /\bovh\b/i,
  /\blinode\b/i,
  /\bvultr\b/i,
  /\bhosting\b/i,
  /\bdatacenter\b/i,
  /\bdata\s+center\b/i,
  /\bcolocation\b/i,
]

function isTelecomOrISP(org: string): boolean {
  return TELECOM_PATTERNS.some(p => p.test(org))
}

/** Field pairs that should share a row when both are present and enabled */
const FIELD_PAIRS: [string, string][] = [
  ['firstName', 'lastName'],
  ['city', 'country'],
]

function FieldInput({
  field,
  value,
  autoFilled,
  onChange,
}: {
  field: LeadField
  value: string
  autoFilled: boolean
  onChange: (val: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={field.name}>
          {field.label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {autoFilled && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-0.5">
            <Sparkles className="w-2.5 h-2.5" />
            detected
          </span>
        )}
      </div>
      <Input
        id={field.name}
        type={field.type}
        required={field.required}
        placeholder={field.type === 'email' ? 'you@company.com' : ''}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={autoFilled ? 'border-primary/40 bg-primary/5' : ''}
      />
    </div>
  )
}

function renderFieldGroups(
  fields: LeadField[],
  values: Record<string, string>,
  autoFilled: Set<string>,
  onChange: (name: string, val: string) => void,
) {
  const fieldMap = new Map(fields.map(f => [f.name, f]))
  const rendered = new Set<string>()
  const out: React.ReactNode[] = []

  for (const field of fields) {
    if (rendered.has(field.name)) continue

    // Find which canonical pair this field belongs to (either position)
    const pair = FIELD_PAIRS.find(([a, b]) => a === field.name || b === field.name)

    if (pair) {
      const [canonA, canonB] = pair
      const fieldA = fieldMap.get(canonA)
      const fieldB = fieldMap.get(canonB)

      // Only render the pair when we encounter the canonical-first field,
      // and only if both fields are actually in the active list.
      if (field.name === canonA && fieldA && fieldB) {
        rendered.add(canonA)
        rendered.add(canonB)
        out.push(
          <div key={`${canonA}+${canonB}`} className="grid grid-cols-2 gap-3">
            <FieldInput field={fieldA} value={values[canonA] ?? ''} autoFilled={autoFilled.has(canonA)} onChange={v => onChange(canonA, v)} />
            <FieldInput field={fieldB} value={values[canonB] ?? ''} autoFilled={autoFilled.has(canonB)} onChange={v => onChange(canonB, v)} />
          </div>
        )
        continue
      }

      // This field is the canonical-second; skip — it will be rendered above
      // when the canonical-first is processed.
      if (field.name === canonB && fieldA) {
        rendered.add(canonB)
        // Don't push anything — fieldA's iteration will emit both together
        continue
      }
    }

    // No pair match (or partner not present) — render full width
    rendered.add(field.name)
    out.push(
      <FieldInput
        key={field.name}
        field={field}
        value={values[field.name] ?? ''}
        autoFilled={autoFilled.has(field.name)}
        onChange={v => onChange(field.name, v)}
      />
    )
  }

  return out
}

async function fetchIpData(): Promise<Partial<IpData>> {
  // clientGeoLookup already filters telecom/ISP companies to null
  const geo = await clientGeoLookup()
  return {
    company: geo.company ?? '',
    country: geo.country ?? '',
    city:    geo.city    ?? '',
  }
}

type Props = {
  trackId: string
  visitorId: string | null
  gateConfig: GateConfig | null
  bypassGate?: boolean
  onUnlock?: () => void
  onSubmit?: (fields: Record<string, string>) => void  // fired with form values on first submission
  children: React.ReactNode
}

export function GateOverlay({ trackId, visitorId, gateConfig, bypassGate = false, onUnlock, onSubmit, children }: Props) {
  const enabled      = gateConfig?.enabled ?? false
  const delaySeconds = gateConfig?.delaySeconds ?? 0
  const isHardGate   = delaySeconds === 0

  const [submitted,  setSubmitted]  = useState(false)
  const [showForm,   setShowForm]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [ipLoading,  setIpLoading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [values,     setValues]     = useState<Record<string, string>>({})
  // Track which fields were auto-filled so we can show the badge
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set())
  // Bump this to force React to remount the overlay div if DevTools removes it
  const [renderKey,  setRenderKey]  = useState(0)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // ── notify parent when gate is cleared ──────────────────────────────────
  useEffect(() => {
    if (submitted) onUnlock?.()
  }, [submitted]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── gate timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || bypassGate) return
    if (localStorage.getItem(`unlocked_${trackId}`) === 'true') {
      setSubmitted(true)
      return
    }
    if (delaySeconds === 0) {
      setShowForm(true)
    } else {
      timerRef.current = setTimeout(() => setShowForm(true), delaySeconds * 1000)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [enabled, bypassGate, trackId, delaySeconds])

  // ── IP reverse-lookup once the form becomes visible ─────────────────────
  useEffect(() => {
    if (!showForm) return
    setIpLoading(true)
    fetchIpData().then(ipData => {
      setIpLoading(false)
      if (!ipData || Object.keys(ipData).length === 0) return

      const newValues: Record<string, string> = {}
      const newAutoFilled = new Set<string>()

      const activeFields = (gateConfig?.fields ?? []).filter(f => f.enabled)
      for (const field of activeFields) {
        const ipKey = IP_FIELD_MAP[field.name]
        if (!ipKey) continue
        const detected = ipData[ipKey]
        if (detected) {
          newValues[field.name] = detected
          newAutoFilled.add(field.name)
        }
      }

      if (Object.keys(newValues).length > 0) {
        setValues(prev => {
          // Only fill fields the user hasn't already typed in
          const merged: Record<string, string> = { ...prev }
          for (const [k, v] of Object.entries(newValues)) {
            if (!merged[k]) merged[k] = v
          }
          return merged
        })
        setAutoFilled(newAutoFilled)
      }
    })
  }, [showForm]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── DOM tamper protection ────────────────────────────────────────────────
  // If someone deletes the overlay node via DevTools, detect it and force React
  // to remount it. Background content is also pointer-events:none while the form
  // is active so there's nothing to click even if the node is briefly absent.
  const revive = useCallback(() => {
    if (!overlayRef.current || !document.documentElement.contains(overlayRef.current)) {
      setRenderKey(k => k + 1)
    }
  }, [])

  useEffect(() => {
    if (!showForm || submitted) return
    const mo = new MutationObserver(revive)
    mo.observe(document.documentElement, { childList: true, subtree: true })
    const iv = setInterval(revive, 300)
    return () => { mo.disconnect(); clearInterval(iv) }
  }, [showForm, submitted, revive])
  // ────────────────────────────────────────────────────────────────────────

  // ── helpers ─────────────────────────────────────────────────────────────
  const activeFields = (gateConfig?.fields ?? []).filter(f => f.enabled)

  function handleChange(name: string, val: string) {
    setValues(prev => ({ ...prev, [name]: val }))
    // User edited → remove auto-fill badge
    setAutoFilled(prev => { const s = new Set(prev); s.delete(name); return s })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, visitorId, fields: values }),
      })
      if (res.ok) {
        localStorage.setItem(`unlocked_${trackId}`, 'true')
        setSubmitted(true)
        setShowForm(false)
        onSubmit?.(values)
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Could not submit. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  if (!enabled || bypassGate || submitted) return <>{children}</>

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Content layer — pointer-events:none whenever form is active so content
          stays unclickable even if the overlay node is briefly removed from DOM */}
      <div
        className={[
          'absolute inset-0',
          showForm ? 'pointer-events-none select-none' : '',
          isHardGate && showForm ? 'filter blur-sm opacity-25' : '',
        ].join(' ')}
      >
        {children}
      </div>

      {/* Lead-capture modal — fixed + z-[9999] so it covers the full viewport
          and can't be hidden by a parent's overflow:hidden.
          key={renderKey} forces a remount if DevTools deletes the node. */}
      {showForm && (
        <div
          ref={overlayRef}
          key={renderKey}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
        >
          <Card className="w-full max-w-md shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-xl">
                    {gateConfig?.heading || 'Continue reading'}
                  </CardTitle>
                  {gateConfig?.description && (
                    <CardDescription className="mt-1">{gateConfig.description}</CardDescription>
                  )}
                </div>
                {ipLoading && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0 mt-1">
                    <Sparkles className="w-3 h-3 animate-pulse" />
                    Detecting…
                  </span>
                )}
                {!ipLoading && autoFilled.size > 0 && (
                  <span className="text-xs text-primary flex items-center gap-1 shrink-0 mt-1">
                    <Sparkles className="w-3 h-3" />
                    Auto-filled
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {activeFields.length === 0 ? (
                  // Fallback — always show email at minimum
                  <div className="space-y-1.5">
                    <Label htmlFor="email">
                      Work email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      placeholder="you@company.com"
                      value={values['email'] ?? ''}
                      onChange={e => handleChange('email', e.target.value)}
                    />
                  </div>
                ) : (
                  renderFieldGroups(activeFields, values, autoFilled, handleChange)
                )}

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Submitting…' : 'Continue →'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
