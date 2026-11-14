/**
 * Browser half of the bundle: a light/dark appearance switch layered on the
 * sidebar account row (the settings seat at the foot). The registration id must
 * equal the package name so the boot graph row and this factory line up.
 *
 * The shipped account row owns its own markup, so the control mounts beside it:
 * it overlays the row's right edge while the row keeps its own click target.
 * On the 56px rail it moves under the foot, clear of the 36px account icon.
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-toggle',
  factory(require) {
    const PLUGIN_ID = 'dsh-theme-toggle';
    const LOCALE_NS = 'themeToggle';
    const STYLE_MARK = 'data-dsh-theme-toggle';

    const zh = {
      'toggle.toDark': '切换到深色外观',
      'toggle.toLight': '切换到浅色外观'
    };
    const en = {
      'toggle.toDark': 'Switch to dark appearance',
      'toggle.toLight': 'Switch to light appearance'
    };

    /* Sun: a large disc with eight short rays filling the icon centre. */
    const SUN = '<svg class="dsh-theme-toggle__sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.35 5.35l1.56 1.56M18.65 18.65l-1.56-1.56M5.35 18.65l1.56-1.56M18.65 5.35l-1.56 1.56"/></svg>';
    const MOON = '<svg class="dsh-theme-toggle__moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z"/></svg>';

    /*
     * Sizes and radii follow the sidebar's own icon button: 28px with 8px
     * corners on the expanded column, 36px with 12px corners on the rail. The
     * overlay sits on the account row's right edge; its right inset is measured
     * at runtime so trailing status indicators stay visible.
     */
    const CSS = `
.dsh-theme-toggle {
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
.dsh-theme-toggle svg { display: block; width: 16px; height: 16px; }
@media (hover: hover) {
  .dsh-theme-toggle:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-theme-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-theme-toggle[data-scheme='light'] .dsh-theme-toggle__moon,
.dsh-theme-toggle[data-scheme='dark'] .dsh-theme-toggle__sun { display: none; }
.dsh-theme-toggle[data-placement='rail'] {
  position: static;
  transform: none;
  width: 36px;
  height: 36px;
  margin: 0 0 8px;
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-primary);
}
.dsh-theme-toggle[data-placement='rail'] svg { width: 18px; height: 18px; }
`;

    return {
      name: PLUGIN_ID,
      inject: ['theme', 'locale'],
      apply(ctx) {
        const theme = ctx.theme;

        let snapshot = theme.getTheme();
        ctx.effect(() => ctx.on('theme/change', (next) => {
          snapshot = next;
          paint();
        }), 'theme-toggle: theme changes');

        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'theme-toggle: dictionaries');

        const t = ctx.locale.bind(LOCALE_NS);

        ctx.effect(() => {
          if (document.querySelector('style[' + STYLE_MARK + ']') !== null) return;
          const style = document.createElement('style');
          style.setAttribute(STYLE_MARK, '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'theme-toggle: styles');

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
            button.className = 'dsh-theme-toggle';
            button.innerHTML = SUN + MOON;
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

        ctx.effect(() => {
          mutations.observe(document.documentElement, { childList: true, subtree: true });
          schedule();
          unsubscribeLocale = ctx.locale.subscribe(paint);
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
        }, 'theme-toggle: sidebar control');
      }
    };
  }
});