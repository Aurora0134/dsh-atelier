/**
 * Browser half of the bundle: a light/dark appearance switch at the sidebar
 * foot. The registration id must equal the package name so the boot graph row
 * and this factory line up.
 *
 * The control reads the live theme snapshot and writes only through
 * `ctx.theme.setTheme`; it renders the sun while the page is light and the moon
 * while it is dark.
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-toggle',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

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

    /*
     * Sizes, radii, hover fill, and focus ring follow the sidebar's own icon
     * button: 28px on the expanded column, 36px on the 56px rail.
     */
    const CSS = `
.dsh-theme-toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0 0 0 auto;
  align-self: center;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-theme-toggle:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-theme-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-theme-toggle[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 0;
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-primary);
}
/* An earlier action in the same row may claim the row's full width; let it
   give back the 28px this control needs instead of overflowing the column. */
[data-slot='sidebar.footer.action'] > :has(+ .dsh-theme-toggle) {
  min-width: 0;
  flex-shrink: 1;
}
/* In the 56px rail the foot is one 36px column: two cells side by side would
   leave the column, so the actions stack there. */
:has(> [data-slot='sidebar.footer.action'] > .dsh-theme-toggle[data-wide='false']) {
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
`;

    /** Outline sun shown while the page is light. */
    function SunIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
      },
        h('circle', { cx: 12, cy: 12, r: 3.6 }),
        h('path', { d: 'M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6' })
      );
    }

    /** Outline crescent shown while the page is dark. */
    function MoonIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
      }, h('path', { d: 'M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z' }));
    }

    /**
     * Sidebar-foot action: the current scheme decides the glyph, the click
     * switches to the other explicit preference.
     * @param props - owner props plus this registration's injected state/action.
     */
    function ThemeToggle(props) {
      const { wide, themeState, toggleTheme } = props;
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const snapshot = React.useSyncExternalStore(
        themeState.subscribe,
        themeState.getSnapshot
      );
      const dark = snapshot.active.colorScheme === 'dark';
      const label = t(dark ? 'toggle.toLight' : 'toggle.toDark');
      const Icon = dark ? MoonIcon : SunIcon;
      return h('button', {
        type: 'button',
        className: 'dsh-theme-toggle',
        'data-wide': wide ? 'true' : 'false',
        'aria-label': label,
        title: label,
        onClick: toggleTheme
      }, h(Icon, { size: wide ? 16 : 18 }));
    }

    return {
      name: PLUGIN_ID,
      inject: ['slots', 'theme', 'locale'],
      apply(ctx) {
        const theme = ctx.theme;

        let snapshot = theme.getTheme();
        const listeners = new Set();
        ctx.effect(() => ctx.on('theme/change', (next) => {
          snapshot = next;
          for (const listener of [...listeners]) listener();
        }), 'theme-toggle: theme changes');

        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'theme-toggle: dictionaries');

        ctx.effect(() => {
          if (document.querySelector(`style[${STYLE_MARK}]`) !== null) return;
          const style = document.createElement('style');
          style.setAttribute(STYLE_MARK, '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'theme-toggle: styles');

        const themeState = {
          getSnapshot: () => snapshot,
          subscribe: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          }
        };

        const toggleTheme = () => {
          const current = theme.getTheme();
          theme.setTheme(current.active.colorScheme === 'dark' ? 'light' : 'dark');
        };

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'theme-toggle',
          order: 20,
          locale: LOCALE_NS,
          inject: () => ({ themeState, toggleTheme })
        }, ThemeToggle));
      }
    };
  }
});
