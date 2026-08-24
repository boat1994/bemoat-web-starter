const POSITIVE_INTEGER = /^[1-9]\d*$/

export class ContextInvocationError extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'ContextInvocationError'
    this.classification = 'INVALID_INVOCATION'
    this.exit_code = 2
  }
}

export function parseContextInvocation(argv) {
  const tokens = Array.isArray(argv) ? argv.filter((value) => value !== '--') : []
  const help = tokens.filter((value) => value === '--help' || value === '-h')
  const json = tokens.filter((value) => value === '--json')
  if (help.length > 1) throw new ContextInvocationError('help may be provided only once')
  if (json.length > 1) throw new ContextInvocationError('--json may be provided only once')
  if (help.length > 0) return { mode: 'help', format: json.length > 0 ? 'json' : 'text' }

  const positional = tokens.filter((value) => value !== '--json')
  if (positional.length !== 1) throw new ContextInvocationError('one positive Issue number is required')
  if (!POSITIVE_INTEGER.test(positional[0])) throw new ContextInvocationError('Issue number must be a positive integer')
  return { mode: 'run', format: json.length > 0 ? 'json' : 'text', issueNumber: String(BigInt(positional[0])) }
}

export function renderContextHelp(format = 'text') {
  if (format === 'json') {
    return JSON.stringify({
      schema_version: 1,
      command: 'bemoat:context',
      mode: 'help',
      classification: 'HELP',
      tier: 'B',
      purpose: 'Reconstruct deterministic bounded task context without mutation.',
      required_inputs: [{ name: 'issue_number', syntax: '<issue-number>', kind: 'positional', value_type: 'positive_integer', required: true, source: 'caller', multiple: false, values: [], description: 'Issue number to reconstruct.' }],
      optional_flags: [{ name: 'json', syntax: '--json', kind: 'flag', value_type: 'boolean', required: false, source: 'caller', multiple: false, values: [], description: 'Emit deterministic machine-readable context output.' }],
      reads: ['local Git refs, status, branch, upstream, and origin identity', 'GitHub repository, protected base, policy, Issue, comments, PR, checks, reviews, and protection'],
      writes: [],
      result_classifications: ['SUCCESS', 'BLOCKED_EXTERNAL', 'EVIDENCE_CONFLICT'],
      stop_classifications: ['INVALID_INVOCATION', 'BLOCKED_EXTERNAL', 'EVIDENCE_CONFLICT', 'INTERNAL_ERROR'],
      next_action_rules: [
        { classification: 'SUCCESS', next_action: { type: 'COMPLETE', command: null, reason: 'The context was reconstructed without mutation.' } },
        { classification: 'BLOCKED_EXTERNAL', next_action: { type: 'STOP', command: null, reason: 'Required external evidence is unavailable.' } },
        { classification: 'EVIDENCE_CONFLICT', next_action: { type: 'STOP', command: null, reason: 'Required evidence is contradictory or ambiguous.' } },
      ],
    }) + '\n'
  }
  return [
    'HELP: bemoat:context',
    'Usage: pnpm run bemoat:context -- <issue-number> [--json]',
    'Purpose: Reconstruct deterministic bounded task context without mutation.',
    'Writes: none',
    'Safe help invocation: pnpm run bemoat:context -- --help --json',
    '',
  ].join('\n')
}
