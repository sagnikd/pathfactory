'use client'

import { useState, useEffect } from 'react'

const CONSENT_KEY = 'cookie_consent_v1'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem(CONSENT_KEY, 'accepted')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur shadow-lg px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="text-xs text-muted-foreground flex-1">
          We use cookies to personalize your experience and analyze site usage.
          By clicking &ldquo;Accept All Cookies&rdquo; you agree to the storing of cookies on your device.
          For more information see the{' '}
          <a
            href="https://www.hcl-software.com/statement/cookie-statement"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Cookie Statement
          </a>{' '}
          and{' '}
          <a
            href="https://www.hcl-software.com/statement/privacy-statement"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Privacy Statement
          </a>
          .
        </p>
        <div className="flex items-center gap-3 shrink-0">
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
