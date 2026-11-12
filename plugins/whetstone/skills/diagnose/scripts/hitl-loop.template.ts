import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

const terminal = createInterface({ input: stdin })
const lines = terminal[Symbol.asyncIterator]()
const captured: Record<string, string> = {}

async function ask(prompt: string): Promise<string> {
  stdout.write(prompt)
  const next = await lines.next()
  return next.done ? '' : next.value
}

async function step(instruction: string): Promise<void> {
  stdout.write(`\n>>> ${instruction}\n`)
  await ask('    [Enter when done] ')
}

async function capture(key: string, question: string): Promise<void> {
  stdout.write(`\n>>> ${question}\n`)
  captured[key] = await ask('    > ')
}

async function main(): Promise<void> {
  await step('Open the app at http://localhost:3000 and sign in.')
  await capture('ERRORED', "Click the 'Export' button. Did it throw an error? (y/n)")
  await capture('ERROR_MSG', "Paste the error message (or 'none'):")
}

await main()
terminal.close()
stdout.write('\n--- Captured ---\n')
for (const [key, value] of Object.entries(captured)) stdout.write(`${key}=${value}\n`)
