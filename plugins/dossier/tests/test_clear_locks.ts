import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, type Run, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function isoAgo(seconds: number): string {
  const epoch = Math.floor(Date.now() / 1000) - seconds
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''])
  assert.ok(child.pid)
  return child.pid
}

function fixture(): { tmp: string; dd: string; mklock: (name: string, text: string) => void; lock: (name: string) => string } {
  const { dir, clean } = tempRoot('dossier-locks-')
  cleanups.push(clean)
  const dd = join(dir, 'dossier')
  return {
    tmp: dir,
    dd,
    mklock: (name, text) => {
      mkdirSync(join(dd, name), { recursive: true })
      writeFileSync(join(dd, name, '.ds-lock'), text)
    },
    lock: (name) => join(dd, name, '.ds-lock'),
  }
}

test('stale locks are cleared by pid liveness, started age, or the mtime fallback, and live or fresh ones survive', async () => {
  const { tmp, dd, mklock, lock } = fixture()
  mklock('deadpid', `{"pid": ${deadPid()}, "started": "${isoAgo(60)}", "skill": "ds:build"}`)
  mklock('livefresh', `{"pid": ${process.pid}, "started": "${isoAgo(60)}", "skill": "ds:build"}`)
  mklock('livebad', `{"pid": ${process.pid}, "started": "garbage", "skill": "ds:build"}`)
  mklock('oldstale', `{"started": "${isoAgo(3600)}", "skill": "ds:build"}`)
  mklock('unparsefresh', '{"started": "not-a-date", "skill": "ds:build"}')
  mklock('malformedfresh', '{"skill": "ds:build"}')
  mklock('oldmalformed', '{"skill": "ds:close"}')
  const old = new Date(2020, 0, 1, 0, 0)
  utimesSync(lock('oldmalformed'), old, old)

  await clearLocks(tmp, [dd])

  assert.ok(!existsSync(lock('deadpid')), 'dead-pid lock must be cleared')
  assert.ok(existsSync(lock('livefresh')), 'live-pid fresh lock must survive')
  assert.ok(existsSync(lock('livebad')), 'live-pid lock must survive an unparseable started (Vm.9)')
  assert.ok(!existsSync(lock('oldstale')), '>30min lock (parseable started) must be cleared')
  assert.ok(existsSync(lock('unparsefresh')), 'no-pid unparseable-started with FRESH mtime must survive (age via mtime)')
  assert.ok(existsSync(lock('malformedfresh')), 'no-pid no-started with FRESH mtime must survive (active terse-form lock)')
  assert.ok(!existsSync(lock('oldmalformed')), 'no-pid no-started with OLD mtime must be cleared (mtime fallback)')
})

async function clearLocks(cwd: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const run = await ds(cwd, ['clear-locks', ...args], env)
  assert.equal(run.code, 0, run.stderr)
  return run
}

test('a 40min-old UTC lock reads stale under a non-UTC TZ', async () => {
  const { tmp, dd, mklock, lock } = fixture()
  mklock('tzstale', `{"started": "${isoAgo(2400)}", "skill": "ds:build"}`)

  await clearLocks(tmp, [dd], { TZ: 'Asia/Kolkata' })

  assert.ok(!existsSync(lock('tzstale')), '40min-old UTC lock must read stale under a non-UTC TZ (TZ=UTC parse)')
})

test('--dry-run reports without clearing, before or after the dir, and a later plain run clears', async () => {
  const { tmp, dd, mklock, lock } = fixture()
  mklock('drystale', `{"started": "${isoAgo(3600)}", "skill": "ds:build"}`)
  mklock('dryfresh', `{"pid": ${process.pid}, "started": "${isoAgo(60)}", "skill": "ds:build"}`)

  const dry = await clearLocks(tmp, [dd, '--dry-run'])
  assert.ok(existsSync(lock('drystale')), '--dry-run must NOT clear a stale lock')
  assert.ok(existsSync(lock('dryfresh')), '--dry-run must leave fresh locks untouched')
  assert.match(dry.stdout, /would clear/, '--dry-run must report would-clear on stdout')
  assert.match(dry.stdout, /drystale/, '--dry-run report must name the stale lock')

  const flagFirst = await clearLocks(tmp, ['--dry-run', dd])
  assert.ok(existsSync(lock('drystale')), '--dry-run before dir must also be non-mutating')
  assert.match(flagFirst.stdout, /drystale/, '--dry-run before dir must still report')

  await clearLocks(tmp, [dd])
  assert.ok(!existsSync(lock('drystale')), 'non-dry run after dry-run must actually clear the stale lock')
})
