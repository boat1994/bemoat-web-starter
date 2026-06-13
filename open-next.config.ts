// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config'

const openNextConfig = {
  ...defineCloudflareConfig({}),
  buildCommand: 'pnpm exec next build',
}

export default openNextConfig
