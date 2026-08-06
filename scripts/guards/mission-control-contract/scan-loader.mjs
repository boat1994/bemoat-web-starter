import {
  GUIDE_PATH,
  LOADER_PATH,
  LOADER_FORBIDDEN_TITLES,
  LOADER_MAX_LINES,
  REQUIRED_LEAN_FOUNDER_LOADER_PHRASES,
  REQUIRED_CLI_PROMPT_LOADER_PHRASES,
  REQUIRED_SAFE_BUNDLE_LOADER_PHRASES,
} from './inventory.mjs'
import { violation } from './violation.mjs'

export function scanLoaderContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC006', relativePath, 'ChatGPT Mission Control loader is missing'))
    return violations
  }

  if (!content.includes(GUIDE_PATH)) {
    violations.push(
      violation('MC006', relativePath, 'Loader must point to docs/mission-control/mission-control-guide.md'),
    )
  }

  const lineCount = content.split('\n').length
  if (lineCount > LOADER_MAX_LINES) {
    violations.push(
      violation(
        'MC007',
        relativePath,
        `Loader exceeds thin bootstrap limit (${lineCount} > ${LOADER_MAX_LINES} lines)`,
      ),
    )
  }

  for (const title of LOADER_FORBIDDEN_TITLES) {
    if (content.includes(title)) {
      violations.push(violation('MC007', relativePath, `Loader duplicates long-form policy heading: ${title}`))
    }
  }

  for (const phrase of REQUIRED_LEAN_FOUNDER_LOADER_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC007', relativePath, `Loader missing lean Founder Decision invariant: ${phrase}`),
      )
    }
  }
  for (const phrase of REQUIRED_SAFE_BUNDLE_LOADER_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(violation('MC012', relativePath, `Loader missing safe execution bundle invariant: ${phrase}`))
    }
  }
  for (const phrase of REQUIRED_CLI_PROMPT_LOADER_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Loader missing Ready-to-paste CLI routing invariant: ${phrase}`),
      )
    }
  }

  return violations
}

export function scanAgentsPointer(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC008', relativePath, 'AGENTS.md is missing'))
    return violations
  }
  if (!content.includes(GUIDE_PATH) || !content.includes(LOADER_PATH)) {
    violations.push(violation('MC008', relativePath, 'AGENTS.md lacks the canonical Mission Control pointer'))
  }
  return violations
}
