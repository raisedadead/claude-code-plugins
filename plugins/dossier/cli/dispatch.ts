import { Refusal } from '../engine/sh.ts'
import { cmdAnchors, cmdDone, cmdIntegrate, cmdLanes, cmdMission, cmdNext, cmdVerify } from './build.ts'
import { cmdCi, cmdHandoff, cmdStatus } from './handoff.ts'
import { type Args, cmdAdd, cmdAmend, cmdCheck, cmdLint, cmdLog, cmdNew, cmdPackPlan, cmdPath, cmdRecordPlan, cmdSet, cmdTriage } from './plan.ts'
import { cmdClose, cmdPackReview, cmdRecordReview, cmdShape, cmdShipArgs } from './ship.ts'

type Command = { run: (cwd: string, args: Args) => string; usage: string }

export const COMMANDS: Record<string, Command> = {
  triage: {
    run: cmdTriage,
    usage:
      'triage [--json] [--start]  rows that wait on you, due deferred rows, stale and out-of-shape rows, live dossiers; --start prints only due rows, out-of-shape rows and changed plans',
  },
  new: { run: cmdNew, usage: 'new <slug> [--branch b] [--base b]  folder, plan file, branch name, worklog' },
  add: { run: cmdAdd, usage: 'add "<title>" [--who A|H] [--state s] [--tail t] [--register]  a row with the next O number' },
  set: { run: cmdSet, usage: 'set <id> <state> [tail] [--who A|H]  change a row state' },
  log: { run: cmdLog, usage: 'log "<note>"  a line in the worklog' },
  lint: { run: cmdLint, usage: 'lint  check the plan file' },
  check: {
    run: cmdCheck,
    usage: 'check [--baseline]  run the checks; with --baseline each non-guard check must fail, and each check with a samples/<name>/ folder runs there too',
  },
  'pack plan': { run: cmdPackPlan, usage: 'pack plan  one file for the plan checker' },
  'record plan': { run: cmdRecordPlan, usage: 'record plan <findings>  store the plan check verdict and the checked text (exit 1: CHANGES)' },
  amend: { run: cmdAmend, usage: 'amend <rulings>  check the plan again by code after a ruling on each finding, or after an edit' },
  anchors: { run: cmdAnchors, usage: 'anchors  one empty commit per planned commit, on the dossier branch' },
  lanes: { run: cmdLanes, usage: 'lanes [--json]  planned commits grouped by paths that do not overlap' },
  next: { run: cmdNext, usage: 'next  the next agent row (exit 3: waits on you; exit 4: none left)' },
  mission: { run: cmdMission, usage: 'mission <id>  the task file for a row' },
  verify: { run: cmdVerify, usage: 'verify <id>  the row checks, guard checks, commit form and planned paths' },
  done: { run: cmdDone, usage: 'done <id> [--cite "<decision>"]  mark a verified row done' },
  integrate: { run: cmdIntegrate, usage: 'integrate <lane>  rebase a lane onto the dossier branch' },
  'pack review': { run: cmdPackReview, usage: 'pack review [--full] [--base b] [--agent a]  one file for the reviewer' },
  'record review': { run: cmdRecordReview, usage: 'record review <findings>  log the verdict; a PASS sets state ship' },
  shape: { run: cmdShape, usage: 'shape  fold fixup! commits into the planned commits' },
  'ship-args': { run: cmdShipArgs, usage: 'ship-args  the worktree path, branch, base and PR title as JSON' },
  close: { run: cmdClose, usage: 'close "<one line>"  close the dossier and move it to _archive' },
  handoff: { run: cmdHandoff, usage: 'handoff  the next step for this dossier, one line per step' },
  status: {
    run: cmdStatus,
    usage:
      'status [--session <id>]  one line per dossier: slug · stage · done/rows · next row · [H] rows that wait on the operator. With --session, the live dossiers that session used; else the dossier of this branch, or every live one; writes nothing',
  },
  ci: { run: cmdCi, usage: 'ci  wait for the CI runs of the branch tip, pushed on the branch or on the base (exit 1: a run failed)' },
  path: { run: cmdPath, usage: 'path  the live dossier folder' },
}

const VALUE_FLAGS = new Set(['dossier', 'who', 'state', 'tail', 'branch', 'base', 'cite', 'agent', 'session'])

export function parse(argv: string[]): Args {
  const args: Args = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i] ?? ''
    if (!word.startsWith('--')) {
      args._.push(word)
      continue
    }
    const [name = '', inline] = word.slice(2).split(/=(.*)/s)
    if (inline !== undefined) args.flags[name] = inline
    else if (VALUE_FLAGS.has(name)) {
      const value = argv[i + 1]
      if (value === undefined) throw new Refusal(`--${name} needs a value`, 2)
      args.flags[name] = value
      i += 1
    } else args.flags[name] = true
  }
  return args
}

export function help(): string {
  return ['usage: ds <command>', '', ...Object.values(COMMANDS).map((c) => `  ds ${c.usage}`)].join('\n')
}

export function main(
  argv: string[],
  cwd = process.cwd(),
  out: (text: string) => unknown = (text) => process.stdout.write(`${text}\n`),
  err: (text: string) => unknown = (text) => process.stderr.write(`${text}\n`),
): number {
  const [first = '', second = '', ...rest] = argv
  const pair = `${first} ${second}`
  const name = COMMANDS[pair] ? pair : first
  const command = COMMANDS[name]
  if (first === 'help' || first === '--help') {
    out(help())
    return 0
  }
  if (!command) {
    err(help())
    return 2
  }
  try {
    const args = parse(COMMANDS[pair] ? rest : argv.slice(1))
    out(command.run(cwd, args))
    return 0
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    err(`ds ${name}: ${error.message}`)
    return error.code
  }
}
