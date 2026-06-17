import { test, expect } from '@playwright/test'

const BLOCKED_CLAIMS = [
  'revenue impact',
  'conversion impact',
  'time saved',
  'workflow automation impact',
  'reduced missed leads',
  'lead outcome',
  'proven system',
  'full CRM',
  'AI-powered sales automation',
  'mature SaaS platform',
  'scalable platform',
  'guaranteed business outcome',
]

const STALE_STARTER_COPY = [
  'Welcome to your new project',
  'Payload Blank Template',
  'Payload Cloudflare boilerplate',
  'Project CMS, portfolio, blog, and custom request starter',
]

test.describe('Frontend', () => {
  test('homepage communicates CMS-first offer for owner-led businesses', async ({ page }) => {
    await page.goto('http://localhost:3000')

    const bodyText = (await page.locator('main').innerText()).toLowerCase()

    expect(bodyText).toMatch(/cms-backed/)
    expect(bodyText).toMatch(/business website/)
    expect(bodyText).toMatch(/owner-led/)

    await expect(
      page.getByRole('link', {
        name: 'Tell me what changes most often in your business.',
      }).first(),
    ).toBeVisible()

    await expect(
      page.getByRole('link', {
        name: 'I need a CMS-backed website my team can update.',
      }).first(),
    ).toBeVisible()

    for (const staleCopy of STALE_STARTER_COPY) {
      expect(bodyText).not.toContain(staleCopy.toLowerCase())
    }

    for (const blockedClaim of BLOCKED_CLAIMS) {
      expect(bodyText).not.toContain(blockedClaim.toLowerCase())
    }
  })
})
