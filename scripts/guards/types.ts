export interface GuardViolation {
  type?: string
  file: string
  rule: string
  message: string
  [key: string]: unknown
}

export type ReadTextFile = (filePath: string, encoding?: BufferEncoding) => string
export type FileExists = (filePath: string) => boolean

export interface PackageScripts {
  build?: string
  'build:next'?: string
  'build:cloudflare'?: string
  'cf:build'?: string
  'deploy:database'?: string
  [key: string]: string | undefined
}

export interface PackageJson {
  name?: string
  scripts?: PackageScripts
  engines?: { node?: string; pnpm?: string }
  devDependencies?: { typescript?: string }
}

export interface WranglerBinding {
  database_id?: string
  bucket_name?: string
  preview_bucket_name?: string
}

export interface WranglerConfig {
  env?: {
    production?: Record<string, unknown>
    dev?: WranglerConfig
  }
  d1_databases?: WranglerBinding[]
  r2_buckets?: WranglerBinding[]
}

export interface GuardCommandOptions {
  root?: string
  readFile?: ReadTextFile
  fileExists?: FileExists
  exists?: FileExists
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
