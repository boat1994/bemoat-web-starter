export function violation(rule, file, message) {
  return { type: 'mission-control-contract', rule, file, message }
}
