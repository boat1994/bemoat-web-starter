export function flattenGhPages(value) {
  return Array.isArray(value)
    ? value.flat(Infinity).filter((entry) => entry && typeof entry === 'object')
    : []
}
