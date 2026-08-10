#!/usr/bin/env node
/**
 * CLI: rebuild study.sqlite from a study-storage folder.
 *
 *   pnpm run study:index [path/to/study-storage]
 *   node --import tsx scripts/study-index.ts [path/to/study-storage]
 *
 * Defaults to ./study-storage. Rebuilds the index from scratch (idempotent).
 * Requires Node >= 22.5 for the built-in node:sqlite module.
 */
import * as path from 'path'
import * as fs from 'fs'
import { buildIndex, isSqliteAvailable } from '../extension/src/study-index'

function main() {
  if (!isSqliteAvailable()) {
    console.error('Error: node:sqlite is unavailable. Indexing requires Node >= 22.5.')
    console.error('(Your raw study-storage data is unaffected — only the SQLite index needs a newer Node.)')
    process.exit(1)
  }

  const arg = process.argv[2] || 'study-storage'
  const root = path.resolve(arg)
  if (!fs.existsSync(root)) {
    console.error(`Error: study-storage folder not found: ${root}`)
    process.exit(1)
  }

  console.log(`Building index from ${root} ...`)
  const r = buildIndex(root, { verbose: false })
  console.log(`Wrote ${r.dbPath}`)
  console.log(`  ${r.sessions} sessions, ${r.agents} agents, ${r.turns} turns,`)
  console.log(`  ${r.toolCalls} tool calls, ${r.hookEvents} hook events, ${r.events} events, ${r.files} file ops`)
}

main()
