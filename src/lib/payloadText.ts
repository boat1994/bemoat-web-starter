export function pickText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const candidate = record.th || record.en || Object.values(record)[0]
    if (typeof candidate === 'string') return candidate
  }

  return fallback
}

export function pickRichTextPlain(value: unknown, fallback = '') {
  if (!value || typeof value !== 'object') return fallback

  const root = value as { root?: { children?: Array<{ children?: Array<{ text?: string }> }> } }
  const text = root.root?.children
    ?.flatMap((node) => node.children || [])
    .map((child) => child.text)
    .filter(Boolean)
    .join(' ')

  return text || fallback
}
