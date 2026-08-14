import { z } from 'zod'

export const POSITIVE_INTEGER_RE = /^[1-9]\d*$/
export const REPOSITORY_RE = /^[^/\s:]+\/[^/\s:]+$/
export const FULL_SHA_RE = /^[0-9a-f]{40}$/i
export const HELP_ARGUMENTS = new Set(['--help', '-h'])
export const JSON_ARGUMENT = '--json'
export const EXCLUSIVE_INPUTS = [
  ['harness_only', 'full'],
] as const

export type CommandInputValueType =
  | 'positive_integer'
  | 'repository'
  | 'full_sha'
  | 'enum'
  | 'path'
  | 'string'
  | 'boolean'

export type CommandInput = {
  name: string
  syntax?: string
  kind: 'flag' | 'positional' | 'stdin' | string
  value_type: CommandInputValueType | string
  required?: boolean
  source: string
  multiple?: boolean
  values?: string[]
  description?: string
}

export type CommandContract = {
  command: string
  entrypoint: string
  required_inputs?: CommandInput[]
  optional_flags?: CommandInput[]
  [key: string]: unknown
}

export type ParsedInvocation =
  | {
      mode: 'help'
      format: 'text' | 'json'
      contract: CommandContract
    }
  | {
      mode: 'run'
      format: 'text' | 'json'
      values: Record<string, string | boolean>
      contract: CommandContract
    }

function isEnvLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const argvBoundarySchema = z.array(z.string())

export function parseArgvBoundary(argv: unknown): string[] | null {
  const result = argvBoundarySchema.safeParse(argv)
  return result.success ? result.data : null
}

export const resolveCommandIdentityInputSchema = z.object({
  fallback: z.unknown(),
  env: z.record(z.string(), z.unknown()).optional(),
  entrypoint: z.unknown().optional(),
})

export type ResolveCommandIdentityInput = z.infer<typeof resolveCommandIdentityInputSchema>

export function parseResolveCommandIdentityInput(input: unknown): ResolveCommandIdentityInput {
  const result = resolveCommandIdentityInputSchema.safeParse(input)
  if (!result.success) {
    if (isEnvLike(input)) {
      return {
        fallback: input.fallback,
        env: isEnvLike(input.env) ? input.env : undefined,
        entrypoint: input.entrypoint,
      }
    }
    return { fallback: undefined }
  }
  return result.data
}

export const parseCommandInvocationBoundarySchema = z.object({
  command: z.unknown(),
  argv: z.unknown().optional(),
})

export type ParseCommandInvocationBoundary = z.infer<typeof parseCommandInvocationBoundarySchema>

export function parseCommandInvocationBoundary(
  command: unknown,
  argv: unknown = [],
): ParseCommandInvocationBoundary {
  return parseCommandInvocationBoundarySchema.parse({ command, argv })
}
