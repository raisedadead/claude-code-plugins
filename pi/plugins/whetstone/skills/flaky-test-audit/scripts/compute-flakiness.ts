import { byCodePoint, pythonInt } from '../../../hooks/text.ts'

export class InputError extends Error {}

export type Rate = { runs: number; fails: number; rate: number; flaky: boolean }

function count(test: string, value: unknown): number {
  if (value === undefined) return 0
  if (typeof value === 'boolean') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const parsed = typeof value === 'string' ? pythonInt(value) : undefined
  if (parsed !== undefined) return parsed
  throw new InputError(`${JSON.stringify(test)}: runs and fails must be integers`)
}

function kind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  return typeof value
}

export function computeRates(results: Record<string, unknown>): Record<string, Rate> {
  const rates: Record<string, Rate> = Object.create(null)
  for (const [test, record] of Object.entries(results)) {
    if (kind(record) !== 'object') {
      throw new InputError(`${JSON.stringify(test)}: record is ${kind(record)}, want {runs, fails}`)
    }
    const fields = record as Record<string, unknown>
    const runs = count(test, fields.runs)
    const fails = count(test, fields.fails)
    rates[test] = { runs, fails, rate: runs ? fails / runs : 0, flaky: 0 < fails && fails < runs }
  }
  return rates
}

export function quarantine(rates: Record<string, Rate>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rates)
      .filter(([, rate]) => rate.flaky)
      .map(([test, rate]) => [test, rate.rate]),
  )
}

export function newFlags(current: Record<string, number>, baseline: Record<string, unknown>): string[] {
  return Object.keys(current)
    .filter((test) => !Object.hasOwn(baseline, test))
    .sort(byCodePoint)
}

function fixed2(value: number): string {
  const eighths = value * 8
  if (Object.is(value, -0)) return '-0.00'
  if (!Number.isInteger(eighths) || eighths % 2 === 0) return value.toFixed(2)
  const low = Math.floor(value * 100)
  return ((low % 2 === 0 ? low : low + 1) / 100).toFixed(2)
}

export function reportLines(rates: Record<string, Rate>): string[] {
  return Object.keys(rates)
    .sort(byCodePoint)
    .map((test) => {
      const { runs, fails, rate, flaky } = rates[test] as Rate
      return `${flaky ? 'FLAKY' : '     '} ${fails}/${runs} ${fixed2(rate)} ${test}`
    })
}
