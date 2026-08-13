import { createHash } from 'node:crypto'

export function stableStringify(value: object): string
export function stableStringify(value: unknown): string | undefined
export function stableStringify(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }

  const keys = Object.keys(value).sort()
  return `{${keys
    .map((key) => {
      const propertyValue: unknown = Reflect.get(value, key)
      return `${JSON.stringify(key)}:${stableStringify(propertyValue)}`
    })
    .join(',')}}`
}

export function fingerprintCorrectionContract(contract: object): string {
  return createHash('sha256').update(stableStringify(contract), 'utf8').digest('hex')
}

export function hashExactBody(body: unknown): string {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex')
}
