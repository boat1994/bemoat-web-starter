import { describe, expect, it } from 'vitest'

import * as facade from '../../scripts/mission-control/domain/correction-contract-fingerprint.mjs'
import {
  fingerprintCorrectionContract,
  hashExactBody,
  stableStringify,
} from '../../scripts/mission-control/domain/correction-contract-fingerprint.ts'

describe('correction-contract-fingerprint boundary', () => {
  it('keeps the compatibility facade at exactly three exports backed by TypeScript', () => {
    expect(Object.keys(facade).sort()).toEqual([
      'fingerprintCorrectionContract',
      'hashExactBody',
      'stableStringify',
    ])
    expect(facade.fingerprintCorrectionContract).toBe(fingerprintCorrectionContract)
    expect(facade.hashExactBody).toBe(hashExactBody)
    expect(facade.stableStringify).toBe(stableStringify)
  })

  it('freezes recursive own-enumerable string-key ordering and contract hash vectors', () => {
    const contract = {
      z: 1,
      a: { d: 4, c: 3 },
      items: [{ b: 2, a: 1 }, null],
    }

    expect(stableStringify(contract)).toBe(
      '{"a":{"c":3,"d":4},"items":[{"a":1,"b":2},null],"z":1}',
    )
    expect(fingerprintCorrectionContract(contract)).toBe(
      '4835247b48aac31d1998e92c1f63a19c2dc07b1503075ccc74c36c8ecc06ed92',
    )
    expect(fingerprintCorrectionContract({ a: 1, b: 2 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    )
    expect(fingerprintCorrectionContract({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    )
  })

  it('keeps array order authoritative and preserves sparse and unsupported quirks', () => {
    const sparse = [1, undefined, , () => 'unsupported']

    expect(stableStringify(sparse)).toBe('[1,,,]')
    expect(fingerprintCorrectionContract({ items: [1, 2, 3] })).toBe(
      '7aff5dcbe562761bfd9d8569cdd3226d3944acad6539db5d62ad3f67d9a45d0a',
    )
    expect(fingerprintCorrectionContract({ items: [3, 2, 1] })).toBe(
      '27d87096a02d69dbce3514d6528cf8384ded1e55bd4dac03e5daf2f40b72586d',
    )
    expect(stableStringify({ missing: undefined, fn: () => 1, present: 1 })).toBe(
      '{"fn":undefined,"missing":undefined,"present":1}',
    )
  })

  it('reads getters after sorted keys and propagates getter exceptions', () => {
    const reads: string[] = []
    const value: Record<string, unknown> = {}
    Object.defineProperties(value, {
      b: {
        enumerable: true,
        get() {
          reads.push('b')
          return 2
        },
      },
      a: {
        enumerable: true,
        get() {
          reads.push('a')
          return 1
        },
      },
    })

    expect(stableStringify(value)).toBe('{"a":1,"b":2}')
    expect(reads).toEqual(['a', 'b'])

    const failure = new Error('getter failure')
    Object.defineProperty(value, 'c', {
      enumerable: true,
      get() {
        throw failure
      },
    })
    expect(() => stableStringify(value)).toThrow(failure)
  })

  it('keeps BigInt and circular input failures', () => {
    expect(() => stableStringify({ value: 1n })).toThrow(TypeError)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => stableStringify(circular)).toThrow()
  })

  it('hashes exact bodies as String(body ?? "") with lowercase SHA-256 hex', () => {
    expect(hashExactBody(null)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hashExactBody(undefined)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hashExactBody(0)).toBe(
      '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9',
    )
    expect(hashExactBody('exact body')).toBe(
      'a1e4e331d40278d0c2c1fdf2cdabd1690682bd13c1fd49dadd40c9df3dc6d6ad',
    )
  })
})
