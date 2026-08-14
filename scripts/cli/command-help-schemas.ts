import { z } from 'zod'

function isEnvLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIterableValue(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, Symbol.iterator) === 'function'
  )
}

function callLegacyIncludes(argv: unknown, flag: string): boolean {
  const owner =
    argv !== null && typeof argv === 'object' ? argv : Object.create(null)
  const includes = Reflect.get(owner, 'includes')
  return Reflect.apply(includes, owner, [flag]) as boolean
}

function spreadUnknownValue(value: unknown): unknown[] {
  if (isIterableValue(value)) {
    return [...value]
  }
  const iteratorMethod =
    value !== null && typeof value === 'object'
      ? Reflect.get(value, Symbol.iterator)
      : undefined
  Reflect.apply(iteratorMethod, value, [])
  throw new TypeError('value is not iterable')
}

export const helpContractInputSchema = z.looseObject({
  command: z.unknown().optional(),
})

export type HelpContractInput = z.infer<typeof helpContractInputSchema>

export function parseHelpContractInput(input: unknown): HelpContractInput {
  const result = helpContractInputSchema.safeParse(input)
  if (!result.success) {
    if (isEnvLike(input)) {
      return { command: input.command }
    }
    return {}
  }
  return result.data
}

export const commandHelpArgvSchema = z.array(z.string())

export function parseCommandHelpArgv(argv: unknown): string[] | null {
  const result = commandHelpArgvSchema.safeParse(argv)
  if (!result.success) {
    return null
  }
  return result.data
}

export const facadeIdentityEnvSchema = z.record(
  z.string(),
  z.union([z.string(), z.undefined()]),
)

export function parseFacadeIdentityEnv(
  env: unknown,
): Record<string, unknown> {
  const result = facadeIdentityEnvSchema.safeParse(env)
  if (!result.success) {
    if (isEnvLike(env)) {
      return { ...env }
    }
    return {}
  }
  return result.data
}

export function legacyArgvIncludes(argv: unknown, flag: string): boolean {
  const parsed = parseCommandHelpArgv(argv)
  if (parsed !== null) {
    return parsed.includes(flag)
  }
  if (Array.isArray(argv)) {
    return argv.includes(flag)
  }
  if (typeof argv === 'string') {
    return argv.includes(flag)
  }
  return callLegacyIncludes(argv, flag)
}

export function readArgvTokens(argv: unknown): unknown[] {
  const parsed = parseCommandHelpArgv(argv)
  if (parsed !== null) {
    return parsed
  }
  if (Array.isArray(argv)) {
    return argv
  }
  if (typeof argv === 'string') {
    return [...argv]
  }
  return spreadUnknownValue(argv)
}
