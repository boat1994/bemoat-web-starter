import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const MANIFEST_PATH = 'scripts/structural-protection-manifest.json'
const TOP_LEVEL_KEYS = ['schema_version', 'production_scripts', 'protected_oracle']
const SCRIPTS_KEYS = ['root', 'extension', 'line_count_algorithm', 'soft_ceiling', 'grandfathered']
const ORACLE_KEYS = ['algorithm', 'files']
const ENTRY_KEYS = ['path', 'max_lines']
const HASH_ENTRY_KEYS = ['path', 'sha256']

function violation(rule, file, message) {
  return { rule, file, message }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isSafePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isSortedUnique(entries) {
  return entries.every((entry, index) => index === 0 || entries[index - 1].path < entry.path)
}

export function countPhysicalLines(buffer) {
  if (buffer.length === 0) return 0
  let count = 0
  for (const byte of buffer) if (byte === 10) count += 1
  return count + (buffer.at(-1) === 10 ? 0 : 1)
}

export function validateStructuralProtectionManifest(manifest) {
  const violations = []
  if (!hasExactKeys(manifest, TOP_LEVEL_KEYS)) return [violation('STRUCT001', MANIFEST_PATH, 'Manifest must use exactly the required top-level keys.')]
  if (manifest.schema_version !== 1) violations.push(violation('STRUCT002', MANIFEST_PATH, 'schema_version must be integer 1.'))
  const scripts = manifest.production_scripts
  if (!hasExactKeys(scripts, SCRIPTS_KEYS)) {
    violations.push(violation('STRUCT003', MANIFEST_PATH, 'production_scripts must use exactly the required keys.'))
  } else {
    if (scripts.root !== 'scripts' || scripts.extension !== '.mjs' || scripts.line_count_algorithm !== 'physical-lines-v1' || scripts.soft_ceiling !== 400) {
      violations.push(violation('STRUCT004', MANIFEST_PATH, 'production_scripts values do not match the v1 contract.'))
    }
    if (!Array.isArray(scripts.grandfathered) || !scripts.grandfathered.every((entry) => hasExactKeys(entry, ENTRY_KEYS) && isSafePath(entry.path) && entry.path.startsWith('scripts/') && Number.isSafeInteger(entry.max_lines) && entry.max_lines > 0) || !isSortedUnique(scripts.grandfathered || [])) {
      violations.push(violation('STRUCT005', MANIFEST_PATH, 'grandfathered entries must be sorted, unique, safe script paths with positive maxima.'))
    }
  }
  const oracle = manifest.protected_oracle
  if (!hasExactKeys(oracle, ORACLE_KEYS)) {
    violations.push(violation('STRUCT006', MANIFEST_PATH, 'protected_oracle must use exactly the required keys.'))
  } else if (oracle.algorithm !== 'sha256' || !Array.isArray(oracle.files) || !oracle.files.every((entry) => hasExactKeys(entry, HASH_ENTRY_KEYS) && isSafePath(entry.path) && /^[0-9a-f]{64}$/.test(entry.sha256)) || !isSortedUnique(oracle.files || [])) {
    violations.push(violation('STRUCT007', MANIFEST_PATH, 'protected oracle must be sorted, unique, safe SHA-256 entries.'))
  }
  return violations
}

function walkScripts(root, directory, files, violations) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    const relativePath = relative(root, fullPath).split('\\').join('/')
    if (entry.isSymbolicLink()) {
      violations.push(violation('STRUCT008', relativePath, 'Symlinks are not allowed in the production script inventory.'))
    } else if (entry.isDirectory()) {
      walkScripts(root, fullPath, files, violations)
    } else if (entry.isFile() && relativePath.endsWith('.mjs')) {
      files.push(relativePath)
    }
  }
}

export function runStructuralProtectionGuard(root = process.cwd()) {
  let manifest
  try {
    const manifestStat = lstatSync(join(root, MANIFEST_PATH))
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return [violation('STRUCT009', MANIFEST_PATH, 'Manifest must be a regular file.')]
    manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'))
  } catch (error) {
    return [violation('STRUCT010', MANIFEST_PATH, `Unable to read manifest: ${error.message}`)]
  }
  const violations = validateStructuralProtectionManifest(manifest)
  if (violations.length > 0) return violations
  const scriptsRoot = join(root, manifest.production_scripts.root)
  const files = []
  try {
    walkScripts(root, scriptsRoot, files, violations)
  } catch (error) {
    return [...violations, violation('STRUCT011', 'scripts', `Unable to inventory production scripts: ${error.message}`)]
  }
  const maxima = new Map(manifest.production_scripts.grandfathered.map((entry) => [entry.path, entry.max_lines]))
  for (const file of files) {
    const lineCount = countPhysicalLines(readFileSync(join(root, file)))
    const maximum = maxima.get(file) ?? manifest.production_scripts.soft_ceiling
    if (lineCount > maximum) violations.push(violation('STRUCT012', file, `${lineCount} physical lines exceeds the maximum of ${maximum}.`))
  }
  for (const entry of manifest.protected_oracle.files) {
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
      violations.push(violation('STRUCT015', entry.path, `Unable to read protected oracle file: ${error.message}`))
    }
  }
  return violations
}

export function formatStructuralProtectionViolations(violations) {
  if (violations.length === 0) return ['Structural protection guard passed.']
  return ['Structural protection guard failed:', ...violations.map((entry) => `[${entry.rule}] ${entry.file}: ${entry.message}`)]
}
