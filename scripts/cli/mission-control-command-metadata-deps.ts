export type CommandMetadataDependencies = {
  contract: <T extends Record<string, unknown>>(value: T) => T
  positional: (
    name: string,
    syntax: string,
    value_type: string,
    description: string,
  ) => Record<string, unknown>
  stdinInput: (name: string, description: string) => Record<string, unknown>
  flag: (
    name: string,
    syntax: string,
    value_type: string,
    description: string,
    values?: string[],
    required?: boolean,
  ) => Record<string, unknown>
  environment: (
    name: string,
    value_type: string,
    description: string,
    values?: string[],
  ) => Record<string, unknown>
  nextAction: (
    type: string,
    command: string | null,
    reason: string,
  ) => { type: string; command: string | null; reason: string }
}
