#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Human-approved destructive migrations must include this marker in the migration file. */
export const APPROVAL_MARKER = 'bemoat:destructive-migration-approved'

/** Safe template env files that may be tracked without secrets. */
export const ALLOWED_ENV_FILES = new Set(['.env.example'])

export const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.open-next',
  'coverage',
  '.bemoat-check-tmp',
  '.tmp-boilerplate-sync-test',
  '.tmp-boilerplate-drift-test',
  '.tmp-repo-safety-test',
])

export const SKIP_FILES = new Set(['pnpm-lock.yaml', 'scripts/guard-repo-safety.mjs'])

/** Project-specific Cloudflare bindings belong here, not in shared starter files. */
export const RESOURCE_ID_SAFE_FILES = new Set(['wrangler.jsonc'])

export const SECRET_PLACEHOLDER_RE =
  /^(?:ignore|ci-placeholder|changeme|replace-me|your[-_]|example|placeholder|xxx+|todo|<[^>]+>|\$\{|\$[A-Z_]+)$/i

export const SECRET_PATTERNS = [
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'github-token',
    re: /\bghp_[a-zA-Z0-9]{20,}\b/,
  },
  {
    id: 'github-fine-grained-token',
    re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,
  },
  {
    id: 'stripe-live-secret',
    re: /\bsk_live_[a-zA-Z0-9]{16,}\b/,
  },
  {
    id: 'aws-access-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'cloudflare-api-token',
    re: /\bv1\.0-[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
]

export const ASSIGNMENT_SECRET_RE =
  /\b(?:PAYLOAD_SECRET|DATABASE_URL|API[_-]?KEY|SECRET(?:_KEY)?|TOKEN|PRIVATE[_-]?KEY)\b\s*[:=]\s*['"]?([^'"\s#]{12,})/gi

export const CLOUDFLARE_RESOURCE_PATTERNS = [
  {
    id: 'd1-database-id',
    re: /database_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi,
  },
  {
    id: 'r2-bucket-name',
    re: /(?:preview_)?bucket_name"\s*:\s*"([^"<][^"]*)"/gi,
  },
]

export const DESTRUCTIVE_MIGRATION_PATTERNS = [
  { id: 'drop-table', re: /\bDROP\s+TABLE\b/i },
  { id: 'drop-column', re: /\bDROP\s+COLUMN\b/i },
  { id: 'drop-index', re: /\bDROP\s+INDEX\b/i },
  { id: 'delete-from', re: /\bDELETE\s+FROM\b/i },
  { id: 'truncate', re: /\bTRUNCATE\b/i },
  { id: 'rename-column', re: /\bRENAME\s+COLUMN\b/i },
  { id: 'rename-table', re: /\bRENAME\s+TO\b/i },
  { id: 'alter-column', re: /\bALTER\s+COLUMN\b/i },
]

export function isForbiddenEnvFile(relativePath) {
  const base = relativePath.split('/').pop() || relativePath
  if (!base.startsWith('.env')) return false
  return !ALLOWED_ENV_FILES.has(base)
}

export function shouldSkipPath(relativePath) {
  if (!relativePath || SKIP_FILES.has(relativePath)) return true

  const segments = relativePath.split('/')
  return segments.some((segment) => SKIP_DIR_NAMES.has(segment))
}

export function isMigrationPath(relativePath) {
  return /(?:^|\/)migrations\//.test(relativePath)
}

export function isTestPath(relativePath) {
  return relativePath.startsWith('tests/')
}

export function isSecretScanPath(relativePath) {
  if (shouldSkipPath(relativePath)) return false
  if (isTestPath(relativePath)) return false
  if (RESOURCE_ID_SAFE_FILES.has(relativePath)) return false
  if (relativePath.endsWith('.md')) return false
  if (relativePath.endsWith('.jsonc') && relativePath !== 'wrangler.jsonc') return false
  return true
}

export function isResourceIdScanPath(relativePath) {
  if (shouldSkipPath(relativePath)) return false
  if (isTestPath(relativePath)) return false
  if (RESOURCE_ID_SAFE_FILES.has(relativePath)) return false
  if (relativePath.endsWith('.md')) return false
  if (relativePath === 'package.json') return false
  return true
}

export function extractMigrationUpSection(content) {
  const upStart = content.search(/export\s+async\s+function\s+up\b/)
  if (upStart === -1) return content

  const downStart = content.search(/export\s+async\s+function\s+down\b/)
  if (downStart === -1 || downStart < upStart) return content.slice(upStart)

  return content.slice(upStart, downStart)
}

export function isPlaceholderResourceId(value) {
  if (!value) return true
  const normalized = value.trim()
  if (/^(?:DATABASE_ID|<[^>]+>|YOUR_[A-Z0-9_]+)$/i.test(normalized)) return true
  if (/^<[^>]+>$/.test(normalized)) return true
  return false
}

export function isPlaceholderSecret(value) {
  if (!value) return true
  const normalized = value.trim()
  if (normalized.length < 12) return true
  if (SECRET_PLACEHOLDER_RE.test(normalized)) return true
  if (/^process\.env\./.test(normalized)) return true
  return false
}

export function scanSecrets(relativePath, content) {
  if (!isSecretScanPath(relativePath)) return []

  const violations = []

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(content)) {
      violations.push({
        type: 'secret-pattern',
        file: relativePath,
        rule: pattern.id,
        message: `Possible secret/token (${pattern.id})`,
      })
    }
  }

  for (const match of content.matchAll(ASSIGNMENT_SECRET_RE)) {
    const value = match[1]
    if (isPlaceholderSecret(value)) continue

    violations.push({
      type: 'secret-assignment',
      file: relativePath,
      rule: 'env-assignment',
      message: `Possible secret assignment for ${match[0].split(/[:=]/)[0]?.trim()}`,
    })
  }

  return violations
}

export function scanResourceIds(relativePath, content) {
  if (!isResourceIdScanPath(relativePath)) return []

  const violations = []

  for (const pattern of CLOUDFLARE_RESOURCE_PATTERNS) {
    for (const match of content.matchAll(pattern.re)) {
      const value = match[1]
      if (isPlaceholderResourceId(value)) continue

      violations.push({
        type: 'cloudflare-resource-id',
        file: relativePath,
        rule: pattern.id,
        message: `Cloudflare resource identifier (${pattern.id}) outside wrangler.jsonc`,
      })
    }
  }

  return violations
}

export function scanDestructiveMigration(relativePath, content) {
  if (!isMigrationPath(relativePath)) return []
  if (content.includes(APPROVAL_MARKER)) return []

  const section =
    relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')
      ? extractMigrationUpSection(content)
      : content

  const violations = []

  for (const pattern of DESTRUCTIVE_MIGRATION_PATTERNS) {
    if (pattern.re.test(section)) {
      violations.push({
        type: 'destructive-migration',
        file: relativePath,
        rule: pattern.id,
        message: `Destructive migration keyword (${pattern.id}) without ${APPROVAL_MARKER}`,
      })
    }
  }

  return violations
}

export function scanFile(relativePath, content) {
  const violations = []

  if (isForbiddenEnvFile(relativePath)) {
    violations.push({
      type: 'env-file',
      file: relativePath,
      rule: 'tracked-env-file',
      message: 'Tracked .env* file is not allowed (except .env.example)',
    })
  }

  violations.push(...scanSecrets(relativePath, content))
  violations.push(...scanResourceIds(relativePath, content))
  violations.push(...scanDestructiveMigration(relativePath, content))

  return violations
}

export function listProjectFiles({ root = process.cwd(), execFile = execFileSync } = {}) {
  const tracked = execFile('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)

  let staged = []
  try {
    staged = execFile('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
  } catch {
    staged = []
  }

  return [...new Set([...tracked, ...staged])].filter((filePath) => !shouldSkipPath(filePath))
}

export function runRepoSafetyGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  execFile = execFileSync,
  files = null,
} = {}) {
  const targetFiles = files ?? listProjectFiles({ root, execFile })
  const violations = []

  for (const relativePath of targetFiles) {
    if (shouldSkipPath(relativePath)) continue

    let content
    try {
      content = readFile(resolve(root, relativePath))
    } catch {
      continue
    }

    violations.push(...scanFile(relativePath, content))
  }

  return violations
}

export function getGuardExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatViolations(violations) {
  if (violations.length === 0) {
    return ['Repository safety guard passed.']
  }

  const lines = ['Repository safety guard failed:', '']

  for (const violation of violations) {
    lines.push(`- [${violation.type}] ${violation.file}: ${violation.message}`)
  }

  lines.push('')
  lines.push(
    'See docs/schema-evolution.md, docs/agent-loop/security-and-migrations.md, and docs/hardening.md.',
  )

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runRepoSafetyGuard()
  const lines = formatViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getGuardExitCode(violations))
}

if (isDirectExecution()) main()
