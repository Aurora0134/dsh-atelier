/**
 * Browser half of the bundle. The Host serves this file as
 * `/plugins/dsh-session-motion/client.js` and the page registers it as a lazy
 * module factory; the registration id must equal the package name so the boot
 * graph row and this factory line up.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-motion',
  factory(require) {
    const React = require('react');

    const PLUGIN_ID = 'dsh-session-motion';
    const ROW_NAME = 'session-motion';

    /** Sizes and timings the two behaviours rely on. */
    const VIEWPORT_MAX_HEIGHT = 'min(240px, 35vh)';
    const FADE_SIZE = '20px';
    const FOLLOW_MOTION_MS = 120;
    const FOLD_MOTION_MS = 170;
    const MOTION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const FOLLOW_TOLERANCE_PX = 4;
    const HOLD_TAIL_MS = 60;
    const GESTURE_COOLDOWN_MS = 150;
    const STRUCTURAL_GROWTH_PX = 800;
    const ATTACH_SETTLE_MS = 300;
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
    const CSS = `
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

      React.useEffect(() => {
        if (running) followingRef.current = true;
      }, [running]);

      React.useLayoutEffect(() => {
        if (followingRef.current) pinToBottom();
        else syncEdges();
      }, [text, running, pinToBottom, syncEdges]);

      const onScroll = React.useCallback(() => {
        const el = bodyRef.current;
        if (el === null) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_TOLERANCE_PX;
        followingRef.current = atBottom;
        if (atBottom) el.removeAttribute('data-session-motion-read');
        else el.setAttribute('data-session-motion-read', '');
        syncEdges();
      }, [syncEdges]);

      const onWheel = React.useCallback((event) => {
        if (event.deltaY < 0) followingRef.current = false;
      }, []);
      const onTouchStart = React.useCallback(() => {
        followingRef.current = false;
      }, []);
      const onKeyDown = React.useCallback((event) => {
        if (SCROLL_KEYS.has(event.key)) followingRef.current = false;
      }, []);

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
     * settles. Users keep the last word: a row they toggled is never changed by
     * this controller again, and a row they close always closes.
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
        const row = disclosureRow(el);
        const expanded = el.hasAttribute('data-expanded');
        const settled = el.getAttribute('data-state') !== 'running';
        const keepOpen = entry.expectSettled && (!expanded || !settled);
        if (!keepOpen && expanded && el.isConnected && row !== null) clickRow(row);
        clearFoldStyles(el);
      };

      const cancelFold = (el) => {
        const entry = folding.get(el);
        if (entry === undefined) return;
        folding.delete(el);
        try {
          entry.anim.cancel();
        } catch {
          /* Already finished. */
        }
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
            { duration: FOLD_MOTION_MS, easing: MOTION_EASING }
          );
        } catch {
          clearFoldStyles(el);
          clickRow(row);
          return;
        }
        const entry = { anim, expectSettled };
        folding.set(el, entry);
        anim.onfinish = () => finishFold(el, entry);
        anim.oncancel = () => {
          if (folding.get(el) === entry) {
            folding.delete(el);
            clearFoldStyles(el);
          }
        };
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
        if (!el.hasAttribute('data-expanded')) return;
        const row = disclosureRow(el);
        if (row === null || !row.contains(target)) return;
        event.stopPropagation();
        event.preventDefault();
        foldRow(el, row, false);
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
      let gestureCooldownUntil = 0;

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
       * The live status row holds its place on the floor. Its painted position is
       * compared with the floor anchor on a frame clock, so any drift — the slide
       * itself, a follow write that lands a frame later, a row growing above it —
       * is corrected before that frame is painted.
       */
      const floorTopOf = (record, row) => {
        const port = record.scrollport;
        const gutter = Number.parseFloat(getComputedStyle(port).paddingBottom) || 0;
        return port.getBoundingClientRect().top + port.clientHeight - gutter - row.offsetHeight;
      };

      const correctRow = (record) => {
        const row = record.row;
        if (row === null) return;
        const residual = floorTopOf(record, row) - row.getBoundingClientRect().top;
        if (Math.abs(residual) < 0.05) return;
        row.style.transform = 'translateY(' + (translateYOf(row) + residual).toFixed(2) + 'px)';
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
        const drift = floorTopOf(record, row) - row.getBoundingClientRect().top;
        if (performance.now() >= record.holdUntil && Math.abs(drift) < 0.5) {
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
        if (performance.now() < gestureCooldownUntil) return;
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
        if (delta > 0 && Math.abs(floor - scrollport.scrollTop) <= FOLLOW_TOLERANCE_PX) {
          /* Unrelated scrollport growth (a taller composer) is not content movement. */
          animateGrowth(record, Math.min(delta, growth));
        }
        /* Any growth above the floor may nudge the live status row, animated or not. */
        holdRow(record);
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
          frame: 0,
          holdUntil: 0,
          observer: null
        };
        records.set(column, record);
        column.setAttribute('data-session-motion-tracking', '');
        record.observer = new ResizeObserver(() => {
          if (!disposed) measure(record);
        });
        record.observer.observe(column);
      };

      const detach = (record) => {
        records.delete(record.column);
        if (record.observer !== null) record.observer.disconnect();
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
        gestureCooldownUntil = performance.now() + GESTURE_COOLDOWN_MS;
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

    return {
      name: ROW_NAME,
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = PLUGIN_ID;
          style.textContent = CSS;
          document.head.append(style);
          return () => style.remove();
        }, ROW_NAME + ': global styles');

        ctx.slots.inject('conversation.chat.reasoning.body', () =>
          ctx.slots.register(
            { name: 'conversation.chat.reasoning.body', priority: 50 },
            ReasoningViewport
          )
        );

        ctx.effect(installReasoningDisclosure, ROW_NAME + ': reasoning disclosure');
        ctx.effect(installTranscriptMotion, ROW_NAME + ': transcript motion');
      }
    };
  }
});
