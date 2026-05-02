'use client'

import fpPromise from '@fingerprintjs/fingerprintjs'

export async function getVisitorFingerprint(): Promise<string> {
  const fp = await fpPromise.load()
  const result = await fp.get()
  return result.visitorId
}
