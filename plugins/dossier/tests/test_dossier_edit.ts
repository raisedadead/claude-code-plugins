import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, type Run, tempRoot } from './inproc.ts'

const FIXTURE = [
  '`2026-06-01` · `live` · `P1/2`',
  '',
  '## §T — Task ledger',
  '',
  '| id  | P   | state | task          | cite | verify     |',
  '| --- | --- | ----- | ------------- | ---- | ---------- |',
  '| T1  | P1  | x     | scaffold pkg  | [a1] | go test    |',
  '| T2  | P1  | ~     | wire client   | —    | V1         |',
  '| T3  | P1  | .     | clamp ttl     | —    | V3         |',
  '',
  '## §B — Bug ledger',
  '',
  '| id  | bug | root cause | invariant added | fix cite |',
  '| --- | --- | ---------- | --------------- | -------- |',
  '',
  '## §X — Cross-repo state',
  '',
  '| repo       | branch | ahead | tag | pushed | notes          |',
  '| ---------- | ------ | ----- | --- | ------ | -------------- |',
  '| myorg/demo | stale  | ?     | —   | ?      | keep-this-note |',
  '| myorg/two  | stale  | ?     | —   | ?      | second note    |',
  '',
  '## §S — Rolling status log',
  '',
  '2026-06-01 10:00 ds:new — created slug=demo phase=P1',
  '',
  '## §Z — Closeout',
  '',
  '_(empty)_',
  '',
].join('\n')

let tmp = ''
let clean = (): void => {}
beforeEach(() => {
  ;({ dir: tmp, clean } = tempRoot('dossier-edit-'))
})
afterEach(() => clean())

function makeFixture(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'DOSSIER.md')
  writeFileSync(file, FIXTURE)
  return file
}

function cell(file: string, id: string, index: number): string {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue
    const fields = line.split('|')
    if ((fields[1] ?? '').trim() === id) return (fields[index] ?? '').trim()
  }
  return ''
}

function stateOf(file: string, id: string): string {
  return cell(file, id, 3)
}

function citeOf(file: string, id: string): string {
  return cell(file, id, 5)
}

function hdrState(file: string): string {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^`[^`]*` · `[^`]*`/.test(line)) return (line.split('`')[3] ?? '').trim()
  }
  return ''
}

function orphans(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => /(^|\/)DOSSIER\.md\./.test(name))
}

function lineMatching(text: string, pattern: RegExp): string {
  return text.split('\n').find((line) => pattern.test(line)) ?? ''
}

function lineNumber(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line)) + 1
}

async function run(args: string[], env: Readonly<Record<string, string>> = {}): Promise<Run> {
  return ds(tmp, args, env)
}

function succeeded(done: Run): void {
  assert.equal(done.code, 0, done.stderr)
}

function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'ignore' })
}

function commit(repo: string, message: string): void {
  git('-C', repo, 'commit', '-q', '--allow-empty', '-m', message)
}

function shapedDir(dir: string, header: string, sep: string, row: string, heading = '## §T — Task ledger', tailHeading = '## §S — log'): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'DOSSIER.md'),
    `# s\n\n${heading}\n\n${header}\n${sep}\n${row}\n\n${tailHeading}\n\n| T1 | decoy | outside | the | tasks | section | — |\n`,
  )
}

test('row-flip sets the state and cite, leaves other rows alone, and refuses bad ids and states', async () => {
  const dir = join(tmp, 'flip')
  const file = makeFixture(dir)

  succeeded(await run(['row-flip', dir, 'T3', '~']))
  assert.equal(stateOf(file, 'T3'), '~', 'flip T3 .->~ did not set state')

  succeeded(await run(['row-flip', dir, 'T3', 'x', '[deadbee]']))
  assert.equal(stateOf(file, 'T3'), 'x', 'flip T3 ->x did not set state')
  assert.equal(citeOf(file, 'T3'), '[deadbee]', 'flip T3 cite not set')

  assert.equal(stateOf(file, 'T1'), 'x', 'T1 state mutated')
  assert.equal(stateOf(file, 'T2'), '~', 'T2 state mutated')
  assert.ok(readFileSync(file, 'utf8').includes('scaffold pkg'), 'T1 task text lost')

  assert.notEqual((await run(['row-flip', dir, 'T99', 'x'])).code, 0, 'missing id should error')

  assert.notEqual((await run(['row-flip', dir, 'T1', 'z'])).code, 0, 'bad state should error')

  assert.deepEqual(orphans(dir), [], 'flip left .tmp orphan')

  assert.notEqual((await run(['row-flip', dir, 'B1', 'x', '[abc]'])).code, 0, 'flip must refuse §B ids (data-loss guard)')
})

test('row-flip to x with an empty cite is refused without mutating, and a real cite succeeds', async () => {
  const dir = join(tmp, 'citex')
  const file = makeFixture(dir)
  assert.notEqual((await run(['row-flip', dir, 'T3', 'x'])).code, 0, 'flip .->x with empty cite must refuse (Vm.3)')
  assert.equal(stateOf(file, 'T3'), '.', 'refused cite-for-x must not mutate state')
  succeeded(await run(['row-flip', dir, 'T3', 'x', '[c0ffee]']))
  assert.equal(stateOf(file, 'T3'), 'x', 'cite-for-x with cite must succeed')
})

async function vm3Parity(label: string, cite: string): Promise<'refused' | 'accepted'> {
  const ws = join(tmp, `vm3-${label}`)
  const dir = join(ws, '.scratchpad', 'dossier', '2026-06-01-vm3')
  const file = makeFixture(dir)
  const flip = await run(['row-flip', dir, 'T3', 'x', cite])
  if (flip.code === 0) {
    const checks = await run(['vm-checks', join(ws, '.scratchpad')])
    assert.equal(checks.code, 0, `flip wrote cite '${cite}' on a ->x row that ds vm-checks reports as a Vm.3 violation`)
    return 'accepted'
  }
  assert.equal(stateOf(file, 'T3'), '.', `flip refused cite '${cite}' but still mutated the T3 state cell`)
  return 'refused'
}

test('row-flip to x agrees with vm-checks about which cites count as empty', async () => {
  assert.equal(await vm3Parity('emdash', '—'), 'refused', 'flip must refuse an em-dash cite on ->x (Vm.3)')
  assert.equal(await vm3Parity('hyphen', '-'), 'refused', 'flip must refuse an ASCII-hyphen cite on ->x (ds vm-checks counts it empty)')
  assert.equal(await vm3Parity('padded-hyphen', '  -  '), 'refused', 'flip must refuse a whitespace-padded ASCII-hyphen cite on ->x')
  assert.equal(await vm3Parity('sha', '[c0ffee]'), 'accepted', 'flip must accept a real cite on ->x, and leave the file Vm.3-clean')
})

test('row-flip does not touch a T-row outside the task section', async () => {
  const dir = join(tmp, 'scope')
  const file = makeFixture(dir)
  appendFileSync(file, '\n| T2 | decoy | fabricated-root-cause | — | — |\n')
  succeeded(await run(['row-flip', dir, 'T2', 'x', '[beef]']))
  assert.ok(readFileSync(file, 'utf8').includes('fabricated-root-cause'), 'flip must not touch a T-row outside §T (section scope)')
})

test('s-append stamps the entry to the second and places it in the status section with blank lines', async () => {
  const dir = join(tmp, 'append')
  const file = makeFixture(dir)

  succeeded(await run(['s-append', dir, 'ds:build T3 START']))
  assert.match(readFileSync(file, 'utf8'), /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} ds:build T3 START$/m, 'append entry missing or no timestamp')

  const lines = readFileSync(file, 'utf8').split('\n')
  const seed = lineNumber(lines, /ds:new — created/)
  const added = lineNumber(lines, /ds:build T3 START/)
  const z = lineNumber(lines, /^## §Z/)
  assert.ok(seed < added && added < z, 'append not placed in §S before §Z')

  assert.equal(lines[added - 2], '', 'no blank line before §S entry')
  assert.equal(lines[added], '', 'no blank line after §S entry')

  const bare = join(tmp, 'no-z')
  mkdirSync(bare, { recursive: true })
  writeFileSync(join(bare, 'DOSSIER.md'), '## §S — Rolling status log\n\n2026-06-01 10:00 ds:new — x\n')
  succeeded(await run(['s-append', bare, 'ds:check — drift=0']))
  assert.ok(readFileSync(join(bare, 'DOSSIER.md'), 'utf8').includes('ds:check — drift=0'), 'append-EOF fallback failed')

  assert.deepEqual(orphans(dir), [], 'append left .tmp orphan')
})

test('header-state rewrites the state token and refuses a bad value or a missing header', async () => {
  const dir = join(tmp, 'hstate')
  const file = makeFixture(dir)

  succeeded(await run(['header-state', dir, 'paused']))
  assert.equal(hdrState(file), 'paused', 'header-state ->paused failed')
  succeeded(await run(['header-state', dir, 'live']))
  assert.equal(hdrState(file), 'live', 'header-state ->live failed')
  assert.ok(readFileSync(file, 'utf8').includes('wire client'), 'header-state clobbered body')

  assert.notEqual((await run(['header-state', dir, 'bogus'])).code, 0, 'header-state bad value should error')

  const bare = join(tmp, 'hstate-nometa')
  mkdirSync(bare, { recursive: true })
  writeFileSync(join(bare, 'DOSSIER.md'), '# x\n\nno meta line here\n')
  assert.notEqual((await run(['header-state', bare, 'paused'])).code, 0, 'header-state no-meta should error')

  assert.deepEqual(orphans(dir), [], 'header-state left .tmp orphan')
})

test('x-refresh rewrites only the target row from the repo state', async () => {
  const dir = join(tmp, 'xref')
  const file = makeFixture(dir)

  const repo = join(tmp, 'repo')
  const remote = join(tmp, 'remote.git')
  git('init', '-q', '-b', 'main', repo)
  commit(repo, 'c1')
  git('-C', repo, 'tag', 'v0.1')
  git('init', '-q', '--bare', remote)
  git('-C', repo, 'remote', 'add', 'origin', remote)
  git('-C', repo, 'push', '-q', '-u', 'origin', 'main')
  commit(repo, 'c2')

  succeeded(await run(['x-refresh', dir, 'myorg/demo', repo]))
  const text = readFileSync(file, 'utf8')
  const demo = lineMatching(text, /^\| +myorg\/demo /)
  assert.notEqual(demo, '', 'x-refresh demo row vanished')
  assert.ok(demo.includes('main'), 'x-refresh did not set branch=main')
  assert.ok(!demo.includes('stale'), 'x-refresh kept stale branch')
  assert.match(demo, /\| 1 \|/, 'x-refresh ahead != 1')
  assert.ok(demo.includes('v0.1'), 'x-refresh tag missing')
  assert.match(demo, /\| no \|/, 'x-refresh pushed != no')
  assert.ok(demo.includes('keep-this-note'), 'x-refresh clobbered notes')

  const two = lineMatching(text, /^\| +myorg\/two /)
  assert.ok(two.includes('second note'), 'x-refresh mutated other row')
  assert.ok(two.includes('stale'), 'x-refresh touched non-target row')

  const repo2 = join(tmp, 'repo2')
  git('init', '-q', '-b', 'main', repo2)
  commit(repo2, 'c1')
  succeeded(await run(['x-refresh', dir, 'myorg/two', repo2]))
  assert.ok(lineMatching(readFileSync(file, 'utf8'), /^\| +myorg\/two /).includes('no-upstream'), 'x-refresh no-upstream not set')

  assert.notEqual((await run(['x-refresh', dir, 'myorg/absent', repo])).code, 0, 'x-refresh missing label should error')

  assert.deepEqual(orphans(dir), [], 'x-refresh left .tmp orphan')
})

test('row-flip finds the state and cite cells by the header names, under either heading spelling', async () => {
  const header = '| id | state | who | task | needs | cite | verify |'
  const sep = '|----|-------|-----|------|-------|------|--------|'
  const row = '| T1 | .     | A   | one  | —     | —    | —      |'

  const sigil = join(tmp, 'whoneeds')
  shapedDir(sigil, header, sep, row)
  const flipped = await run(['row-flip', sigil, 'T1', 'x', 'abc123'])
  assert.equal(flipped.code, 0, 'flip must succeed on the who/needs layout')
  const line = lineMatching(readFileSync(join(sigil, 'DOSSIER.md'), 'utf8'), /^\| *T1 /)
  const cells = line.split('|')
  assert.match(cells[2] ?? '', /x/, `state is written to the cell the header names, got: ${line}`)
  assert.match(cells[6] ?? '', /abc123/, `cite is written to the cell the header names, got: ${line}`)
  assert.ok(line.includes(' A '), `flip clobbered the who cell, got: ${line}`)

  const worded = join(tmp, 'worded')
  shapedDir(worded, header, sep, row, '## Tasks', '## Status')
  const wordedFlip = await run(['row-flip', worded, 'T1', 'x', 'abc123'])
  assert.equal(wordedFlip.code, 0, 'flip must succeed under the worded Tasks heading')
  const wordedText = readFileSync(join(worded, 'DOSSIER.md'), 'utf8')
  const wordedCells = lineMatching(wordedText, /^\| *T1 /).split('|')
  assert.ok(/x/.test(wordedCells[2] ?? '') && /abc123/.test(wordedCells[6] ?? ''), 'worded heading must reach the same cells as the sigil heading')
  assert.ok(wordedText.includes('outside | the | tasks | section'), 'the worded tail heading must end the Tasks section, leaving a later T1 row untouched')
})

test('row-flip refuses a header that names no state or cite, and a row shorter than the header', async () => {
  const bare = join(tmp, 'noheader')
  shapedDir(bare, '| id | status | owner | task |', '|----|--------|-------|------|', '| T1 | .      | A     | one  |')
  assert.notEqual(
    (await run(['row-flip', bare, 'T1', 'x', 'abc123'])).code,
    0,
    'a §T header naming neither state nor cite must be refused, not edited by position',
  )
  assert.match(readFileSync(join(bare, 'DOSSIER.md'), 'utf8'), /^\| T1 \| \. /m, 'refused flip must leave the ledger untouched')

  const ragged = join(tmp, 'ragged')
  mkdirSync(ragged, { recursive: true })
  writeFileSync(
    join(ragged, 'DOSSIER.md'),
    '# r\n\n## Tasks\n\n| id | state | who | task | needs | cite | verify |\n|----|-------|-----|------|-------|------|--------|\n| T1 | .     | A   | one  |\n',
  )
  assert.notEqual(
    (await run(['row-flip', ragged, 'T1', 'x', 'ab12'])).code,
    0,
    'a row with fewer cells than the header names must be refused, not written past its end',
  )
  assert.match(readFileSync(join(ragged, 'DOSSIER.md'), 'utf8'), /^\| T1 \| \. /m, 'a refused ragged flip must leave the row untouched')
})
