import {
  MODULE_SECTION_MAP,
  REQUIRED_BRAINSTORMING_GUIDE_PHRASES,
  REQUIRED_CLI_PROMPT_GUIDE_PHRASES,
  REQUIRED_CORRECTION_GUIDE_PHRASES,
  REQUIRED_COST_AWARE_GUIDE_PHRASES,
  REQUIRED_LEAN_FOUNDER_DECISION_PHRASES,
  REQUIRED_SAFE_BUNDLE_GUIDE_PHRASES,
} from './inventory.mjs'
import { violation } from './violation.mjs'

const REQUIRED_FRONTMATTER_KEYS = [
  'policy_id',
  'version',
  'scope',
  'canonical_repository',
  'max_review_cycles',
]
const SEMVER_RE = /^\d+\.\d+\.\d+$/

export function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  const block = content.slice(4, end)
  const data = {}
  for (const line of block.split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/)
    if (match) data[match[1]] = match[2].trim()
  }
  return data
}

export function scanGuideContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC001', relativePath, 'Canonical Mission Control guide is missing'))
    return violations
  }

  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) {
    violations.push(violation('MC002', relativePath, 'Required frontmatter missing or invalid'))
    return violations
  }

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in frontmatter)) {
      violations.push(violation('MC002', relativePath, `Required frontmatter key missing: ${key}`))
    }
  }

  if (frontmatter.policy_id !== 'bemoat-mission-control') {
    violations.push(violation('MC002', relativePath, 'policy_id must be bemoat-mission-control'))
  }

  if (!SEMVER_RE.test(frontmatter.version ?? '')) {
    violations.push(violation('MC003', relativePath, 'guide version is not valid semver'))
  }

  if (frontmatter.max_review_cycles !== '3') {
    violations.push(violation('MC004', relativePath, 'max_review_cycles is missing or not 3'))
  }

  const sectionMap = MODULE_SECTION_MAP[relativePath]
  if (sectionMap) {
    for (const heading of sectionMap) {
      if (!content.includes(heading)) {
        violations.push(violation('MC005', relativePath, `Required guide section missing: ${heading}`))
      }
    }
  }

  if (!content.includes('<!-- bemoat-mc:invariant:no-autonomous-review-4 -->')) {
    violations.push(violation('MC012', relativePath, 'Guide missing no-autonomous-Review-4 invariant marker'))
  }
  if (!content.includes('<!-- bemoat-mc:invariant:no-silent-reset -->')) {
    violations.push(violation('MC012', relativePath, 'Guide missing no-silent-reset invariant marker'))
  }
  if (!content.includes('<!-- bemoat-mc:invariant:minor-nit-non-blocking -->')) {
    violations.push(violation('MC012', relativePath, 'Guide missing Minor/Nit non-blocking invariant marker'))
  }
  if (!content.includes('<!-- bemoat-mc:invariant:delivery-owns-awaiting-review-1 -->')) {
    violations.push(
      violation('MC012', relativePath, 'Guide missing delivery-owns-awaiting-review-1 invariant marker'),
    )
  }
  if (!content.includes('<!-- bemoat-mc:invariant:reviewer-owns-counters -->')) {
    violations.push(violation('MC012', relativePath, 'Guide missing reviewer-owns-counters invariant marker'))
  }
  if (!content.includes('<!-- bemoat-mc:invariant:deterministic-reconciliation-not-conflict -->')) {
    violations.push(
      violation(
        'MC012',
        relativePath,
        'Guide missing deterministic-reconciliation-not-conflict invariant marker',
      ),
    )
  }

  if (!content.includes('must not autonomously start Review 4')) {
    violations.push(violation('MC012', relativePath, 'Guide must forbid autonomous Review 4'))
  }
  if (!content.includes('Minor/Nit findings must not block')) {
    violations.push(violation('MC012', relativePath, 'Guide must state Minor/Nit findings must not block'))
  }

  for (const phrase of REQUIRED_COST_AWARE_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(violation('MC012', relativePath, `Guide missing cost-aware routing invariant: ${phrase}`))
    }
  }
  for (const phrase of REQUIRED_LEAN_FOUNDER_DECISION_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing lean Founder Decision invariant: ${phrase}`),
      )
    }
  }
  for (const phrase of REQUIRED_SAFE_BUNDLE_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(violation('MC012', relativePath, `Guide missing safe execution bundle invariant: ${phrase}`))
    }
  }
  for (const phrase of REQUIRED_CORRECTION_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(violation('MC012', relativePath, `Guide missing immutable correction invariant: ${phrase}`))
    }
  }
  for (const phrase of REQUIRED_BRAINSTORMING_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing brainstorming profile invariant: ${phrase}`),
      )
    }
  }
  for (const phrase of REQUIRED_CLI_PROMPT_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing Ready-to-paste CLI routing invariant: ${phrase}`),
      )
    }
  }

  return violations
}
