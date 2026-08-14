import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const CANONICAL = 'https://github.com/boat1994/bemoat-web-starter/pull/200'
const REPOSITORY = 'boat1994/bemoat-web-starter'
const HEAD = 'abc1234'

const URL_CASES: Array<{ id: number; value: string; accepted: boolean }> = [
  { id: 1, value: CANONICAL, accepted: true },
  { id: 2, value: `${CANONICAL}/`, accepted: false },
  { id: 3, value: `${CANONICAL}?x=1`, accepted: false },
  { id: 4, value: `${CANONICAL}#discussion`, accepted: false },
  { id: 5, value: 'https://GitHub.COM/boat1994/bemoat-web-starter/pull/200', accepted: true },
  { id: 6, value: 'https://github.com/Boat1994/bemoat-web-starter/pull/200', accepted: true },
  { id: 7, value: 'https://github.com/boat1994/Bemoat-Web-Starter/pull/200', accepted: true },
  { id: 8, value: 'https://github.com/boat1994/bemoat-web-starter/pul%6C/200', accepted: false },
  { id: 9, value: 'https://github.enterprise.example/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 10, value: 'https://api.github.com/repos/boat1994/bemoat-web-starter/pulls/200', accepted: false },
  { id: 11, value: `${CANONICAL}junk`, accepted: false },
  { id: 12, value: `${CANONICAL}/extra`, accepted: false },
  { id: 13, value: `${CANONICAL}.`, accepted: false },
  { id: 14, value: 'https://github.com/boat1994/bemoat-web-starter/pull/+200', accepted: false },
  { id: 15, value: 'https://github.com/boat1994/bemoat-web-starter/pull/-200', accepted: false },
  { id: 16, value: 'https://github.com/boat1994/bemoat-web-starter/pull/0', accepted: false },
  { id: 17, value: 'https://github.com/boat1994/bemoat-web-starter/pull/0123', accepted: false },
  { id: 18, value: 'https://github.com@evil.example/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 19, value: 'https://github.com.evil.example/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 20, value: 'http://github.com/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 21, value: 'HTTPS://github.com/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 22, value: 'github.com/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 23, value: '//github.com/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 24, value: 'https://github.com:443/boat1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 25, value: 'https://github.com/boat%2F1994/bemoat-web-starter/pull/200', accepted: false },
  { id: 26, value: `${CANONICAL}%2Fextra`, accepted: false },
  { id: 27, value: `${CANONICAL}%5Cextra`, accepted: false },
  { id: 28, value: `${CANONICAL}%252Fextra`, accepted: false },
  { id: 29, value: 'https://github.com/boat1994/bemoat-web-starter/./pull/200', accepted: false },
  { id: 30, value: 'https://github.com/boat1994/bemoat-web-starter/%2e/pull/200', accepted: false },
  { id: 31, value: `${CANONICAL}/../extra`, accepted: false },
  { id: 32, value: `${CANONICAL}/%2e%2e/extra`, accepted: false },
  { id: 33, value: 'https:\\\\github.com\\boat1994\\bemoat-web-starter\\pull\\200', accepted: false },
  { id: 34, value: `${CANONICAL}\\extra`, accepted: false },
  { id: 35, value: ` ${CANONICAL}`, accepted: false },
  { id: 36, value: `${CANONICAL} `, accepted: false },
  { id: 37, value: `\n${CANONICAL}\u007f`, accepted: false },
  { id: 38, value: 'https://github.com/boat1994/bemoat-web-starter/pull/\t200', accepted: false },
  { id: 39, value: `${CANONICAL}).`, accepted: false },
  { id: 40, value: `${CANONICAL} more-text`, accepted: false },
  { id: 41, value: `${CANONICAL}https://github.com/boat1994/bemoat-web-starter/pull/201`, accepted: false },
  { id: 42, value: `${CANONICAL}?other=https://github.com/boat1994/bemoat-web-starter/pull/201`, accepted: false },
]

function verdictBody(target = CANONICAL, extra = '') {
  return `## REVIEW_VERDICT\n**PR / base / head:** ${target} · \`main\` · \`${HEAD}\`${extra}`
}

describe('PR identity extraction seam', () => {
  it('keeps the pure domain module as the sole PR identity implementation', async () => {
    expect(existsSync('scripts/pr-identity.mjs')).toBe(false)
    expect(existsSync('scripts/mission-control/domain/pr-identity.mjs')).toBe(true)

    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')
    expect(domain.parseCompleteGitHubPullUrl('https://github.com/boat1994/bemoat-web-starter/pull/335'))
      .toEqual({
        ok: true,
        identity: {
          owner: 'boat1994',
          repo: 'bemoat-web-starter',
          number: '335',
          key: 'boat1994/bemoat-web-starter#335',
        },
      })
  })

  it('preserves the direct 42-case URL grammar characterization', async () => {
    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')

    for (const testCase of URL_CASES) {
      const result = domain.parseCompleteGitHubPullUrl(testCase.value)
      expect(result.ok, `direct URL case #${testCase.id}`).toBe(testCase.accepted)
      if (testCase.accepted) {
        expect(result).toEqual({
          ok: true,
          identity: {
            owner: testCase.id === 6 ? 'Boat1994' : 'boat1994',
            repo: testCase.id === 7 ? 'Bemoat-Web-Starter' : 'bemoat-web-starter',
            number: '200',
            key: 'boat1994/bemoat-web-starter#200',
          },
        })
      } else {
        expect(result).toEqual({ ok: false, reason: expect.any(String) })
      }
    }
  })

  it('keeps extraction exact, including the non-string throw boundary', async () => {
    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')

    expect(domain.extractVerdictPrBaseAndHead(verdictBody())).toEqual({ base: 'main', head: HEAD })
    expect(domain.extractVerdictPrBaseAndHead(verdictBody(CANONICAL, ' · base `main` · head `abc1234`')))
      .toEqual({ base: 'main', head: HEAD })
    expect(domain.extractVerdictPrBaseAndHead('not a verdict')).toEqual({ base: null, head: null })
    expect(() => Reflect.apply(domain.extractVerdictPrBaseAndHead, undefined, [null])).toThrow(TypeError)
  })

  it('preserves canonical verdict identity, planning-no-PR, source-thread, and fail-closed behavior', async () => {
    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')
    const sourceThread = `${CANONICAL}#discussion_r1`
    const contract = { findings: [{ id: 'MC-R1-001', source_thread: sourceThread }] }

    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(), REPOSITORY, 'implementation_pr', null, contract))
      .toEqual({ ok: true, identity: { owner: 'boat1994', repo: 'bemoat-web-starter', number: '200', key: 'boat1994/bemoat-web-starter#200' } })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(), REPOSITORY, 'implementation_pr', null, {
      findings: [{ id: 'MC-R1-001', source_thread: 'https://github.com/other/repository/pull/200#discussion_r1' }],
    })).toEqual({ ok: false, errors: ['finding MC-R1-001 source_thread PR identity other/repository#200 does not match canonical REVIEW_VERDICT target boat1994/bemoat-web-starter#200'] })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(), 'other/repository', 'implementation_pr'))
      .toEqual({ ok: false, errors: ['REVIEW_VERDICT PR identity boat1994/bemoat-web-starter#200 does not match the current repository other/repository'] })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(CANONICAL, '\n**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/201'), REPOSITORY))
      .toEqual({ ok: false, errors: ['REVIEW_VERDICT contains multiple canonical `PR / base / head` fields'] })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(CANONICAL, `\n**Also:** ${CANONICAL}junk`), REPOSITORY))
      .toEqual({ ok: false, errors: [`REVIEW_VERDICT contains malformed PR identity evidence (${CANONICAL}junk)`] })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody('none · base main · head abc1234'), REPOSITORY, 'planning_no_pr'))
      .toEqual({ ok: true, identity: { none: true } })
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody('none · base main · head abc1234', `\n**Also:** ${CANONICAL}junk`), REPOSITORY, 'planning_no_pr'))
      .toEqual({ ok: false, errors: [`REVIEW_VERDICT contains malformed PR identity evidence (${CANONICAL}junk)`] })
    expect(domain.collectKnownSourceThreads(contract)).toEqual(new Set([sourceThread]))
    expect(domain.resolveCanonicalVerdictPrIdentity(verdictBody(), REPOSITORY, 'implementation_pr', null, {
      findings: [{ id: 'MC-R1-001', source_thread: `${CANONICAL}#discussion_r1` }],
    })).toEqual(domain.resolveCanonicalVerdictPrIdentity(verdictBody(), REPOSITORY, 'implementation_pr', null, contract))
  })

  it('keeps the facade logic-free and exactly mirrors the typed implementation exports', async () => {
    const facade = await import('../../scripts/mission-control/domain/pr-identity.mjs')
    const typed = await import('../../scripts/mission-control/domain/pr-identity.ts')

    expect(readFileSync('scripts/mission-control/domain/pr-identity.mjs', 'utf8')).toBe("export * from './pr-identity.ts'\n")
    expect(Object.keys(facade).sort()).toEqual([
      'collectKnownSourceThreads',
      'extractVerdictPrBaseAndHead',
      'parseCompleteGitHubPullUrl',
      'resolveCanonicalVerdictPrIdentity',
    ])
    expect(Object.keys(typed).sort()).toEqual(Object.keys(facade).sort())
    for (const name of Object.keys(facade) as Array<keyof typeof facade>) {
      expect(facade[name]).toBe(typed[name])
    }
  })
})
