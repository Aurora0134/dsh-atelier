/*
 * Opening brand sequence for the DSH shell.
 *
 * Runs from the index body before the shell mounts. It covers the stock boot
 * card, plays the mark sequence — "<DeepSeek>" surfaces, the row opens at the
 * closing bracket, "Harness" rises into the opening — and fades the layer out
 * once the application is on stage. A boot failure cancels the sequence so the
 * shell's own diagnostics stay reachable.
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

  /** Split and harness motion end, plus the hold before the hand-off (ms). */
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

  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.setAttribute('aria-hidden', 'true')

  const word = document.createElement('div')
  word.className = `${OVERLAY_CLASS}-word`

  const part = (text) => {
    const span = document.createElement('span')
    span.className = `${OVERLAY_CLASS}-text`
    span.textContent = text
    return span
  }

  const slot = document.createElement('span')
  slot.className = `${OVERLAY_CLASS}-slot`

  const harness = document.createElement('span')
  harness.className = `${OVERLAY_CLASS}-harness`
  harness.textContent = 'Harness'
  slot.append(harness)

  word.append(part('\u003cDeepSeek'), slot, part('\u003e'))
  overlay.append(word)
  document.body.append(overlay)

  // The gap is exactly one word space plus the new word, measured in the live font.
  const wordStyle = getComputedStyle(word)
  let space = (Number.parseFloat(wordStyle.fontSize) || 18) * 0.26
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context !== null) {
      context.font = `${wordStyle.fontStyle} ${wordStyle.fontWeight} ${wordStyle.fontSize} ${wordStyle.fontFamily}`
      const measured = context.measureText(' ').width
      if (Number.isFinite(measured) && measured > 0) space = measured
    }
  } catch {
    // keep the font-size estimate
  }
  const harnessWidth = Math.max(harness.getBoundingClientRect().width, harness.scrollWidth)
  word.style.setProperty('--dsh-splash-space', `${space.toFixed(2)}px`)
  word.style.setProperty('--dsh-splash-slot-width', `${Math.ceil(harnessWidth + space)}px`)

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
