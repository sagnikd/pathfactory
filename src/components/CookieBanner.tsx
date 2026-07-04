'use client'

import { useState, useEffect } from 'react'

const CONSENT_KEY = 'cookie_consent_v1'
const CONSENT_COOKIE = 'cookie_consent'
const CONSENT_TTL_MS = 1000 * 60 * 60 * 24 * 30 * 6 // 6 months
const CONSENT_TTL_SECONDS = CONSENT_TTL_MS / 1000

// Written as a real cookie (not just localStorage) so middleware.ts can read
// it server-side and skip setting the visitorId tracking cookie on rejection.
function setConsentCookie(value: 'accepted' | 'rejected') {
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${CONSENT_TTL_SECONDS}; SameSite=Lax`
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const acceptedAt = Number(localStorage.getItem(CONSENT_KEY) ?? 0)
    const expired = !acceptedAt || Date.now() - acceptedAt > CONSENT_TTL_MS
    if (expired) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem(CONSENT_KEY, String(Date.now()))
    setConsentCookie('accepted')
    setVisible(false)
  }

  function reject() {
    localStorage.setItem(CONSENT_KEY, String(Date.now()))
    setConsentCookie('rejected')
    // Remove the non-essential tracking cookie immediately rather than
    // waiting for it to expire naturally.
    document.cookie = 'visitorId=; path=/; max-age=0'
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur shadow-lg px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="text-xs text-muted-foreground flex-1">
          We use cookies for the best user experience on our website, including to personalize content &amp; offerings,
          to provide social media features and to analyze traffic. By clicking &ldquo;Accept All Cookies&rdquo; you agree
          to our use of cookies. You can also manage your cookies by clicking on the &ldquo;Cookie Preferences&rdquo; and
          selecting the categories you would like to accept. For more information on how we use cookies please visit our{' '}
          <a
            href="https://www.hcl-software.com/legal/cookie-disclosure"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Cookie Statement
          </a>{' '}
          and{' '}
          <a
            href="https://www.hcl-software.com/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Privacy Statement
          </a>
          .
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://www.hcl-software.com/legal/cookie-disclosure"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold underline hover:text-foreground text-muted-foreground"
          >
            Cookie Settings
          </a>
          <button
            onClick={reject}
            className="rounded px-4 py-2 text-xs font-semibold border bg-background text-foreground hover:bg-muted transition-colors"
          >
            Reject All
          </button>
          <button
            onClick={accept}
            className="rounded px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Accept All Cookies
          </button>
        </div>
      </div>
    </div>
  )
}
