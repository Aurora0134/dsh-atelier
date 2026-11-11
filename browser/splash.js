/*
 * Opening brand sequence for the DSH shell.
 *
 * Runs from the index body before the shell mounts. It covers the stock boot
 * card, plays the mark sequence — the whale and the "deepseek" wordmark
 * surface, the row opens at the badge seam, the HARNESS badge rises into the
 * opening — and fades the layer out once the application is on stage. A boot
 * failure cancels the sequence so the shell's own diagnostics stay reachable.
 *
 * The mark is the shell's own sidebar lockup, split at the badge: one copy of
 * the wordmark clipped to the whale plus "deepseek", another clipped to the
 * badge. Both use the app's vector art, so the splash draws the same shapes as
 * the sidebar instead of approximating the brand in a font.
 */
;(() => {
  'use strict'

  const OVERLAY_CLASS = 'dsh-splash'
  const READY_CLASS = 'is-ready'
  const OPEN_CLASS = 'is-open'
  const LEAVING_CLASS = 'is-leaving'
  const REDUCED_CLASS = 'is-reduced'
  const BOOT_SELECTOR = '[data-dsh-boot]'
  const SPINNER_SELECTOR = '[data-dsh-boot-spinner]'
  const APP_ROOT_ID = 'root'
  const GUARD = '__dshSplashMounted'

  /**
   * Split geometry in the wordmark's own units (its viewBox is `26 0 156 24`):
   * the letters run to x = 121.6 and the badge pill starts at x = 129.3.
   */
  const LEFT_VIEW_BOX = '26.85 0 94.75 24'
  const BADGE_VIEW_BOX = '129.3 0 52.1 24'

  /** Vector art, substituted by the Host half from `browser/*.svg`. */
  const WHALE_SVG = '__DSH_SPLASH_WHALE__'
  const WORDMARK_SVG = '__DSH_SPLASH_WORDMARK__'

  /** Split and badge motion end, plus the hold before the hand-off (ms). */
  const REVEAL_AFTER = 460 + 760 + 520
  /** Bounded wait for a workspace that never mounts; the stock boot screen returns. */
  const GIVE_UP_AFTER = 15000
  /** Poll cadence for the boot card and the application mount. */
  const POLL_MS = 120

  if (globalThis[GUARD] === true) return
  globalThis[GUARD] = true

  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

  // A late injection can find the workspace already painted; there is nothing to cover.
  const bootAtStart = document.querySelector(BOOT_SELECTOR)
  const rootAtStart = document.getElementById(APP_ROOT_ID)
  if (bootAtStart === null && rootAtStart !== null && rootAtStart.childElementCount > 0) return

  /** Parse markup into its single root element; the template keeps the SVG namespace. */
  const parseSvg = (markup) => {
    const template = document.createElement('template')
    template.innerHTML = markup
    return template.content.firstElementChild
  }

  /**
   * The badge copy shares the wordmark's clip ids, so suffix them and point the
   * knockout fills at the splash's own canvas colour instead of the app token.
   */
  const badgeCopy = (markup) => markup
    .replace(/id="([^"]+)"/g, (_, id) => `id="${id}-badge"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}-badge)`)
    .replaceAll('var(--dsw-alias-label-primary-inverted)', 'var(--dsh-splash-inverted)')

  const whale = parseSvg(WHALE_SVG)
  whale.setAttribute('class', `${OVERLAY_CLASS}-whale`)

  const wordmark = parseSvg(WORDMARK_SVG)
  wordmark.setAttribute('class', `${OVERLAY_CLASS}-mark`)
  wordmark.setAttribute('viewBox', LEFT_VIEW_BOX)

  const badge = parseSvg(badgeCopy(WORDMARK_SVG))
  badge.setAttribute('class', `${OVERLAY_CLASS}-badge`)
  badge.setAttribute('viewBox', BADGE_VIEW_BOX)

  const slot = document.createElement('span')
  slot.className = `${OVERLAY_CLASS}-slot`
  slot.append(badge)

  const word = document.createElement('div')
  word.className = `${OVERLAY_CLASS}-word`
  word.append(whale, wordmark, slot)

  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.setAttribute('aria-hidden', 'true')
  overlay.append(word)
  document.body.append(overlay)

  let mounted = false
  let started = false
  let removed = false
  let pendingReveal = false
  let pollTimer
  let revealTimer
  let giveUpTimer

  /** Retire the layer; `quick` shortens the fade for failure hand-backs. */
  const retire = (quick = false) => {
    if (removed) return
    removed = true
    clearInterval(pollTimer)
    clearTimeout(revealTimer)
    clearTimeout(giveUpTimer)
    if (quick) overlay.style.transitionDuration = '140ms'
    overlay.classList.add(LEAVING_CLASS)
    setTimeout(() => overlay.remove(), quick ? 180 : 520)
  }

  /** Observe the boot card: its spinner leaving means the shell reported a failure. */
  const check = () => {
    if (removed) return
    const boot = document.querySelector(BOOT_SELECTOR)
    if (boot !== null) {
      if (boot.querySelector(SPINNER_SELECTOR) === null) {
        retire(true)
        return
      }
      return
    }
    const root = document.getElementById(APP_ROOT_ID)
    if (root !== null && root.childElementCount > 0) {
      mounted = true
      // A page that mounted while hidden (the window was shown only afterwards)
      // gets no intro: uncovered at once instead of holding a blank layer.
      if (!started || pendingReveal) retire()
    }
  }

  const reveal = () => {
    if (removed) return
    check()
    if (removed) return
    if (mounted) retire()
    else pendingReveal = true
  }

  pollTimer = setInterval(check, POLL_MS)
  giveUpTimer = setTimeout(() => retire(), GIVE_UP_AFTER)

  if (reduceMotion) {
    overlay.classList.add(READY_CLASS, REDUCED_CLASS)
    word.classList.add(OPEN_CLASS)
    revealTimer = setTimeout(reveal, 900)
    return
  }

  // Two frames: the first commits the covered frame, the second starts the timeline.
  requestAnimationFrame(() => {
    // A window revealed only after its workspace mounted gets no intro.
    if (mounted) {
      retire()
      return
    }
    started = true
    overlay.classList.add(READY_CLASS)
    requestAnimationFrame(() => {
      word.classList.add(OPEN_CLASS)
    })
    revealTimer = setTimeout(reveal, REVEAL_AFTER)
  })
})()
