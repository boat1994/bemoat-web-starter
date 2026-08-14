const TERMINAL_BINDING_KEYS = [
  'state',
  'active_task_issue',
  'active_pr',
  'current_head',
  'last_reviewed_head',
]

type TerminalBinding = Record<string, unknown>

export function sameTerminalBinding(
  left: TerminalBinding | null | undefined,
  right: TerminalBinding | null | undefined,
): boolean {
  return TERMINAL_BINDING_KEYS.every((key) => left?.[key] === right?.[key])
}
