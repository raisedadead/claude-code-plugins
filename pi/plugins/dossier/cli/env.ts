const OWN = ['DOSSIER_LEDGER_ROOT', 'DOSSIER_SCRATCHPAD_ROOT'] as const
const inherited = new Map<string, string | undefined>()

export function claimRoots(ledger: string): void {
  for (const name of OWN) {
    inherited.set(name, process.env[name])
    process.env[name] ??= ledger
  }
}

export function childEnv(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  for (const name of OWN) {
    if (!inherited.has(name)) continue
    const outer = inherited.get(name)
    if (outer === undefined) delete env[name]
    else env[name] = outer
  }
  return env
}
