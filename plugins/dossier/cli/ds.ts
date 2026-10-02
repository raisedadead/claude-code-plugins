const EXIT_INTERNAL = 70

try {
  const { main } = await import('./dispatch.ts')
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`ds: internal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = EXIT_INTERNAL
}

export {}
