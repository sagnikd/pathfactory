const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de',
  'live.com', 'live.co.uk', 'live.in', 'live.fr',
  'outlook.com', 'outlook.co.uk', 'outlook.in',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'msn.com',
  'protonmail.com', 'proton.me',
  'tutanota.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de',
  'mail.com',
  'inbox.com',
  'rediffmail.com',
])

export function isPersonalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return false
  return PERSONAL_DOMAINS.has(domain)
}
