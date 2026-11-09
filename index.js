/**
 * Host half of `dsh-splash`.
 *
 * Contributes the opening sequence to every index.html the Host serves, or the
 * Desktop shell renders from disk: one style row and one body script row in the
 * Web server's index-injection table. The rows run before the shell mounts, so
 * the splash covers the stock boot card from the first paint and hands the
 * screen back to the workspace once the application is on stage.
 *
 * @module dsh-splash
 */
import { readFileSync } from 'node:fs'

/** Stable Cordis plugin name; the Loader row resolves it. */
export const name = 'dsh-splash'

/** Inline style row: the splash layout, palette fallbacks and easing timeline. */
const STYLE = readFileSync(new URL('./browser/splash.css', import.meta.url), 'utf8')

/** Body script row: builds the mark, measures it and drives the hand-off. */
const SCRIPT = readFileSync(new URL('./browser/splash.js', import.meta.url), 'utf8')

/**
 * Register the index rows.
 * @param {object} ctx Cordis context of this plugin.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push(
      { kind: 'style', text: STYLE },
      { kind: 'script', placement: 'body', text: SCRIPT },
    )
  }), 'dsh-splash')
}
