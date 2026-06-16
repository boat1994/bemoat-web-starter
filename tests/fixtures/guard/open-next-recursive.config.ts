import { defineCloudflareConfig } from '@opennextjs/cloudflare/config'

const openNextConfig = {
  ...defineCloudflareConfig({}),
  buildCommand: 'opennextjs-cloudflare build',
}

export default openNextConfig
