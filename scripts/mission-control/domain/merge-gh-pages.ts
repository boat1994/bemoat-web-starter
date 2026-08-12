export function flattenGhPages(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flat(Infinity).filter((entry): entry is Record<string, unknown> => (
      Boolean(entry) && typeof entry === 'object'
    ))
    : []
}
