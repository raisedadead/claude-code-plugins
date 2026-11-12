import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ds } from './inproc.ts'
import { git, template } from './repo.ts'

const repos = template((dir) => {
  git(dir, 'init', '-q', '-b', 'main')
  const put = (path: string, text: string): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  put('src/a.ts', 'line one\nline two\nline three\n')
  put('src/twin/x.ts', 'x\n')
  put('lib/twin/x.ts', 'x\n')
  put('docs/old.md', 'see oldskill here\n')
  put('docs/keep.md', 'nothing\n')
  put('CHANGELOG.md', 'oldskill was added\n')
  put('evals/results/r.json', '{"oldskill": 1}\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'seed')
})

afterAll(() => repos.clean())

const FAILS_TODAY = '| 1 | `test -e no-such-file` | exit 0 |'
const GUARD = '| 2 | `true` | exit 0 guard |'

function notes(body: string[], rows: string[] = [FAILS_TODAY, GUARD]): string {
  return ['# design', '', ...body, '', '## done-when', '', '| id | command | expect |', '| --- | --- | --- |', ...rows, ''].join('\n')
}

async function check(text: string, name = 'design-notes.md'): Promise<{ code: number; lines: string[]; repo: string; path: string }> {
  const repo = repos.copy('ds-design-')
  const dir = join(repo, '.scratchpad', 'tmp')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, text)
  const done = await ds(repo, ['design-check', path, repo])
  return { code: done.code, lines: done.stdout.trimEnd().split('\n'), repo, path }
}

test('a clean design passes and writes each cited line to the evidence file', async () => {
  const { code, lines, path } = await check(notes(['Claim at `src/a.ts:2` and `a.ts:1-3`.', '', 'REMOVES: oldskill', '', 'Files: docs/old.md']))
  assert.equal(code, 0, lines.join('\n'))
  assert.match(lines.at(-1) ?? '', /^DESIGN: OK cites=2 checks=2 removes=1 evidence=/)
  const evidence = readFileSync(path.replace(/\.md$/, '-evidence.md'), 'utf8')
  assert.ok(evidence.includes('2: line two'), evidence)
  assert.ok(evidence.includes('3: line three'), evidence)
})

test('a cite to a missing file, a line past the end, line 0, a reversed range or an ambiguous name fails', async () => {
  const body = ['`src/a.ts:4`', '`src/gone.ts:1`', '`src/a.ts:0`', '`src/a.ts:3-2`', '`x.ts:1`']
  const { code, lines } = await check(notes(body))
  assert.equal(code, 1, lines.join('\n'))
  for (const cite of ['src/a.ts:4', 'src/gone.ts:1', 'src/a.ts:0', 'src/a.ts:3-2', 'x.ts:1']) {
    assert.ok(
      lines.some((line) => line.startsWith(`FAIL cite ${cite}`)),
      `${cite}\n${lines.join('\n')}`,
    )
  }
  assert.match(lines.at(-1) ?? '', /^DESIGN: FAIL 5 /)
})

test('a URL, a host:port and a fenced code sample are not cites', async () => {
  const body = ['See https://example.com/page.md:12 and localhost:3000.', '', '```', 'foo.ts:12', '```']
  const { code, lines } = await check(notes(body))
  assert.equal(code, 0, lines.join('\n'))
  assert.match(lines.at(-1) ?? '', /^DESIGN: OK cites=0 /)
})

test('a check that passes today fails the design, and so does one that did not run', async () => {
  const { code, lines } = await check(notes([], ['| 1 | `true` | exit 0 |', '| 2 | `no-such-command-xyz` | exit 0 |', GUARD]))
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(
    lines.some((line) => line.startsWith('FAIL check 1')),
    lines.join('\n'),
  )
  assert.ok(
    lines.some((line) => line.startsWith('FAIL check 2')),
    lines.join('\n'),
  )
})

test('a guard row that fails today fails the design', async () => {
  const { code, lines } = await check(notes([], [FAILS_TODAY, '| 2 | `false` | exit 0 guard |']))
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(
    lines.some((line) => line.startsWith('FAIL check 2')),
    lines.join('\n'),
  )
})

test('notes with no done-when rows fail', async () => {
  const { code, lines } = await check('# design\n\nNo checks.\n')
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(
    lines.some((line) => line.startsWith('FAIL checks')),
    lines.join('\n'),
  )
})

test('a removed name with a hit file the notes do not list fails; CHANGELOG.md and evals/results do not count', async () => {
  const { code, lines } = await check(notes(['REMOVES: oldskill']))
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.includes('FAIL removes oldskill: docs/old.md is not in the notes'), lines.join('\n'))
  assert.equal(lines.filter((line) => line.startsWith('FAIL removes')).length, 1, lines.join('\n'))
})

test('a hit path listed only as the tail of a longer path does not count', async () => {
  const { code, lines } = await check(notes(['REMOVES: oldskill', '', 'Files: archive/docs/old.md']))
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.includes('FAIL removes oldskill: docs/old.md is not in the notes'), lines.join('\n'))
})

test('a removed name is covered by a listed repo folder, but not by ./', async () => {
  const listed = await check(notes(['REMOVES: oldskill', '', 'Deleted: docs/']))
  assert.equal(listed.code, 0, listed.lines.join('\n'))
  const bare = await check(notes(['REMOVES: oldskill', '', 'Everything under ./ goes.']))
  assert.equal(bare.code, 1, bare.lines.join('\n'))
})

test('an empty REMOVES line, a notes path without .md, or a notes path ending -evidence.md is a parse error', async () => {
  const empty = await check(notes(['REMOVES: ``']))
  assert.equal(empty.code, 2, empty.lines.join('\n'))
  assert.match(empty.lines.at(-1) ?? '', /^DESIGN: PARSE/)
  const plain = await check(notes([]), 'design-notes.txt')
  assert.equal(plain.code, 2, plain.lines.join('\n'))
  const evidence = await check(notes([]), 'design-evidence.md')
  assert.equal(evidence.code, 2, evidence.lines.join('\n'))
  assert.ok(!existsSync(evidence.path.replace(/\.md$/, '-evidence.md')))
})

test('a missing argument is a parse error', async () => {
  const repo = repos.copy('ds-design-')
  const done = await ds(repo, ['design-check'])
  assert.equal(done.code, 2, done.stdout)
  assert.match(done.stdout, /DESIGN: PARSE/)
})
