// Utilities for system prompt HTML <-> plain text conversion.
// System prompts are stored as HTML in the editor, but the AI receives plain text.

/** Convert legacy markdown-formatted system prompts to HTML for the editor. */
export function markdownToHtml(text: string): string {
  if (!text.trim()) return ''
  // Already HTML — return as-is
  if (/<[a-z][\s\S]*>/i.test(text)) return text

  const lines = text.split('\n')
  const out: string[] = []
  let inList = false

  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<p><br></p>')
      continue
    }
    if (t.startsWith('### ')) { closeList(); out.push(`<h3>${inline(t.slice(4))}</h3>`); continue }
    if (t.startsWith('## '))  { closeList(); out.push(`<h2>${inline(t.slice(3))}</h2>`); continue }
    if (t.startsWith('# '))   { closeList(); out.push(`<h2>${inline(t.slice(2))}</h2>`); continue }
    if (/^[-*] /.test(t)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(t.slice(2))}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(t)}</p>`)
  }
  closeList()
  return out.join('')

  function closeList() { if (inList) { out.push('</ul>'); inList = false } }
}

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

/**
 * Convert editor HTML → plain text suitable for AI system prompts.
 * Headings get a blank line, lists get bullet markers; bold/italic are stripped.
 */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  // No HTML tags → already plain text / markdown, return as-is
  if (!/<[a-z][\s\S]*>/i.test(html)) return html

  return html
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/?ul[^>]*>/gi, '\n')
    .replace(/<\/?ol[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
