#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  managedPaths,
  packageScripts,
  packageSections,
} from './sync-boilerplate.mjs'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-check-tmp')
const sourceRoot = join(tempRoot, 'source')

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listFiles(root, relativePath = '') {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return []

  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return [relativePath]

  const files = []
  for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...listFiles(root, childPath))
    } else {
      files.push(childPath)
    }
  }

  return files.sort()
}

function digestFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function digestPath(root, relativePath) {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return null

  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return digestFile(fullPath)

  return listFiles(root, relativePath)
    .map((filePath) => `${filePath}:${digestFile(join(root, filePath))}`)
    .join('\n')
}

function getExpectedPackageJSON(sourcePackage, targetPackage) {
  const expected = structuredClone(targetPackage)

  expected.scripts = expected.scripts || {}
  for (const scriptName of packageScripts) {
    if (sourcePackage.scripts?.[scriptName]) {
      expected.scripts[scriptName] = sourcePackage.scripts[scriptName]
    }
  }

  for (const section of packageSections) {
    expected[section] = expected[section] || {}
    Object.assign(expected[section], sourcePackage[section] || {})
  }

  return expected
}

export function compareBoilerplateDrift({
  sourceRoot: source,
  targetRoot: target,
  paths = managedPaths,
}) {
  const missing = []
  const changed = []
  const identical = []

  for (const relativePath of paths) {
    const sourcePath = join(source, relativePath)
    const targetPath = join(target, relativePath)

    if (!existsSync(sourcePath)) continue
    if (!existsSync(targetPath)) {
      missing.push(relativePath)
      continue
    }

    const sourceDigest = digestPath(source, relativePath)
    const targetDigest = digestPath(target, relativePath)

    if (sourceDigest === targetDigest) {
      identical.push(relativePath)
    } else {
      changed.push(relativePath)
    }
  }

  const sourcePackagePath = join(source, 'package.json')
  const targetPackagePath = join(target, 'package.json')

  if (existsSync(sourcePackagePath) && existsSync(targetPackagePath)) {
    const sourcePackage = readJSON(sourcePackagePath)
    const targetPackage = readJSON(targetPackagePath)
    const expected = getExpectedPackageJSON(sourcePackage, targetPackage)

    if (JSON.stringify(expected) === JSON.stringify(targetPackage)) {
      identical.push('package.json')
    } else {
      changed.push('package.json')
    }
  } else if (existsSync(sourcePackagePath) && !existsSync(targetPackagePath)) {
    missing.push('package.json')
  }

  return { missing, changed, identical }
}

function printReport({ missing, changed, identical }) {
  const hasDrift = missing.length > 0 || changed.length > 0

  console.log(`Checking boilerplate drift against ${repo}#${ref}\n`)

  if (!hasDrift) {
    console.log('No drift found.')
    console.log(`Identical paths: ${identical.length}`)
    return
  }

  console.log('Drift found\n')

  if (missing.length > 0) {
    console.log('Missing paths:')
    for (const path of missing) console.log(`  - ${path}`)
    console.log('')
  }

  if (changed.length > 0) {
    console.log('Changed paths:')
    for (const path of changed) console.log(`  - ${path}`)
    console.log('')
  }

  console.log(`Identical paths: ${identical.length}`)
  console.log('\nSuggested next command:')
  console.log('pnpm run boilerplate:sync')
  console.log('\nAfter sync, run:')
  console.log('pnpm install')
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    const report = compareBoilerplateDrift({ sourceRoot, targetRoot })
    printReport(report)

    const hasDrift = report.missing.length > 0 || report.changed.length > 0
    process.exit(hasDrift ? 1 : 0)
  } catch (error) {
    console.error('Unable to fetch or compare boilerplate source.')
    if (error instanceof Error) console.error(error.message)
    process.exit(2)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (isDirectExecution()) main()
