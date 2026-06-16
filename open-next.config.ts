// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config'

const openNextConfig = {
  ...defineCloudflareConfig({}),
  buildCommand: 'cross-env BEMOAT_BUILD_CONTEXT=opennext-next-build pnpm run build',
}

export default openNextConfig
