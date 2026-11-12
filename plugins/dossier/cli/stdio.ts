import { readFileSync, writeSync } from 'node:fs'

export const io: { stdin: () => string; out: (text: string) => void } = {
  stdin: () => readFileSync(0, 'utf8'),
  out: (text) => {
    writeSync(1, text)
  },
}
