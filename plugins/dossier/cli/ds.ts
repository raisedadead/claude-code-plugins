const EXIT_INTERNAL = 70
const EXIT_READER_GONE = 141

try {
  const { main } = await import('./dispatch.ts')
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EPIPE' && 'syscall' in error && error.syscall === 'write') {
    process.exitCode = EXIT_READER_GONE
  } else {
    console.error(`ds: internal error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = EXIT_INTERNAL
  }
}

export {}
