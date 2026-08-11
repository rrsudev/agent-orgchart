#!/usr/bin/env node
/**
 * Builds the dev relay by bundling scripts/dev-relay.ts with extension source.
 * Aliases the `vscode` module to a minimal shim so extension code runs outside VS Code.
 *
 * Modes:
 *   node build-relay.js            one-shot bundle (used by prod/one-off builds)
 *   node build-relay.js --watch    rebuild on source change AND (re)start the
 *                                   relay child so edits to relay.ts / extension
 *                                   source take effect without a manual restart.
 */
'use strict'

const esbuild = require('esbuild')
const path = require('path')
const { spawn } = require('child_process')

const outfile = path.join(__dirname, '.dev-relay.js')
const buildOptions = {
  entryPoints: [path.join(__dirname, 'dev-relay.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile,
  alias: {
    'vscode': path.join(__dirname, 'vscode-shim.js'),
  },
  sourcemap: true,
  logLevel: 'warning',
}

const watch = process.argv.includes('--watch')

if (!watch) {
  esbuild.buildSync(buildOptions)
} else {
  // Watch mode: on every successful (re)build, (re)spawn the relay so relay.ts
  // and bundled extension-source edits go live without a manual restart. This
  // avoids the "my fix isn't running" trap where a long-lived relay keeps
  // serving a stale bundle from process start.
  let child = null
  const startRelay = () => {
    if (child) child.kill('SIGTERM')
    child = spawn('node', [outfile], { stdio: 'inherit', env: process.env })
    child.on('exit', (code, signal) => {
      // Ignore restarts we triggered (SIGTERM); surface genuine crashes.
      if (signal !== 'SIGTERM' && code) console.error(`[relay] exited with code ${code}`)
    })
  }

  const restartPlugin = {
    name: 'restart-relay',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) startRelay()
        else console.error('[relay] build failed; keeping previous relay running')
      })
    },
  }

  esbuild.context({ ...buildOptions, plugins: [restartPlugin] }).then(async (ctx) => {
    await ctx.watch()
    console.log('[relay] watching for changes…')
    const shutdown = () => {
      if (child) child.kill('SIGTERM')
      ctx.dispose().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
