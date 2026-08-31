import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { errorMessage } from './types.ts'

export interface StructuralViolation {
  rule: string
  file: string
  message: string
}

interface ProtectedOracleEntry {
  path: string
  sha256: string
}

interface GrandfatheredEntry {
  path: string
  max_lines: number
}

interface StructuralScripts {
  root: string
  extensions: string[]
  line_count_algorithm: string
  soft_ceiling: number
  grandfathered: GrandfatheredEntry[]
}

interface StructuralManifest {
  schema_version: number
  production_scripts: StructuralScripts
  protected_oracle: {
    algorithm: string
    files: ProtectedOracleEntry[]
  }
}

const MANIFEST_PATH = 'scripts/structural-protection-manifest.json'
const TOP_LEVEL_KEYS = ['schema_version', 'production_scripts', 'protected_oracle']
const SCRIPTS_KEYS = ['root', 'extensions', 'line_count_algorithm', 'soft_ceiling', 'grandfathered']
const ORACLE_KEYS = ['algorithm', 'files']
const ENTRY_KEYS = ['path', 'max_lines']
const HASH_ENTRY_KEYS = ['path', 'sha256']

function violation(rule: string, file: string, message: string): StructuralViolation {
  return { rule, file, message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isSafePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isSortedUnique(entries: Array<{ path: string }>) {
  return entries.every((entry, index) => index === 0 || entries[index - 1].path < entry.path)
}

export function countPhysicalLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0
  let count = 0
  for (const byte of buffer) if (byte === 10) count += 1
  return count + (buffer.at(-1) === 10 ? 0 : 1)
}

export function validateStructuralProtectionManifest(manifest: unknown): StructuralViolation[] {
  const violations: StructuralViolation[] = []
  if (!hasExactKeys(manifest, TOP_LEVEL_KEYS)) return [violation('STRUCT001', MANIFEST_PATH, 'Manifest must use exactly the required top-level keys.')]
  if (manifest.schema_version !== 1) violations.push(violation('STRUCT002', MANIFEST_PATH, 'schema_version must be integer 1.'))
  const scripts = manifest.production_scripts
  if (!hasExactKeys(scripts, SCRIPTS_KEYS)) {
    violations.push(violation('STRUCT003', MANIFEST_PATH, 'production_scripts must use exactly the required keys.'))
  } else {
    if (scripts.root !== 'scripts' || JSON.stringify(scripts.extensions) !== JSON.stringify(['.mjs', '.ts']) || scripts.line_count_algorithm !== 'physical-lines-v1' || scripts.soft_ceiling !== 400) {
      violations.push(violation('STRUCT004', MANIFEST_PATH, 'production_scripts values do not match the v1 contract.'))
    }
    const grandfathered = scripts.grandfathered
    const validGrandfathered = Array.isArray(grandfathered) && grandfathered.every((entry: unknown) => {
      if (!hasExactKeys(entry, ENTRY_KEYS)) return false
      return isSafePath(entry.path) && entry.path.startsWith('scripts/') && typeof entry.max_lines === 'number' && Number.isSafeInteger(entry.max_lines) && entry.max_lines > 0
    })
    if (!validGrandfathered || !isSortedUnique(grandfathered as GrandfatheredEntry[])) {
      violations.push(violation('STRUCT005', MANIFEST_PATH, 'grandfathered entries must be sorted, unique, safe script paths with positive maxima.'))
    }
  }
  const oracle = manifest.protected_oracle
  if (!hasExactKeys(oracle, ORACLE_KEYS)) {
    violations.push(violation('STRUCT006', MANIFEST_PATH, 'protected_oracle must use exactly the required keys.'))
  } else if (oracle.algorithm !== 'sha256' || !Array.isArray(oracle.files) || !oracle.files.every((entry: unknown) => {
    if (!hasExactKeys(entry, HASH_ENTRY_KEYS)) return false
    return isSafePath(entry.path) && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256)
  }) || !isSortedUnique(oracle.files as Array<{ path: string }> || [])) {
    violations.push(violation('STRUCT007', MANIFEST_PATH, 'protected oracle must be sorted, unique, safe SHA-256 entries.'))
  }
  return violations
}

function walkScripts(root: string, directory: string, files: string[], violations: StructuralViolation[], extensions: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    const relativePath = relative(root, fullPath).split('\\').join('/')
    if (entry.isSymbolicLink()) {
      violations.push(violation('STRUCT008', relativePath, 'Symlinks are not allowed in the production script inventory.'))
    } else if (entry.isDirectory()) {
      walkScripts(root, fullPath, files, violations, extensions)
    } else if (entry.isFile() && extensions.some((extension) => relativePath.endsWith(extension))) {
      files.push(relativePath)
    }
  }
}

export function runStructuralProtectionGuard(root = process.cwd()): StructuralViolation[] {
  let manifest: unknown
  try {
    const manifestStat = lstatSync(join(root, MANIFEST_PATH))
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return [violation('STRUCT009', MANIFEST_PATH, 'Manifest must be a regular file.')]
    manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'))
  } catch (error) {
    return [violation('STRUCT010', MANIFEST_PATH, `Unable to read manifest: ${errorMessage(error)}`)]
  }
  const violations = validateStructuralProtectionManifest(manifest)
  if (violations.length > 0) return violations
  const typedManifest = manifest as StructuralManifest
  const scriptsRoot = join(root, typedManifest.production_scripts.root)
  const files: string[] = []
  try {
    walkScripts(root, scriptsRoot, files, violations, typedManifest.production_scripts.extensions)
  } catch (error) {
    return [...violations, violation('STRUCT011', 'scripts', `Unable to inventory production scripts: ${errorMessage(error)}`)]
  }
  const maxima = new Map(typedManifest.production_scripts.grandfathered.map((entry) => [entry.path, entry.max_lines]))
  for (const file of files) {
    const lineCount = countPhysicalLines(readFileSync(join(root, file)))
    const maximum = maxima.get(file) ?? typedManifest.production_scripts.soft_ceiling
    if (lineCount > maximum) violations.push(violation('STRUCT012', file, `${lineCount} physical lines exceeds the maximum of ${maximum}.`))
  }
  for (const entry of typedManifest.protected_oracle.files) {
    const fullPath = join(root, entry.path)
    try {
      const stat = lstatSync(fullPath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        violations.push(violation('STRUCT013', entry.path, 'Protected oracle file must be a regular non-symlink file.'))
        continue
      }
      const actual = createHash('sha256').update(readFileSync(fullPath)).digest('hex')
      if (actual !== entry.sha256) violations.push(violation('STRUCT014', entry.path, 'Protected oracle SHA-256 fingerprint mismatch.'))
    } catch (error) {
      violations.push(violation('STRUCT015', entry.path, `Unable to read protected oracle file: ${errorMessage(error)}`))
    }
  }
  return violations
}

export function formatStructuralProtectionViolations(violations: StructuralViolation[]): string[] {
  if (violations.length === 0) return ['Structural protection guard passed.']
  return ['Structural protection guard failed:', ...violations.map((entry) => `[${entry.rule}] ${entry.file}: ${entry.message}`)]
}
