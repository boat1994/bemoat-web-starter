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

export function parseArgvBoundary(argv: unknown): string[] | null {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    return null
  }
  return argv
}
