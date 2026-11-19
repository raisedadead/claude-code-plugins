import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from '../cli/dispatch.ts'
import { type Review, reviewsFile, tree } from '../engine/branch.ts'
import { run } from '../engine/sh.ts'

export type Result = { code: number; out: string; err: string }

export function sh(cwd: string, command: string): string {
  const done = run(['bash', '-c', command], cwd)
  if (done.code !== 0) throw new Error(`${command}: ${done.err}`)
  return done.out.trim()
}

export function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'ds-'))
  process.env.DS_STATE_DIR = join(root, 'state')
  process.env.DS_TODAY = '2026-11-14'
  process.env.DS_NOW = '2026-11-14 00:00'
  process.env.DS_NO_NETWORK = '1'
  delete process.env.DS_DOSSIER
  delete process.env.DS_ROOT
  const dir = join(root, 'repo')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), '.scratchpad/\n')
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  sh(dir, 'git init -q -b main && git add . && git commit -qm "chore: init"')
  return dir
}

export function ds(cwd: string, ...argv: string[]): Result {
  let out = ''
  let err = ''
  const code = main(
    argv,
    cwd,
    (text) => (out += `${text}\n`),
    (text) => (err += `${text}\n`),
  )
  return { code, out: out.trim(), err: err.trim() }
}

export function file(path: string, text?: string): string {
  if (text !== undefined) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  return readFileSync(path, 'utf8')
}

export const PLAN = `# demo

state: plan
branch: demo
base: main
pr: feat(b): add the b module
checked: -
row: O100

## Goal

> "add b"

## Scope

- in: src/b.ts
- out: everything else

## Decisions

1. Name it b? — yes · 2026-11-14
confirmed: "go"

## Checks

| name | command | expect | guard | rows |
|---|---|---|---|---|
| b-exists | \`test -f src/b.ts\` | exit 0 | no | O1 |
| c-exists | \`test -f lib/c.ts\` | exit 0 | no | O2 |
| a-kept | \`grep -q a src/a.ts\` | exit 0 | yes | |

## Edge cases

- b exists already → b-exists

## Commits

| subject | rows | paths |
|---|---|---|
| feat(b): add the b module | O1 | src/b.ts |
| feat(c): add the c module | O2 | lib/** |

## Rows

- O1 next A Add the b module
- O2 next A Add the c module
- O3 wait H Approve the PR

## Notes

### O1
Keep it short.
`

export function planned(cwd: string): string {
  file(join(process.env.DS_STATE_DIR ?? '', 'next-id'), '100')
  const path = ds(cwd, 'new', 'demo').out
  file(path, PLAN)
  return path
}

export function checkedPlan(cwd: string): string {
  const path = planned(cwd)
  const findings = join(dirname(path), 'findings.md')
  file(findings, 'fine\nVERDICT: PASS\n')
  for (const step of [
    ['check', '--baseline'],
    ['pack', 'plan'],
    ['record', 'plan', findings],
  ]) {
    const done = ds(cwd, ...step)
    if (done.code !== 0) throw new Error(`${step.join(' ')}: ${done.err}`)
  }
  return path
}

// Stands in for the rig, which writes one review record when a reviewer ends.
export function recordReview(cwd: string, verdict: string, extra: Partial<Review> = {}): Review {
  const review: Review = {
    time: '2026-11-15 09:00',
    branch: sh(cwd, 'git rev-parse --abbrev-ref HEAD'),
    base: 'main',
    head: sh(cwd, 'git rev-parse HEAD'),
    tree: tree(cwd),
    patch: '',
    verdict,
    findings: '',
    ...extra,
  }
  appendFileSync(reviewsFile(cwd), `${JSON.stringify(review)}\n`)
  return review
}
