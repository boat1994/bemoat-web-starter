#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-sync-tmp')
const sourceRoot = join(tempRoot, 'source')

const managedPaths = [
  'src/app/(frontend)/page.tsx',
  'src/app/(frontend)/layout.tsx',
  'src/app/(frontend)/styles.css',
  'src/app/(frontend)/projects/page.tsx',
  'src/app/(frontend)/projects/[slug]/page.tsx',
  'src/app/(frontend)/blog/page.tsx',
  'src/app/(frontend)/blog/[slug]/page.tsx',
  'src/app/(frontend)/how-to-custom-order/page.tsx',
  'src/collections/BlogCategories.ts',
  'src/collections/BlogMedia.ts',
  'src/collections/Categories.ts',
  'src/collections/Projects.ts',
  'src/collections/Posts.ts',
  'src/collections/Tags.ts',
  'src/components/AiGenerateButton/index.tsx',
  'src/components/BlogAiWorkflow.tsx',
  'src/components/BlogBlockAiGenerate.tsx',
  'src/components/ViewProjectButton/index.tsx',
  'src/constants/gemstones.ts',
  'src/globals/CustomOrderPage.ts',
  'src/globals/SiteSettings.ts',
  'src/lib/payloadText.ts',
  'src/payload.config.ts',
  'docs/bogus-dev-boilerplate.md',
]

const packageSections = ['dependencies', 'devDependencies']
const packageScripts = [
  'generate:importmap',
  'generate:types',
  'generate:types:cloudflare',
  'generate:types:payload',
  'payload',
  'boilerplate:sync',
]

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: targetRoot,
    ...options,
  })
}

function copyPath(relativePath) {
  const source = join(sourceRoot, relativePath)
  const destination = join(targetRoot, relativePath)

  if (!existsSync(source)) {
    console.warn(`[skip] ${relativePath} not found in ${repo}#${ref}`)
    return
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
  console.log(`[sync] ${relativePath}`)
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function mergePackageJSON() {
  const sourcePackagePath = join(sourceRoot, 'package.json')
  const targetPackagePath = join(targetRoot, 'package.json')

  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) return

  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)

  targetPackage.scripts = targetPackage.scripts || {}
  for (const scriptName of packageScripts) {
    if (sourcePackage.scripts?.[scriptName]) {
      targetPackage.scripts[scriptName] = sourcePackage.scripts[scriptName]
    }
  }

  for (const section of packageSections) {
    targetPackage[section] = targetPackage[section] || {}
    Object.assign(targetPackage[section], sourcePackage[section] || {})
  }

  writeFileSync(targetPackagePath, `${JSON.stringify(targetPackage, null, 2)}\n`)
  console.log('[sync] package.json scripts and dependencies')
}

function main() {
  console.log(`Syncing Bemoat boilerplate from ${repo}#${ref}`)

  rmSync(tempRoot, { recursive: true, force: true })
  mkdirSync(tempRoot, { recursive: true })

  run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot])

  for (const path of managedPaths) copyPath(path)
  mergePackageJSON()

  writeFileSync(
    join(targetRoot, '.bemoat-boilerplate-sync.json'),
    `${JSON.stringify(
      {
        repo,
        ref,
        syncedAt: new Date().toISOString(),
        managedPaths,
      },
      null,
      2,
    )}\n`,
  )

  rmSync(tempRoot, { recursive: true, force: true })

  console.log('\nDone. Suggested next commands:')
  console.log('pnpm install')
  console.log('pnpm run generate:importmap')
  console.log('pnpm run generate:types')
  console.log('pnpm payload migrate:create')
}

main()
