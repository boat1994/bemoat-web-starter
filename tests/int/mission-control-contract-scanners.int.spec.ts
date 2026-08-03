import { describe, expect, it } from 'vitest'

describe('mission-control contract scanner boundaries', () => {
  it('preserves missing-module fail-closed classification', async () => {
    const [{ scanModuleContent }, inventory] = await Promise.all([
      import('../../scripts/guards/mission-control-contract/scan-modules.mjs'),
      import('../../scripts/guards/mission-control-contract/inventory.mjs'),
    ])

    expect(scanModuleContent(inventory.MODULE_PROCEDURES_PATH, null)).toEqual([
      {
        type: 'mission-control-contract',
        rule: 'MC013',
        file: inventory.MODULE_PROCEDURES_PATH,
        message: 'Required module is missing',
      },
    ])
  })

  it('preserves guide and loader rule families for malformed content', async () => {
    const [{ scanGuideContent }, { scanLoaderContent }, inventory] = await Promise.all([
      import('../../scripts/guards/mission-control-contract/scan-guide.mjs'),
      import('../../scripts/guards/mission-control-contract/scan-loader.mjs'),
      import('../../scripts/guards/mission-control-contract/inventory.mjs'),
    ])

    expect(scanGuideContent(inventory.GUIDE_PATH, null)[0]?.rule).toBe('MC001')
    expect(scanLoaderContent(inventory.LOADER_PATH, 'Mission Control\n')[0]?.rule).toBe('MC006')
  })

  it('preserves compact transport rule classification', async () => {
    const [{ scanHandoffTemplate, scanResultTemplate, scanRoleHandoffContract }, inventory] =
      await Promise.all([
        import('../../scripts/guards/mission-control-contract/scan-transport.mjs'),
        import('../../scripts/guards/mission-control-contract/inventory.mjs'),
      ])

    expect(scanHandoffTemplate(inventory.HANDOFF_PATH, null)[0]?.rule).toBe('MC011')
    expect(scanResultTemplate(inventory.RESULT_PATH, null)[0]?.rule).toBe('MC011')
    expect(scanRoleHandoffContract(inventory.ROLE_HANDOFF_PATH, 'PASS | BLOCKED')[0]?.rule).toBe(
      'MC011',
    )
  })
})
