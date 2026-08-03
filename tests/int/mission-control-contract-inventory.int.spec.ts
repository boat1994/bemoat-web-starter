import { describe, expect, it } from 'vitest'

describe('mission-control contract inventory boundary', () => {
  it('preserves the approved managed-module order and section ownership', async () => {
    const inventory = await import('../../scripts/guards/mission-control-contract/inventory.mjs')

    expect(inventory.MC_MANAGED_MODULES).toEqual([
      inventory.MODULE_PROCEDURES_PATH,
      inventory.MODULE_CHECKLISTS_PATH,
      inventory.MODULE_TEMPLATES_PATH,
      inventory.MODULE_TROUBLESHOOTING_PATH,
      inventory.MODULE_MIGRATION_PATH,
      inventory.MODULE_CHILD_SYNC_PATH,
    ])
    expect(inventory.MODULE_SECTION_MAP[inventory.GUIDE_PATH]).toContain('## Safe execution bundles')
    expect(inventory.MODULE_SECTION_MAP[inventory.MODULE_PROCEDURES_PATH]).toContain(
      '## Double-Loop Review Gate',
    )
  })

  it('keeps the live override outside the managed-path inventory', async () => {
    const inventory = await import('../../scripts/guards/mission-control-contract/inventory.mjs')

    expect(inventory.MC_MANAGED_PATHS).not.toContain(inventory.LIVE_OVERRIDE_PATH)
    expect(inventory.MC_MANAGED_PATHS).toContain(inventory.GUARD_SCRIPT_PATH)
    expect(inventory.MC_MANAGED_PATHS).toContain(inventory.INT_TEST_PATH)
  })

  it('keeps command-reference discovery on the managed inventory', async () => {
    const inventory = await import('../../scripts/guards/mission-control-contract/inventory.mjs')
    expect(inventory.MC_MANAGED_PATHS).toContain(inventory.COMMAND_REFERENCE_PATH)
    expect(inventory.COMMAND_REFERENCE_PATH).toBe('docs/mission-control/command-reference.md')
  })
})
