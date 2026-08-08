const TERMINAL_BINDING_KEYS = [
  'state',
  'active_task_issue',
  'active_pr',
  'current_head',
  'last_reviewed_head',
]

export function sameTerminalBinding(left, right) {
  return TERMINAL_BINDING_KEYS.every((key) => left?.[key] === right?.[key])
}
