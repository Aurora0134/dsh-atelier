/**
 * Host half of `dsh-splash`.
 *
 * Contributes the opening sequence to every index.html the Host serves, or the
 * Desktop shell renders from disk: one style row and one body script row in the
 * Web server's index-injection table. The rows run before the shell mounts, so
 * the splash covers the stock boot card from the first paint and hands the
 * screen back to the workspace once the application is on stage.
 *
 * The brand art travels with the plugin: the sidebar wordmark and whale are
 * baked into the body script, so the splash does not depend on the frontend's
 * internal asset hashes or on a font being loaded.
 *
 * @module dsh-splash
 */
import { readFileSync } from 'node:fs'

/** Stable Cordis plugin name; the Loader row resolves it. */
export const name = 'dsh-splash'

/** Inline style row: the splash layout, palette fallbacks and easing timeline. */
const STYLE = readFileSync(new URL('./browser/splash.css', import.meta.url), 'utf8')

/** Body script row, with the brand vector art substituted in. */
const SCRIPT = readFileSync(new URL('./browser/splash.js', import.meta.url), 'utf8')

/** Brand art, copied from the sidebar lockup the frontend renders. */
const WHALE_SVG = readFileSync(new URL('./browser/whale.svg', import.meta.url), 'utf8').trim()
const WORDMARK_SVG = readFileSync(new URL('./browser/wordmark.svg', import.meta.url), 'utf8').trim()

/**
 * Replace one quoted placeholder with a JS string literal holding `value`.
 * @param {string} source script text carrying the placeholder.
 * @param {string} token quoted placeholder, e.g. `'__DSH_SPLASH_WHALE__'`.
 * @param {string} value raw markup.
 * @returns {string} script with the literal in place.
 */
function substitute(source, token, value) {
  if (!source.includes(token)) throw new Error(`dsh-splash: ${token} missing from browser/splash.js`)
  return source.replace(token, JSON.stringify(value))
}

const BODY = substitute(
  substitute(SCRIPT, "'__DSH_SPLASH_WHALE__'", WHALE_SVG),
  "'__DSH_SPLASH_WORDMARK__'",
  WORDMARK_SVG,
)

/**
 * Register the index rows.
 * @param {object} ctx Cordis context of this plugin.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push(
      { kind: 'style', text: STYLE },
      { kind: 'script', placement: 'body', text: BODY },
    )
  }), 'dsh-splash')
}
