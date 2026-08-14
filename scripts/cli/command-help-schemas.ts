import { z } from 'zod'

export const helpContractInputSchema = z.looseObject({
  command: z.unknown().optional(),
})

export type HelpContractInput = z.infer<typeof helpContractInputSchema>

export function parseHelpContractInput(input: unknown): HelpContractInput {
  const result = helpContractInputSchema.safeParse(input)
  if (!result.success) {
    return input as HelpContractInput
  }
  return result.data
}

export const commandHelpArgvSchema = z.array(z.string())

export function parseCommandHelpArgv(argv: unknown): string[] {
  const result = commandHelpArgvSchema.safeParse(argv)
  if (!result.success) {
    return argv as string[]
  }
  return result.data
}

export const facadeIdentityEnvSchema = z.record(
  z.string(),
  z.union([z.string(), z.undefined()]),
)

export function parseFacadeIdentityEnv(
  env: unknown,
): Record<string, string | undefined> {
  const result = facadeIdentityEnvSchema.safeParse(env)
  if (!result.success) {
    return env as Record<string, string | undefined>
  }
  return result.data
}
