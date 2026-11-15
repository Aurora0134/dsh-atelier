/**
 * Browser half of the dsh-atelier bundle. The Host serves this file as
 * `/plugins/dsh-atelier/client.js` and the page registers it as one lazy module
 * factory; the registration id equals the package name so the boot graph row and
 * this factory line up.
 *
 * One row carries the bundle's three client features, each written for its own
 * package first (the provenance copies live under `import/`):
 *
 *   - motion — the session screen: streaming output slides instead of jumping,
 *     and reasoning renders in a bounded, scrollable viewport
 *     (from `import/session-motion`).
 *   - aside  — a second session in the right sidebar: a tab type, a session-menu
 *     entry and a row-drag drop surface (from `import/session-aside`).
 *   - theme  — the light/dark appearance switch on the sidebar account row
 *     (from `import/theme-toggle`).
 *
 * The bundle's fourth feature, the brand splash, is not in this file: it is
 * injected by the Host half (`index.js` and `browser/`) before the workspace
 * mounts, so no client module owns it.
 *
 * The three sections share one factory scope and no mutable state. Constants,
 * dictionaries, effect labels and DOM attribute prefixes carry their own section
 * name, so nothing is redeclared or overwritten, and `apply` starts each section
 * inside its own try/catch: a section that throws is logged and the other two
 * keep running.
 */

window.__ModuleLoader__.load({
  id: 'dsh-atelier',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const h = React.createElement;

    const PLUGIN_ID = 'dsh-atelier';
    /** Row name: the patch row's id and the prefix of this file's effect labels. */
    const ROW_NAME = 'atelier';

    /** Client feature switches, all on by default. */
    const FEATURE_DEFAULTS = Object.freeze({ motion: true, aside: true, theme: true });

    /**
     * Resolve the feature switches from whatever configuration the Client root
     * exposes.
     *
     * The installed client-side documentation declares no configuration channel
     * on the page context: a row's config is read and written by the Host half
     * (`ctx.fiber.entry` beside `ctx.get('configEditor')`), and neither reaches
     * the browser. So the probe stays tolerant — it reads a config object when the
     * context happens to expose one (`ctx.config`, or a `'config'` service) and
     * otherwise keeps every feature on. A missing or unreadable config degrades to
     * "all on" instead of switching a feature off by accident.
     *
     * @param ctx - the Client root context handed to `apply`.
     * @returns one boolean per client feature.
     */
    function readFeatureSwitches(ctx) {
      let config;
      try {
        if (ctx !== null && typeof ctx === 'object') {
          if (ctx.config !== null && typeof ctx.config === 'object') config = ctx.config;
          else if (typeof ctx.get === 'function') {
            const found = ctx.get('config');
            if (found !== null && typeof found === 'object') config = found;
          }
        }
      } catch (_unreadableConfig) {
        config = undefined;
      }
      const wanted = config === undefined || config.features === null || typeof config.features !== 'object'
        ? undefined
        : config.features;
      const pick = (name) =>
        (wanted !== undefined && typeof wanted[name] === 'boolean' ? wanted[name] : FEATURE_DEFAULTS[name]);
      return { motion: pick('motion'), aside: pick('aside'), theme: pick('theme') };
    }

    /* ---------------------------------------------------------------------- *
     * Section 1: motion — streaming follow and the bounded reasoning viewport (import/session-motion).
     * ---------------------------------------------------------------------- */

    /** Sizes and timings the two behaviours rely on. */
    const VIEWPORT_MAX_HEIGHT = 'min(240px, 35vh)';
    const FADE_SIZE = '20px';
    const FOLLOW_MOTION_MS = 160;
    const DISCLOSURE_MOTION_MS = 240;
    const MOTION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const FOLLOW_TOLERANCE_PX = 4;
    const HOLD_TAIL_MS = 60;
    const HOLD_GRACE_MS = 200;
    const GESTURE_COOLDOWN_MS = 150;
    const UNFOLD_WAIT_MS = 600;
    const STRUCTURAL_GROWTH_PX = 800;
    const ATTACH_SETTLE_MS = 300;
    const READ_INTENT_MS = 600;
    const SCROLL_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' '
    ]);

    /** Reasoning viewport: a bounded scroll surface around the official body. */
    const MOTION_CSS = `
[data-session-motion-viewport] {
  max-height: ${VIEWPORT_MAX_HEIGHT};
  overflow-y: auto;
  overflow-x: clip;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  margin-left: -12px;
  padding-left: 11px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
[data-session-motion-viewport][data-session-motion-fade-top] {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 ${FADE_SIZE} 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 ${FADE_SIZE} 100%);
}
[data-session-motion-viewport][data-session-motion-fade-bottom] {
  -webkit-mask-image: linear-gradient(to bottom, #000 0 calc(100% - ${FADE_SIZE}), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0 calc(100% - ${FADE_SIZE}), transparent 100%);
}
[data-session-motion-viewport][data-session-motion-fade-top][data-session-motion-fade-bottom] {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 ${FADE_SIZE} calc(100% - ${FADE_SIZE}), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 ${FADE_SIZE} calc(100% - ${FADE_SIZE}), transparent 100%);
}
[data-session-motion-animating] {
  will-change: transform;
}
[data-session-motion-folding] {
  will-change: height;
}
@media (prefers-reduced-motion: reduce) {
  [data-session-motion-viewport] { scroll-behavior: auto; }
  [data-session-motion-animating] { will-change: auto; }
  [data-session-motion-folding] { will-change: auto; }
}
`;

    const AT_REST = { top: false, bottom: false };

    function prefersReducedMotion() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * Gesture-owned layout motion (a disclosure open, a reader's scroll) owns the
     * frame; the streaming slide stays out of it until the deadline.
     */
    let motionHoldUntil = 0;
    const holdMotion = (ms) => {
      motionHoldUntil = performance.now() + ms;
    };
    const motionHeld = () => performance.now() < motionHoldUntil;

    /**
     * While a reader-initiated open animates, the transcript stays on its follow
     * floor. The official reading policy restores the position it saved before the
     * growth burst, which lands mid-animation as a backward jump.
     */
    let floorPinnedUntil = 0;
    const pinFloorFor = (ms) => {
      floorPinnedUntil = performance.now() + ms;
    };
    const releaseFloorPin = () => {
      floorPinnedUntil = 0;
    };
    const floorPinned = () => performance.now() < floorPinnedUntil;

    function ReasoningViewport(props) {
      const text = typeof props.text === 'string' ? props.text : '';
      const running = props.running === true;
      const renderFactorySlot = props.renderFactorySlot;
      const bodyRef = React.useRef(null);
      const followingRef = React.useRef(running);
      const [edges, setEdges] = React.useState(AT_REST);

      const syncEdges = React.useCallback(() => {
        const el = bodyRef.current;
        if (el === null) return;
        const top = el.scrollTop > 1;
        const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
        setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
      }, []);

      const pinToBottom = React.useCallback(() => {
        const el = bodyRef.current;
        if (el === null) return;
        el.scrollTop = el.scrollHeight;
        syncEdges();
      }, [syncEdges]);

      /**
       * Only an input can move the body on the reader's behalf. A reflow (window
       * or sidebar column resize) moves it too, and must not read as the reader
       * leaving the tail.
       */
      const readerIntentRef = React.useRef(0);
      const noteReader = React.useCallback(() => {
        readerIntentRef.current = performance.now();
      }, []);
      const readerDriven = React.useCallback(
        () => performance.now() - readerIntentRef.current < READ_INTENT_MS,
        []
      );

      React.useEffect(() => {
        if (running) followingRef.current = true;
      }, [running]);

      React.useLayoutEffect(() => {
        if (followingRef.current) pinToBottom();
        else syncEdges();
      }, [text, running, pinToBottom, syncEdges]);

      React.useEffect(() => {
        const el = bodyRef.current;
        if (el === null || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(() => {
          if (followingRef.current) pinToBottom();
          else syncEdges();
        });
        observer.observe(el);
        if (el.firstElementChild !== null) observer.observe(el.firstElementChild);
        return () => observer.disconnect();
      }, [pinToBottom, syncEdges]);

      const onScroll = React.useCallback(() => {
        const el = bodyRef.current;
        if (el === null) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_TOLERANCE_PX;
        if (atBottom) {
          followingRef.current = true;
          el.removeAttribute('data-session-motion-read');
          syncEdges();
          return;
        }
        if (!readerDriven()) {
          // A reflow moved the body away from the tail: the reader is still
          // following it, so put it back instead of reading this as a scroll.
          if (followingRef.current) pinToBottom();
          else syncEdges();
          return;
        }
        followingRef.current = false;
        el.setAttribute('data-session-motion-read', '');
        syncEdges();
      }, [pinToBottom, readerDriven, syncEdges]);

      const onWheel = React.useCallback((event) => {
        noteReader();
        if (event.deltaY < 0) followingRef.current = false;
      }, [noteReader]);
      const onTouchStart = React.useCallback(() => {
        noteReader();
        followingRef.current = false;
      }, [noteReader]);
      const onKeyDown = React.useCallback((event) => {
        if (!SCROLL_KEYS.has(event.key)) return;
        noteReader();
        followingRef.current = false;
      }, [noteReader]);

      if (typeof renderFactorySlot !== 'function') return null;

      return React.createElement(
        'div',
        {
          'data-session-motion-viewport': '',
          'data-session-motion-fade-top': edges.top ? '' : undefined,
          'data-session-motion-fade-bottom': edges.bottom ? '' : undefined,
          ref: bodyRef,
          onScroll,
          onWheel,
          onTouchStart,
          onPointerDown: noteReader,
          onKeyDown
        },
        React.createElement(
          'div',
          { 'data-session-motion-viewport-content': '' },
          renderFactorySlot('conversation.chat.reasoning.content', { text, running })
        )
      );
    }

    /**
     * Streaming reasoning rows open themselves and fold back when the block
     * settles. A reader's own toggle animates in both directions. Users keep the
     * last word: a row they toggled is never changed by this controller again,
     * and a row they close always closes.
     */
    function installReasoningDisclosure() {
      const touched = new WeakSet();
      const openedByPlugin = new WeakSet();
      /** Rows whose collapse animation this plugin owns until its toggle lands. */
      const folding = new Map();
      let autoClicking = false;
      let scheduled = false;
      let frame = 0;

      const isVisible = (el) => el.isConnected && el.getClientRects().length > 0 && el.closest('[hidden]') === null;

      const clickRow = (row) => {
        autoClicking = true;
        try {
          row.click();
        } catch {
          /* A detached row needs no action. */
        } finally {
          autoClicking = false;
        }
      };

      const disclosureRow = (el) => el.querySelector('[data-disclosure-header] > [data-disclosure-row]');

      /** The collapsed row keeps only its header, so that height is the fold target. */
      const headerHeight = (el) => {
        const header = el.querySelector('[data-disclosure-header]');
        return header === null ? 0 : header.getBoundingClientRect().height;
      };

      const clearFoldStyles = (el) => {
        el.style.height = '';
        el.style.overflow = '';
        el.removeAttribute('data-session-motion-folding');
      };

      const finishFold = (el, entry) => {
        if (folding.get(el) !== entry) return;
        folding.delete(el);
        if (entry.stopWait !== null) entry.stopWait();
        const row = disclosureRow(el);
        const expanded = el.hasAttribute('data-expanded');
        const settled = el.getAttribute('data-state') !== 'running';
        const keepOpen = entry.expectSettled && (!expanded || !settled);
        if (!keepOpen && expanded && el.isConnected && row !== null) clickRow(row);
        clearFoldStyles(el);
      };

      /** Drop whatever the entry still owns: a running animation or a pending commit wait. */
      const releaseEntry = (entry) => {
        if (entry.stopWait !== null) {
          entry.stopWait();
          entry.stopWait = null;
        }
        if (entry.anim !== null) {
          try {
            entry.anim.cancel();
          } catch {
            /* Already finished. */
          }
          entry.anim = null;
        }
      };

      const cancelFold = (el) => {
        const entry = folding.get(el);
        if (entry === undefined) return;
        folding.delete(el);
        releaseEntry(entry);
        clearFoldStyles(el);
      };

      /**
       * Shrink the row to its header first, then commit the native toggle. The
       * official disclosure unmounts its body on collapse, so animating after the
       * toggle would collapse an empty box instead of the visible content.
       */
      const foldRow = (el, row, expectSettled) => {
        if (el.closest('[data-chat-motion="collapse"], [data-chat-motion="reveal"]') !== null) {
          clickRow(row);
          return;
        }
        const start = el.getBoundingClientRect().height;
        const target = headerHeight(el);
        if (prefersReducedMotion() || !(start - target > 1.5)) {
          clickRow(row);
          return;
        }
        cancelFold(el);
        el.setAttribute('data-session-motion-folding', '');
        el.style.height = start + 'px';
        el.style.overflow = 'hidden';
        let anim;
        try {
          anim = el.animate(
            [{ height: start + 'px' }, { height: target + 'px' }],
            { duration: DISCLOSURE_MOTION_MS, easing: MOTION_EASING }
          );
        } catch {
          clearFoldStyles(el);
          clickRow(row);
          return;
        }
        const entry = { anim, expectSettled, stopWait: null };
        folding.set(el, entry);
        anim.onfinish = () => finishFold(el, entry);
        anim.oncancel = () => {
          if (folding.get(el) === entry) {
            folding.delete(el);
            clearFoldStyles(el);
          }
        };
      };

      const finishUnfold = (el, entry) => {
        if (folding.get(el) !== entry) return;
        folding.delete(el);
        if (entry.stopWait !== null) entry.stopWait();
        clearFoldStyles(el);
      };

      /**
       * The official toggle commits on its own tick, so the mounted height is not
       * readable at click time. Holding the box at its header height keeps the body
       * clipped until that write lands, then the same height eases open.
       */
      const unfoldRow = (el, row) => {
        /* A running block keeps growing underneath the animation; commit natively. */
        if (prefersReducedMotion() || el.getAttribute('data-state') === 'running') {
          clickRow(row);
          return;
        }
        cancelFold(el);
        const start = el.getBoundingClientRect().height;
        el.setAttribute('data-session-motion-folding', '');
        el.style.height = start + 'px';
        el.style.overflow = 'hidden';
        const entry = { anim: null, expectSettled: false, stopWait: null };
        folding.set(el, entry);
        const grow = () => {
          if (folding.get(el) !== entry || !el.hasAttribute('data-expanded')) return;
          if (entry.stopWait !== null) entry.stopWait();
          /* Read the committed height off the box itself, then pin it back before paint. */
          el.style.height = '';
          const end = el.getBoundingClientRect().height;
          el.style.height = start + 'px';
          if (!(end - start > 1.5)) {
            finishUnfold(el, entry);
            return;
          }
          holdMotion(DISCLOSURE_MOTION_MS + FOLLOW_MOTION_MS);
          const port = el.closest('[data-conversation-scroll]');
          if (port !== null && Math.abs(port.scrollTop - (port.scrollHeight - port.clientHeight)) <= FOLLOW_TOLERANCE_PX) {
            pinFloorFor(DISCLOSURE_MOTION_MS + FOLLOW_MOTION_MS + HOLD_TAIL_MS);
          }
          let anim;
          try {
            anim = el.animate(
              [{ height: start + 'px' }, { height: end + 'px' }],
              { duration: DISCLOSURE_MOTION_MS, easing: MOTION_EASING }
            );
          } catch {
            finishUnfold(el, entry);
            return;
          }
          entry.anim = anim;
          anim.onfinish = () => finishUnfold(el, entry);
          anim.oncancel = () => {
            if (folding.get(el) === entry) {
              folding.delete(el);
              clearFoldStyles(el);
            }
          };
        };
        const observer = new MutationObserver(grow);
        observer.observe(el, { attributes: true, attributeFilter: ['data-expanded'] });
        const timer = setTimeout(() => {
          if (entry.anim === null) cancelFold(el);
        }, UNFOLD_WAIT_MS);
        entry.stopWait = () => {
          observer.disconnect();
          clearTimeout(timer);
          entry.stopWait = null;
        };
        clickRow(row);
        grow();
      };

      const scan = () => {
        scheduled = false;
        for (const el of document.querySelectorAll('[data-variant="think"]')) {
          if (touched.has(el) || folding.has(el) || !isVisible(el)) continue;
          const running = el.getAttribute('data-state') === 'running';
          const expanded = el.hasAttribute('data-expanded');
          if (running === expanded) continue;
          const row = disclosureRow(el);
          if (row === null) continue;
          if (running) {
            openedByPlugin.add(el);
            clickRow(row);
            continue;
          }
          if (!openedByPlugin.has(el)) continue;
          if (el.querySelector('[data-session-motion-read]') !== null) continue;
          foldRow(el, row, true);
        }
      };

      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        frame = requestAnimationFrame(scan);
      };

      const onUserToggle = (event) => {
        if (autoClicking) return;
        const target = event.target;
        const el = target && typeof target.closest === 'function' ? target.closest('[data-variant="think"]') : null;
        if (el === null) return;
        touched.add(el);
        if (folding.has(el)) {
          cancelFold(el);
          return;
        }
        const row = disclosureRow(el);
        if (row === null || !row.contains(target)) return;
        event.stopPropagation();
        event.preventDefault();
        if (el.hasAttribute('data-expanded')) foldRow(el, row, false);
        else unfoldRow(el, row);
      };
      const onUserKey = (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') onUserToggle(event);
      };

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes' || record.addedNodes.length > 0) {
            schedule();
            return;
          }
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-state', 'data-expanded', 'aria-expanded', 'hidden']
      });
      document.addEventListener('click', onUserToggle, true);
      document.addEventListener('keydown', onUserKey, true);
      schedule();

      return () => {
        observer.disconnect();
        document.removeEventListener('click', onUserToggle, true);
        document.removeEventListener('keydown', onUserKey, true);
        if (frame !== 0) cancelAnimationFrame(frame);
        for (const el of Array.from(folding.keys())) cancelFold(el);
      };
    }

    /**
     * The transcript pins itself to the floor immediately on every growth batch.
     * Compensating that batch's height delta on the transcript column turns each
     * step into a short eased slide without touching the official scroll write.
     */
    function installTranscriptMotion() {
      const records = new Map();
      let disposed = false;
      let scanScheduled = false;
      let scanFrame = 0;

      /* Attached before the reader reaches the floor so the first stream is covered too. */
      const isTranscriptColumn = (column) =>
        column.isConnected &&
        column.closest('[data-step-process-body]') === null &&
        column.nextElementSibling !== null &&
        column.nextElementSibling.hasAttribute('data-chat-turn-spacer');

      const scrollportOf = (column) => {
        const scroll = column.parentElement;
        if (scroll === null) return null;
        return scroll.closest('[data-conversation-scroll]') ?? scroll;
      };

      const translateYOf = (element) => {
        const transform = getComputedStyle(element).transform;
        if (transform === 'none') return 0;
        const match = transform.match(/^matrix\(([^)]+)\)$/);
        if (match === null) return 0;
        const value = Number.parseFloat(match[1].split(',')[5]);
        return Number.isFinite(value) ? value : 0;
      };

      /**
       * The slide rides the flow box, not the column: a shifted box inside the
       * scrollport enlarges its scroll height, and the next follow write would
       * overshoot by that much. Clipping the column keeps the geometry intact.
       */
      const surfaceOf = (column) => column.querySelector(':scope > [data-slot="conversation.chat.flow"]');

      const clipColumn = (column, scrollport) => {
        const gutter = Number.parseFloat(getComputedStyle(scrollport).paddingBottom) || 0;
        column.style.overflowY = 'clip';
        column.style.overflowX = 'visible';
        if (gutter > 0) {
          /* Reach the clip edge to the scrollport floor so emerging rows are not cut early. */
          column.style.paddingBottom = gutter + 'px';
          column.style.marginBottom = -gutter + 'px';
        }
      };

      const unclipColumn = (column) => {
        column.style.overflowY = '';
        column.style.overflowX = '';
        column.style.paddingBottom = '';
        column.style.marginBottom = '';
      };

      /**
       * The live status row keeps its resting place while content above it moves.
       * Its anchor is its own resting bottom edge, never the scrollport floor: the
       * composer region lives inside the same scroll body, so the transcript ends
       * well above the floor and a floor anchor would drag the row into that gap —
       * out of the clipped column, where it is not painted. The bottom edge is the
       * stable end of the row, so a taller row grows upward instead of drifting.
       */
      const restBottomOf = (record) => {
        const row = record.row;
        if (row === null) return null;
        const bottom = row.getBoundingClientRect().bottom;
        return bottom - translateYOf(record.surface) - translateYOf(row);
      };

      const correctRow = (record) => {
        const row = record.row;
        if (row === null || record.anchor === null) return;
        const residual = record.anchor - row.getBoundingClientRect().bottom;
        if (Math.abs(residual) < 0.05) return;
        row.style.transform = 'translateY(' + (translateYOf(row) + residual).toFixed(2) + 'px)';
      };

      const holdDriftOf = (record) => {
        const row = record.row;
        if (row === null || record.anchor === null) return 0;
        return record.anchor - row.getBoundingClientRect().bottom;
      };

      const atFollowFloor = (record) => {
        const port = record.scrollport;
        return Math.abs(port.scrollTop - (port.scrollHeight - port.clientHeight)) <= FOLLOW_TOLERANCE_PX;
      };

      const stopHold = (record) => {
        if (record.frame !== 0) cancelAnimationFrame(record.frame);
        record.frame = 0;
        record.holdUntil = 0;
        const row = record.row;
        record.row = null;
        if (row === null) return;
        row.style.transform = '';
        row.removeAttribute('data-session-motion-animating');
      };

      const holdTick = (record) => {
        record.frame = 0;
        const row = record.row;
        if (row === null) return;
        if (!row.isConnected) {
          stopHold(record);
          return;
        }
        correctRow(record);
        const now = performance.now();
        if (now >= record.holdUntil && (Math.abs(holdDriftOf(record)) < 0.5 || now >= record.holdUntil + HOLD_GRACE_MS)) {
          stopHold(record);
          return;
        }
        record.frame = requestAnimationFrame(() => holdTick(record));
      };

      const holdRow = (record) => {
        const row = record.surface.querySelector('[data-chat-running]');
        if (row === null) {
          stopHold(record);
          return;
        }
        if (record.row !== row) {
          stopHold(record);
          record.row = row;
          row.setAttribute('data-session-motion-animating', '');
        }
        /* A fresh hold re-reads the resting edge; a follow write still in flight leaves the previous one in charge. */
        if (record.frame === 0 && (record.anchor === null || atFollowFloor(record))) {
          record.anchor = restBottomOf(record);
        }
        record.holdUntil = performance.now() + FOLLOW_MOTION_MS + HOLD_TAIL_MS;
        correctRow(record);
        if (record.frame === 0) record.frame = requestAnimationFrame(() => holdTick(record));
      };

      const clearMotion = (record) => {
        if (record.anim !== null) {
          try {
            record.anim.cancel();
          } catch {
            /* Already finished. */
          }
          record.anim = null;
        }
        record.surface.style.transform = '';
        record.surface.removeAttribute('data-session-motion-animating');
        stopHold(record);
      };

      const animateGrowth = (record, delta) => {
        const surface = record.surface;
        if (prefersReducedMotion()) return;
        if (motionHeld()) return;
        if (delta > STRUCTURAL_GROWTH_PX) return;
        const start = translateYOf(surface) + delta;
        if (!Number.isFinite(start) || start <= 0.5) return;
        const from = 'translateY(' + start.toFixed(2) + 'px)';
        surface.style.transform = from;
        surface.setAttribute('data-session-motion-animating', '');
        let anim;
        try {
          anim = surface.animate(
            [{ transform: from }, { transform: 'translateY(0px)' }],
            { duration: FOLLOW_MOTION_MS, easing: MOTION_EASING, fill: 'forwards' }
          );
        } catch {
          clearMotion(record);
          return;
        }
        const previous = record.anim;
        record.anim = anim;
        if (previous !== null) {
          try {
            previous.cancel();
          } catch {
            /* Already finished. */
          }
        }
        anim.onfinish = () => {
          if (record.anim !== anim) return;
          record.anim = null;
          surface.style.transform = '';
          surface.removeAttribute('data-session-motion-animating');
          try {
            anim.cancel();
          } catch {
            /* Already finished. */
          }
        };
      };

      const measure = (record) => {
        const column = record.column;
        const scrollport = scrollportOf(column);
        if (scrollport === null || !column.isConnected) return;
        const floor = scrollport.scrollHeight - scrollport.clientHeight;
        const delta = floor - record.lastFloor;
        const height = column.offsetHeight;
        const growth = height - record.lastHeight;
        const clientHeight = scrollport.clientHeight;
        record.lastFloor = floor;
        record.lastHeight = height;
        if (clientHeight !== record.lastClientHeight) {
          record.lastClientHeight = clientHeight;
          return;
        }
        if (performance.now() - record.attachedAt < ATTACH_SETTLE_MS) return;
        if (column.closest('[data-chat-following-tail]') === null) return;
        /* A native fold batch moves rows and the scrollport on its own clock. */
        if (scrollport.style.overflowAnchor === 'none') return;
        if (growth <= 0) return;
        /* While the transcript is shorter than the viewport nothing is scrolled, so the row travels down with the layout. */
        if (delta <= 0) return;
        if (Math.abs(floor - scrollport.scrollTop) <= FOLLOW_TOLERANCE_PX) {
          /* Unrelated scrollport growth (a taller composer) is not content movement. */
          animateGrowth(record, Math.min(delta, growth));
        }
        /* A follow scroll carries every row up by the delta; hold the status row against it. */
        holdRow(record);
      };

      /** Hold the tail on its floor while a reader-initiated open owns the layout. */
      const pinFloor = (record) => {
        if (!floorPinned()) return;
        const port = record.scrollport;
        const floor = port.scrollHeight - port.clientHeight;
        if (Math.abs(floor - port.scrollTop) > 1) port.scrollTop = floor;
      };

      const attach = (column) => {
        if (records.has(column)) return;
        const scrollport = scrollportOf(column);
        if (scrollport === null) return;
        const surface = surfaceOf(column) ?? column;
        if (surface !== column) clipColumn(column, scrollport);
        const record = {
          column,
          surface,
          scrollport,
          clipped: surface !== column,
          lastFloor: scrollport.scrollHeight - scrollport.clientHeight,
          lastHeight: column.offsetHeight,
          lastClientHeight: scrollport.clientHeight,
          attachedAt: performance.now(),
          anim: null,
          row: null,
          anchor: null,
          frame: 0,
          holdUntil: 0,
          observer: null,
          onScroll: null
        };
        records.set(column, record);
        column.setAttribute('data-session-motion-tracking', '');
        record.observer = new ResizeObserver(() => {
          if (!disposed) measure(record);
        });
        record.observer.observe(column);
        record.onScroll = () => pinFloor(record);
        scrollport.addEventListener('scroll', record.onScroll, { passive: true });
      };

      const detach = (record) => {
        records.delete(record.column);
        if (record.observer !== null) record.observer.disconnect();
        if (record.onScroll !== null) record.scrollport.removeEventListener('scroll', record.onScroll);
        record.column.removeAttribute('data-session-motion-tracking');
        clearMotion(record);
        if (record.clipped) unclipColumn(record.column);
      };

      const scan = () => {
        scanScheduled = false;
        if (disposed) return;
        for (const column of document.querySelectorAll('[data-chat-flow]')) {
          if (isTranscriptColumn(column)) attach(column);
        }
        for (const record of Array.from(records.values())) {
          if (!record.column.isConnected) detach(record);
        }
      };

      const scheduleScan = () => {
        if (scanScheduled) return;
        scanScheduled = true;
        scanFrame = requestAnimationFrame(scan);
      };

      const interrupt = () => {
        releaseFloorPin();
        holdMotion(GESTURE_COOLDOWN_MS);
        for (const record of records.values()) clearMotion(record);
      };
      const onWheel = () => interrupt();
      const onTouchStart = () => interrupt();
      const onPointerDown = () => interrupt();
      const onKeyDown = (event) => {
        if (SCROLL_KEYS.has(event.key)) interrupt();
      };

      document.addEventListener('wheel', onWheel, { capture: true, passive: true });
      document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
      document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
      document.addEventListener('keydown', onKeyDown, true);

      const observer = new MutationObserver((records_) => {
        for (const record of records_) {
          if (record.type === 'childList' && record.addedNodes.length > 0) {
            scheduleScan();
            return;
          }
        }
      });
      observer.observe(document.body, { subtree: true, childList: true });
      scan();

      return () => {
        disposed = true;
        observer.disconnect();
        document.removeEventListener('wheel', onWheel, { capture: true });
        document.removeEventListener('touchstart', onTouchStart, { capture: true });
        document.removeEventListener('pointerdown', onPointerDown, { capture: true });
        document.removeEventListener('keydown', onKeyDown, true);
        if (scanFrame !== 0) cancelAnimationFrame(scanFrame);
        for (const record of Array.from(records.values())) detach(record);
        records.clear();
      };
    }

    /**
     * Motion: the reasoning viewport slot, the streaming follow and the
     * disclosure animation. Gated on `slots` alone, so it activates wherever
     * the Conversation slot host exists, even if nothing else here does.
     *
     * @param ctx - Client root; the body runs on the context `ctx.inject` hands it.
     */
    function applyMotion(ctx) {
      ctx.inject(['slots'], (scoped) => {
        scoped.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = PLUGIN_ID;
          style.textContent = MOTION_CSS;
          document.head.append(style);
          return () => style.remove();
        }, 'atelier motion: global styles');

        scoped.slots.inject('conversation.chat.reasoning.body', () =>
          scoped.slots.register(
            { name: 'conversation.chat.reasoning.body', priority: 50 },
            ReasoningViewport
          )
        );

        scoped.effect(installReasoningDisclosure, 'atelier motion: reasoning disclosure');
        scoped.effect(installTranscriptMotion, 'atelier motion: transcript motion');
      });
    }

    /* ---------------------------------------------------------------------- *
     * Section 2: aside — a second session in the right sidebar (import/session-aside).
     * ---------------------------------------------------------------------- */

    /** Tab-type identity: unique across every registration, not just per kind. */
    const TAB_TYPE_ID = 'dsh-atelier/session';
    /** Tab kind this bundle owns; nothing else registers it. */
    const TAB_KIND = 'sessionaside';
    /** Resource protocol; also the address host, so `dsh-resource://sessionaside/...`. */
    const RESOURCE_PROTOCOL = 'sessionaside';
    const RESOURCE_PATH = 'session';
    const ADDRESS_PREFIX = `dsh-resource://${RESOURCE_PROTOCOL}/${RESOURCE_PATH}/`;
    /** Conversation seat this bundle declares inside its own tab body. */
    const CONVERSATION_SLOT = 'sessionaside.conversation';
    const ASIDE_LOCALE_NS = 'sessionAside';
    /** Retention source recorded on the Session reference the tab holds. */
    const RETAIN_SOURCE = 'sessionAside';

    /** A session catalog row carries its identity in `data-row-key`. */
    const ROW_KEY_PREFIX = 'session:';
    const ROW_SELECTOR = '[data-row-key^="session:"]';
    /** Retention source the Conversation filling the main column counts under. */
    const MAIN_VIEW_SOURCE = 'mainView';

    /** Whether one catalog row (or retain-info snapshot) is the session the main column draws. */
    const mainViewSelector = (holder) => ((holder?.retainedBy?.[MAIN_VIEW_SOURCE] ?? 0) > 0);

    const ASIDE_ZH = {
      'menu.openAside': '在侧边栏打开',
      'drop.label': '在侧边栏打开',
      'tab.titleFallback': '会话'
    };
    const ASIDE_EN = {
      'menu.openAside': 'Open in sidebar',
      'drop.label': 'Open in sidebar',
      'tab.titleFallback': 'Session'
    };

    const ASIDE_CSS = `
[data-session-aside-tab] {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
[data-session-aside-dropzone] {
  --aside-guide-accent: var(--dsw-alias-state-business-primary);
  position: fixed;
  z-index: 2147483000;
  display: none;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border: 1.5px dashed var(--aside-guide-accent);
  border-radius: 12px;
  background: color-mix(in oklab, var(--aside-guide-accent) 12%, color-mix(in oklab, var(--dsw-alias-bg-base) 72%, transparent));
  pointer-events: none;
  transition: background-color 120ms ease, border-color 120ms ease;
}
[data-session-aside-dropzone][data-armed] {
  display: flex;
  pointer-events: auto;
}
[data-session-aside-dropzone][data-over] {
  border-style: solid;
  border-width: 2px;
  background: color-mix(in oklab, var(--aside-guide-accent) 18%, color-mix(in oklab, var(--dsw-alias-bg-base) 76%, transparent));
}
/* Collapsed column: the surface reads as the panel it will become — open on
   the left, its fill and frame dissolving as they reach into the window. The
   accent keeps the surface a different colour from the page it floats over,
   which is what makes a half-transparent wash read as a destination at all. */
[data-session-aside-dropzone][data-floating] {
  border: 0;
  border-radius: 0;
  background: none;
}
[data-session-aside-dropzone][data-floating]::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1.5px dashed var(--aside-guide-accent);
  border-left-width: 0;
  border-radius: 0 12px 12px 0;
  background: color-mix(in oklab, var(--aside-guide-accent) 12%, color-mix(in oklab, var(--dsw-alias-bg-base) 72%, transparent));
  -webkit-mask-image: linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0.35) 12%, rgb(0 0 0 / 1) 38%);
  mask-image: linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0.35) 12%, rgb(0 0 0 / 1) 38%);
  pointer-events: none;
  transition: background-color 120ms ease, border-color 120ms ease;
}
[data-session-aside-dropzone][data-floating][data-over]::before {
  border-style: solid;
  border-width: 2px;
  border-left-width: 0;
  background: color-mix(in oklab, var(--aside-guide-accent) 18%, color-mix(in oklab, var(--dsw-alias-bg-base) 76%, transparent));
}
[data-session-aside-dropcard] {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 14px 18px;
  border: 1px solid color-mix(in oklab, var(--aside-guide-accent) 32%, transparent);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  transition: border-color 120ms ease, color 120ms ease;
}
[data-session-aside-dropzone][data-over] [data-session-aside-dropcard] {
  border-color: color-mix(in oklab, var(--aside-guide-accent) 60%, transparent);
}
[data-session-aside-dropzone-glyph] {
  display: flex;
  color: var(--aside-guide-accent);
}
[data-session-aside-dropzone-label] {
  font-weight: 500;
}
@media (prefers-reduced-motion: reduce) {
  [data-session-aside-dropzone],
  [data-session-aside-dropcard],
  [data-session-aside-dropzone][data-floating]::before { transition: none; }
}
`;

    /** Static artwork for the drop surface: one panel docking beside another. */
    const DROP_GLYPH =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<rect x="2.75" y="5.5" width="18.5" height="13" rx="3" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M13.75 6.25v11.5" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="15.25" y="7.75" width="4" height="8.5" rx="1.75" fill="currentColor"/>' +
      '</svg>';

    /**
     * Canonical resource address for one session's embedded Conversation.
     * @param sessionId - session to address.
     * @returns the Sidebar resource address.
     */
    function sessionAsideAddress(sessionId) {
      return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}`;
    }

    /**
     * Read one session id out of a Sidebar resource address.
     * @param value - a possible address.
     * @returns the session id, or undefined for another or malformed resource.
     */
    function parseSessionAsideAddress(value) {
      let url;
      try {
        url = new URL(value);
      } catch (_invalidUrl) {
        return undefined;
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== RESOURCE_PROTOCOL) return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== RESOURCE_PATH) return undefined;
      try {
        return decodeURIComponent(parts[1]);
      } catch (_invalidEncoding) {
        return undefined;
      }
    }

    /** Session id of the session the main column is drawing right now, when the catalog knows it. */
    function isSessionOnScreen(sessions, sessionId) {
      return mainViewSelector(sessions.list.getSnapshot().byId[sessionId]);
    }

    /** Session id a row element stands for. */
    function rowSessionId(row) {
      const key = row.getAttribute('data-row-key');
      return key === null ? undefined : key.slice(ROW_KEY_PREFIX.length) || undefined;
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve(); }, { once: true });
      });
    }

    /**
     * Resource owner for an embedded conversation: retains exactly one session
     * reference for as long as the tab record lives.
     * @param sessions - the Client sessions service.
     * @returns the resource provider.
     */
    function sessionAsideResourceProvider(sessions) {
      return {
        protocol: RESOURCE_PROTOCOL,
        async *open(resourceAddress, { signal }) {
          const sessionId = parseSessionAsideAddress(resourceAddress);
          if (sessionId === undefined) {
            throw new Error(`${PLUGIN_ID}: invalid resource address "${resourceAddress}"`);
          }
          if (signal.aborted) return;
          const reference = sessions.retain(sessionId, { source: RETAIN_SOURCE, signal });
          try {
            yield { ok: true, value: { sessionId, reference } };
            await waitForAbort(signal);
          } finally {
            reference.release();
          }
        }
      };
    }

    /**
     * Open one session beside the session on screen, in the pane the column
     * already shows: the tab takes that pane's full width instead of splitting
     * the column in two. Duplicate opens focus the existing tab.
     * @param ctx - Client root carrying the Sidebar controller.
     * @param sessionId - session to show aside.
     */
    function openSessionAside(ctx, sessionId) {
      try {
        ctx.sidebarRight.openResource(sessionAsideAddress(sessionId), { kind: TAB_KIND });
      } catch (error) {
        console.warn(`${PLUGIN_ID}: cannot open a session in the sidebar`, error);
      }
    }

    /** Fixed Chat selection used by an embedded Conversation occurrence. */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }));
    }

    /** Render the shared Conversation content for one explicitly provided session. */
    function SessionAsideConversation({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession((value) => value);
      const shellPhase = useConversation((value) => value).activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
        ? 'active'
        : session.promptAttempted
          ? 'engaging'
          : 'blank';
      const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
      const parentAvailabilityPending = session.subagent?.address.mode === 'continuable' && session.subagent.parentAvailable === undefined;
      const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true) || parentAvailabilityPending;
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: settling ? 'settling' : hero ? 'hero' : 'active',
        hero
      }, { slots: { views: FixedChatConversationView } });
    }

    /** Bind the retained session around the Conversation slot the tab declares. */
    function SessionAsideTab({ useResource, useTabInfo, SessionProvider, renderSlot }) {
      const { tab } = useTabInfo();
      const resource = useResource(tab.contentId);
      return h('div', { 'data-session-aside-tab': '' },
        resource.value === undefined
          ? null
          : h(SessionProvider, { session: resource.value.reference }, renderSlot(CONVERSATION_SLOT, {})));
    }

    /** One row in a session's "..." menu; absent for the session already on screen. */
    function OpenAsideMenuItem({ sessionId, useMenuOpenState, useSessionRetainInfo, openAsAside, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      const onScreen = typeof useSessionRetainInfo === 'function'
        ? useSessionRetainInfo(sessionId, mainViewSelector)
        : undefined;
      if (onScreen === true) return null;
      return h(primitives.MenuItemButton, {
        icon: h(primitives.IconCompareSplitOutlineRegular, {}),
        onSelect: () => {
          setMenuOpen(false);
          openAsAside(sessionId);
        }
      }, t('menu.openAside'));
    }

    /** Live chip text: the session's current title, not the one captured at open time. */
    function SessionAsideTabTitle({ useTabInfo, useSessions, t }) {
      const { tab } = useTabInfo();
      const sessionId = parseSessionAsideAddress(tab.contentId);
      const displayTitle = useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.displayTitle));
      if (typeof displayTitle === 'string' && displayTitle !== '') return displayTitle;
      return sessionId ?? t('tab.titleFallback');
    }

    /**
     * The drop surface a session row drag reveals at the right edge: it stands
     * where the panel will appear, so releasing on it reads as docking there.
     * @param ctx - Client root carrying sessions and the Sidebar controller.
     * @param t - locale translator for this bundle's namespace.
     * @returns the effect cleanup.
     */
    function installDropSurface(ctx, t) {
      const style = document.createElement('style');
      style.dataset.plugin = PLUGIN_ID;
      style.textContent = ASIDE_CSS;
      document.head.append(style);

      const zone = document.createElement('div');
      zone.setAttribute('data-session-aside-dropzone', '');
      const card = document.createElement('div');
      card.setAttribute('data-session-aside-dropcard', '');
      const glyph = document.createElement('span');
      glyph.setAttribute('data-session-aside-dropzone-glyph', '');
      glyph.innerHTML = DROP_GLYPH;
      const label = document.createElement('span');
      label.setAttribute('data-session-aside-dropzone-label', '');
      card.append(glyph, label);
      zone.append(card);

      /** Session id the surfaced zone would dock, undefined while idle. */
      let armed;

      /** Place the zone over the expanded panel, else over the space it will take. */
      const place = () => {
        const panels = Array.from(document.querySelectorAll('[data-sidebar-right-session]'));
        const visible = panels.filter((panel) => panel.getBoundingClientRect().height > 120);
        const panel = visible.find((candidate) => candidate.hasAttribute('data-sidebar-right-open'));
        const floor = visible[0]?.getBoundingClientRect();
        const top = floor === undefined ? 0 : Math.round(floor.top);
        const bottom = floor === undefined ? 0 : Math.round(window.innerHeight - floor.bottom);
        let left = 'auto';
        let right = '0px';
        let width = 'min(340px, 32vw)';
        const dock = panel?.querySelector('[data-dockkit-host="dock"]') ?? panel;
        const rect = dock?.getBoundingClientRect();
        if (rect !== undefined && rect.width >= 140 && rect.height >= 160) {
          left = `${Math.round(rect.left)}px`;
          right = 'auto';
          width = `${Math.round(rect.width)}px`;
          zone.removeAttribute('data-floating');
        } else {
          // No panel to stand on: the zone floats on the edge it will open into,
          // and draws itself as that panel's open left edge.
          zone.setAttribute('data-floating', '');
        }
        zone.style.inset = 'auto';
        zone.style.left = left;
        zone.style.right = right;
        zone.style.top = `${top}px`;
        zone.style.bottom = `${bottom}px`;
        zone.style.width = width;
      };

      const disarm = () => {
        armed = undefined;
        zone.removeAttribute('data-armed');
        zone.removeAttribute('data-over');
      };

      const onDragStart = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const row = target.closest(ROW_SELECTOR);
        if (row === null) return;
        const sessionId = rowSessionId(row);
        if (sessionId === undefined) return;
        // The session on screen is not a second view of itself.
        if (isSessionOnScreen(ctx.sessions, sessionId)) {
          disarm();
          return;
        }
        armed = sessionId;
        label.textContent = t('drop.label');
        place();
        zone.setAttribute('data-armed', '');
      };

      const onDragEnd = () => {
        disarm();
      };

      const onZoneOver = (event) => {
        if (armed === undefined) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
        zone.setAttribute('data-over', '');
      };

      const onZoneEnter = (event) => {
        if (armed === undefined) return;
        onZoneOver(event);
        place();
      };

      const onZoneLeave = (event) => {
        if (armed === undefined) return;
        const next = event.relatedTarget;
        if (next instanceof Node && zone.contains(next)) return;
        zone.removeAttribute('data-over');
      };

      const onZoneDrop = (event) => {
        if (armed === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const sessionId = armed;
        disarm();
        openSessionAside(ctx, sessionId);
      };

      zone.addEventListener('dragenter', onZoneEnter);
      zone.addEventListener('dragover', onZoneOver);
      zone.addEventListener('dragleave', onZoneLeave);
      zone.addEventListener('drop', onZoneDrop);
      document.addEventListener('dragstart', onDragStart);
      document.addEventListener('dragend', onDragEnd);
      document.addEventListener('drop', onDragEnd);
      document.body.append(zone);

      return () => {
        zone.removeEventListener('dragenter', onZoneEnter);
        zone.removeEventListener('dragover', onZoneOver);
        zone.removeEventListener('dragleave', onZoneLeave);
        zone.removeEventListener('drop', onZoneDrop);
        document.removeEventListener('dragstart', onDragStart);
        document.removeEventListener('dragend', onDragEnd);
        document.removeEventListener('drop', onDragEnd);
        zone.remove();
        style.remove();
      };
    }

    /**
     * Register the chat resource owner, its right-Sidebar presentation, the
     * session-menu entry, and the row-drag drop surface.
     * @param ctx - Client root carrying sessions, resources, Slots and the Sidebar registries.
     * @param t - translator for this bundle's locale namespace.
     */
    function registerSessionAside(ctx, t) {
      const sessions = ctx.sessions;
      ctx.effect(() => ctx.resources.register(sessionAsideResourceProvider(sessions)), 'atelier aside: chat resources');
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_TYPE_ID,
        kind: TAB_KIND,
        patterns: [`${ADDRESS_PREFIX}**`],
        priority: 'extension',
        canOpen: (address) => parseSessionAsideAddress(address) !== undefined,
        title: (address) => {
          const sessionId = parseSessionAsideAddress(address);
          if (sessionId === undefined) return t('tab.titleFallback');
          const summary = sessions.list.getSnapshot().byId[sessionId];
          const displayTitle = summary?.displayTitle;
          return typeof displayTitle === 'string' && displayTitle !== '' ? displayTitle : sessionId;
        }
      }), 'atelier aside: sidebar tab type');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_TYPE_ID,
        children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } }
      }, SessionAsideTab)), 'atelier aside: sidebar tab body');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_TYPE_ID
      }, SessionAsideTabTitle)), 'atelier aside: sidebar tab title');

      ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
        name: CONVERSATION_SLOT
      }, SessionAsideConversation)), 'atelier aside: sidebar conversation');

      ctx.effect(() => ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'open-aside',
        order: 350,
        locale: ASIDE_LOCALE_NS,
        inject: () => ({ openAsAside: (sessionId) => openSessionAside(ctx, sessionId) })
      }, OpenAsideMenuItem)), 'atelier aside: session menu entry');
    }

    /**
     * Aside: the chat resource owner, its right-Sidebar presentation, the
     * session-menu entry and the row-drag drop surface. Gated on the Sidebar and
     * session services; `resources` and `sidebarRightTabs` stay on the inner
     * `ctx.inject` inside `registerSessionAside`, exactly as before.
     *
     * @param ctx - the Client root context.
     */
    function applyAside(ctx) {
      ctx.inject(['sessions', 'slots', 'locale', 'sidebarRight'], (scoped) => {
        scoped.effect(() => scoped.locale.register(ASIDE_LOCALE_NS, { ASIDE_ZH, ASIDE_EN }), 'atelier aside: dictionaries');
        const t = scoped.locale.bind(ASIDE_LOCALE_NS);
        scoped.inject(['resources', 'sidebarRightTabs'], (scope) => registerSessionAside(scope, t));
        scoped.effect(() => installDropSurface(scoped, t), 'atelier aside: drop surface');
      });
    }

    /* ---------------------------------------------------------------------- *
     * Section 3: theme — the light/dark appearance switch at the sidebar foot (import/theme-toggle).
     * ---------------------------------------------------------------------- */

    const THEME_LOCALE_NS = 'themeToggle';
    const THEME_STYLE_MARK = 'data-atelier-theme-toggle';

    const THEME_ZH = {
      'toggle.toDark': '切换到深色外观',
      'toggle.toLight': '切换到浅色外观'
    };
    const THEME_EN = {
      'toggle.toDark': 'Switch to dark appearance',
      'toggle.toLight': 'Switch to light appearance'
    };

    /* Sun: a large disc with eight short rays filling the icon centre. */
    const THEME_SUN = '<svg class="atelier-theme-toggle__sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.35 5.35l1.56 1.56M18.65 18.65l-1.56-1.56M5.35 18.65l1.56-1.56M18.65 5.35l-1.56 1.56"/></svg>';
    const THEME_MOON = '<svg class="atelier-theme-toggle__moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z"/></svg>';

    /*
     * Sizes and radii follow the sidebar's own icon button: 28px with 8px
     * corners on the expanded column, 36px with 12px corners on the rail. The
     * overlay sits on the account row's right edge; its right inset is measured
     * at runtime so trailing status indicators stay visible.
     */
    const THEME_CSS = `
.atelier-theme-toggle {
  position: absolute;
  z-index: 1;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.atelier-theme-toggle svg { display: block; width: 16px; height: 16px; }
@media (hover: hover) {
  .atelier-theme-toggle:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
}
.atelier-theme-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.atelier-theme-toggle[data-scheme='light'] .atelier-theme-toggle__moon,
.atelier-theme-toggle[data-scheme='dark'] .atelier-theme-toggle__sun { display: none; }
.atelier-theme-toggle[data-placement='rail'] {
  position: static;
  transform: none;
  width: 36px;
  height: 36px;
  margin: 0 0 8px;
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-primary);
}
.atelier-theme-toggle[data-placement='rail'] svg { width: 18px; height: 18px; }
`;

    /**
     * Theme: mount the appearance switch on the sidebar account row (or under the
     * foot on the rail) and keep its glyph and label in step with the scheme.
     * Gated on `theme` and `locale`.
     *
     * @param ctx - the Client root context.
     */
    function applyTheme(ctx) {
      ctx.inject(['theme', 'locale'], (scoped) => {
        const theme = scoped.theme;

        let snapshot = theme.getTheme();
        scoped.effect(() => scoped.on('theme/change', (next) => {
          snapshot = next;
          paint();
        }), 'atelier theme: theme changes');

        scoped.effect(() => scoped.locale.register(THEME_LOCALE_NS, { THEME_ZH, THEME_EN }), 'atelier theme: dictionaries');

        const t = scoped.locale.bind(THEME_LOCALE_NS);

        scoped.effect(() => {
          if (document.querySelector('style[' + THEME_STYLE_MARK + ']') !== null) return;
          const style = document.createElement('style');
          style.setAttribute(THEME_STYLE_MARK, '');
          style.textContent = THEME_CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'atelier theme: styles');

        let button = null;
        let anchor = null;
        let row = null;
        let trigger = null;
        let observed = null;
        let frame = 0;
        let unsubscribeLocale = () => {};

        /** Repaint the glyph and accessible label for the current scheme. */
        function paint() {
          if (button === null) return;
          const dark = snapshot.active.colorScheme === 'dark';
          const label = t(dark ? 'toggle.toLight' : 'toggle.toDark');
          button.dataset.scheme = dark ? 'dark' : 'light';
          button.setAttribute('aria-label', label);
          button.title = label;
        }

        /** Keep clear of trailing row controls (connection and update status). */
        function place() {
          if (button === null || row === null) return;
          const rowRect = row.getBoundingClientRect();
          let edge = rowRect.right;
          for (const child of row.children) {
            if (child === button || child === anchor || child.contains(trigger)) continue;
            const rect = child.getBoundingClientRect();
            if (rect.width > 0 && rect.right > edge - 64) edge = Math.min(edge, rect.left);
          }
          button.style.right = Math.max(6, rowRect.right - edge + 6) + 'px';
        }

        /** Move the control onto the account row, or under the foot on the rail. */
        function ensure() {
          frame = 0;
          const nextAnchor = document.querySelector('[data-slot="sidebar.settings"]');
          /*
           * The seat's row button opens a popup: a settings dialog in older
           * builds, the account menu in the current one. Match the popup marker
           * instead of one value, and fall back to the row's first button so a
           * later control change cannot silence the mount again.
           */
          const nextTrigger = nextAnchor === null ? null
            : (nextAnchor.querySelector('button[aria-haspopup]') ?? nextAnchor.querySelector('button'));
          if (nextAnchor === null || nextTrigger === null) return;
          let nextRow = nextTrigger;
          while (nextRow.parentElement !== null && nextRow.parentElement !== nextAnchor) nextRow = nextRow.parentElement;
          if (nextRow === nextAnchor) return;

          const wide = nextRow.getBoundingClientRect().width > 80;
          const foot = nextAnchor.parentElement === null ? null : nextAnchor.parentElement.parentElement;
          const host = wide ? nextRow : foot;
          if (host === null) return;

          const changed = anchor !== nextAnchor || row !== nextRow || trigger !== nextTrigger;
          anchor = nextAnchor;
          row = nextRow;
          trigger = nextTrigger;

          if (button === null) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'atelier-theme-toggle';
            button.innerHTML = THEME_SUN + THEME_MOON;
            button.addEventListener('click', () => {
              const current = theme.getTheme();
              theme.setTheme(current.active.colorScheme === 'dark' ? 'light' : 'dark');
            });
          }

          button.dataset.placement = wide ? 'row' : 'rail';
          if (button.parentElement !== host) host.appendChild(button);
          const pad = wide ? '36px' : '';
          if (trigger.style.paddingRight !== pad) trigger.style.paddingRight = pad;

          if (wide) place();
          if (changed || observed !== nextRow) {
            if (observed !== null) resize.unobserve(observed);
            observed = nextRow;
            resize.observe(nextRow);
          }
          paint();
        }

        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(ensure);
        };

        const resize = new ResizeObserver(schedule);
        const mutations = new MutationObserver(schedule);

        scoped.effect(() => {
          mutations.observe(document.documentElement, { childList: true, subtree: true });
          schedule();
          unsubscribeLocale = scoped.locale.subscribe(paint);
          return () => {
            mutations.disconnect();
            resize.disconnect();
            unsubscribeLocale();
            if (frame !== 0) window.cancelAnimationFrame(frame);
            frame = 0;
            if (trigger !== null) trigger.style.paddingRight = '';
            if (button !== null) button.remove();
            button = null;
            anchor = null;
            row = null;
            trigger = null;
            observed = null;
          };
        }, 'atelier theme: sidebar control');
      });
    }

    /**
     * Start one feature section, isolating its startup failure: a section that
     * throws is logged under this bundle's name and the others still start.
     *
     * @param ctx - the Client root context.
     * @param label - section name used in the log line.
     * @param enabled - the section's switch from `readFeatureSwitches`.
     * @param start - the section's own apply function.
     */
    function startSection(ctx, label, enabled, start) {
      if (!enabled) return;
      try {
        start(ctx);
      } catch (error) {
        console.error(`${PLUGIN_ID}: the ${label} feature failed to start`, error);
      }
    }

    return {
      name: ROW_NAME,
      /**
       * No hard dependency: the bundle activates at once, and every section gates
       * itself with its own `ctx.inject` list, so a missing service costs that one
       * feature instead of the whole bundle.
       */
      inject: [],
      apply(ctx) {
        const features = readFeatureSwitches(ctx);
        startSection(ctx, 'motion', features.motion, applyMotion);
        startSection(ctx, 'aside', features.aside, applyAside);
        startSection(ctx, 'theme', features.theme, applyTheme);
      }
    };
  }
});
