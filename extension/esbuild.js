const esbuild = require('esbuild')
const fs = require('fs')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  // Sourcemaps only in dev/watch — a production build (and thus the packaged
  // VSIX) ships no .map, so extension source isn't bundled into the artifact.
  sourcemap: watch,
  minify: !watch,
  define: {
    // Bakes an OpenRouter key into the bundle for study VSIX builds. Set
    // OPENROUTER_API_KEY in the BUILD environment (never committed to git):
    //   OPENROUTER_API_KEY=sk-or-... pnpm run build:all
    // Empty in normal/dev builds. See src/baked-config.ts. NOTE: a baked key is
    // only obfuscated, not secret — anyone with the .vsix can extract it, so use
    // a spend-capped, rotatable key.
    __BAKED_OPENROUTER_KEY__: JSON.stringify(process.env.OPENROUTER_API_KEY || ''),
  },
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await esbuild.build(config)
    // Production build ships no sourcemap; remove any stale one left by a prior
    // dev/watch build so it never sneaks into the packaged VSIX.
    try { fs.unlinkSync('dist/extension.js.map') } catch { /* none present */ }
    console.log('Build complete')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
