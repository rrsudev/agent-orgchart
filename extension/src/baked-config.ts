/**
 * Build-time baked configuration.
 *
 * `__BAKED_OPENROUTER_KEY__` is replaced by esbuild's `define` with a string
 * literal at build time (see esbuild.js). It's the OpenRouter API key read from
 * the BUILD environment's OPENROUTER_API_KEY — empty in dev/normal builds.
 *
 * This lets a study VSIX ship with a working key so the 8 participants need zero
 * setup, WITHOUT the key ever living in source/git. Caveat: a bundled key is
 * obfuscated, not secret — a .vsix is a zip and the literal can be extracted, so
 * bake only a spend-capped, rotatable key.
 */

// Declared for the type checker; the value is substituted by esbuild at build
// time. `typeof` guards against a non-esbuild runtime (never throws for an
// undeclared identifier), so this is safe even if the define is somehow absent.
declare const __BAKED_OPENROUTER_KEY__: string

export const BAKED_OPENROUTER_KEY: string =
  typeof __BAKED_OPENROUTER_KEY__ === 'string' ? __BAKED_OPENROUTER_KEY__ : ''

export const HAS_BAKED_OPENROUTER_KEY = BAKED_OPENROUTER_KEY.length > 0
