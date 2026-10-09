import { describe, expect, test } from 'claude-code/testing'
import { computeRates, InputError, newFlags, quarantine, reportLines } from '../skills/flaky-test-audit/scripts/compute-flakiness.ts'

describe('compute-flakiness', () => {
  test('flags only mixed outcomes as flaky', () => {
    const rates = computeRates({
      t_pass: { runs: 5, fails: 0 },
      t_fail: { runs: 5, fails: 5 },
      t_flaky: { runs: 5, fails: 2 },
    })
    expect(rates.t_pass?.flaky).toBe(false)
    expect(rates.t_fail?.flaky).toBe(false)
    expect(rates.t_flaky?.flaky).toBe(true)
    expect(rates.t_flaky?.rate).toBe(0.4)
  })

  test('quarantines the flaky tests and names the new ones', () => {
    const q = quarantine(computeRates({ a: { runs: 4, fails: 1 }, b: { runs: 4, fails: 0 } }))
    expect(q).toEqual({ a: 0.25 })
    expect(newFlags(q, {})).toEqual(['a'])
    expect(newFlags(q, { a: 0.25 })).toEqual([])
  })

  test('treats zero runs as rate 0 and reads integer-like counts', () => {
    const rates = computeRates({ none: {}, text: { runs: '4', fails: 2.9 } })
    expect(rates.none).toEqual({ runs: 0, fails: 0, rate: 0, flaky: false })
    expect(rates.text).toEqual({ runs: 4, fails: 2, rate: 0.5, flaky: true })
  })

  test('refuses a record that is not {runs, fails}', () => {
    expect(() => computeRates({ a: 5 })).toThrow(InputError)
    expect(() => computeRates({ a: { runs: 'many' } })).toThrow(InputError)
  })

  test('prints a sorted table with the rate rounded half to even', () => {
    const lines = reportLines(computeRates({ b: { runs: 8, fails: 1 }, a: { runs: 8, fails: 3 }, c: { runs: 2, fails: 0 } }))
    expect(lines).toEqual(['FLAKY 3/8 0.38 a', 'FLAKY 1/8 0.12 b', '      0/2 0.00 c'])
  })

  test('keeps a test named __proto__ as a flaky row', () => {
    const rates = computeRates(JSON.parse('{"__proto__": {"runs": 10, "fails": 1}}'))
    expect(reportLines(rates)).toEqual(['FLAKY 1/10 0.10 __proto__'])
  })

  test('reads counts the way Python int() does', () => {
    const rates = computeRates({ a: { runs: '1_0', fails: ' 1 ' }, b: { runs: -5, fails: 0 } })
    expect(rates.a).toEqual({ runs: 10, fails: 1, rate: 0.1, flaky: true })
    expect(reportLines({ b: rates.b! })).toEqual(['      0/-5 -0.00 b'])
  })

  test('sorts names by code point', () => {
    const lines = reportLines(computeRates({ 'a\u{1F600}': { runs: 1, fails: 0 }, 'a\uFF01': { runs: 1, fails: 0 } }))
    expect(lines.map((line) => line.split(' ').pop())).toEqual(['a\uFF01', 'a\u{1F600}'])
  })
})
