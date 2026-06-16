/**
 * Detect Payload CMS init during production Next.js / OpenNext builds.
 *
 * Child projects with custom `src/payload.config.ts` should import this helper
 * (from starter seed) or copy equivalent checks — sync does not overwrite
 * child-owned payload config. See docs/boilerplate-sync-command.md.
 */
type PayloadBuildContextEnv = Record<string, string | undefined>

export function isPayloadBuildContext(
  env: PayloadBuildContextEnv = process.env,
  argv: string[] = process.argv,
): boolean {
  const npmLifecycleEvent = env.npm_lifecycle_event ?? ''

  return (
    npmLifecycleEvent === 'build' ||
    npmLifecycleEvent === 'build:next' ||
    env.BEMOAT_BUILD_CONTEXT === 'opennext-next-build' ||
    env.NEXT_PHASE === 'phase-production-build' ||
    argv.some((value) => /build$/.test(value))
  )
}
