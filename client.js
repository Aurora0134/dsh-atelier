/**
 * Browser half of the bundle. The Host serves this file as
 * `/plugins/dsh-session-aside/client.js` and the page registers it as a lazy
 * module factory; the registration id must equal the package name so the boot
 * graph row and this factory line up.
 *
 * Three ways into the right Sidebar for a session that is not the one on
 * screen: a resource type that renders that session's Conversation in a tab, a
 * row in the session's "..." menu, and a drop surface that appears while a
 * session row is dragged.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-aside',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const h = React.createElement;

    const PLUGIN_ID = 'dsh-session-aside';
    const ROW_NAME = 'session-aside';

    /** Tab-type identity: unique across every registration, not just per kind. */
    const TAB_TYPE_ID = 'dsh-session-aside/session';
    /** Tab kind this bundle owns; nothing else registers it. */
    const TAB_KIND = 'sessionaside';
    /** Resource protocol; also the address host, so `dsh-resource://sessionaside/...`. */
    const RESOURCE_PROTOCOL = 'sessionaside';
    const RESOURCE_PATH = 'session';
    const ADDRESS_PREFIX = `dsh-resource://${RESOURCE_PROTOCOL}/${RESOURCE_PATH}/`;
    /** Conversation seat this bundle declares inside its own tab body. */
    const CONVERSATION_SLOT = 'sessionaside.conversation';
    const LOCALE_NS = 'sessionAside';
    /** Retention source recorded on the Session reference the tab holds. */
    const RETAIN_SOURCE = 'sessionAside';

    /** A session catalog row carries its identity in `data-row-key`. */
    const ROW_KEY_PREFIX = 'session:';
    const ROW_SELECTOR = '[data-row-key^="session:"]';
    /** Retention source the Conversation filling the main column counts under. */
    const MAIN_VIEW_SOURCE = 'mainView';

    /** Whether one catalog row (or retain-info snapshot) is the session the main column draws. */
    const mainViewSelector = (holder) => ((holder?.retainedBy?.[MAIN_VIEW_SOURCE] ?? 0) > 0);

    const zh = {
      'menu.openAside': '在侧边栏打开',
      'drop.label': '在侧边栏打开',
      'tab.titleFallback': '会话'
    };
    const en = {
      'menu.openAside': 'Open in sidebar',
      'drop.label': 'Open in sidebar',
      'tab.titleFallback': 'Session'
    };

    const CSS = `
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
      style.textContent = CSS;
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
      ctx.effect(() => ctx.resources.register(sessionAsideResourceProvider(sessions)), 'session-aside: chat resources');
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
      }), 'session-aside: sidebar tab type');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_TYPE_ID,
        children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } }
      }, SessionAsideTab)), 'session-aside: sidebar tab body');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_TYPE_ID
      }, SessionAsideTabTitle)), 'session-aside: sidebar tab title');

      ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
        name: CONVERSATION_SLOT
      }, SessionAsideConversation)), 'session-aside: sidebar conversation');

      ctx.effect(() => ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'open-aside',
        order: 350,
        locale: LOCALE_NS,
        inject: () => ({ openAsAside: (sessionId) => openSessionAside(ctx, sessionId) })
      }, OpenAsideMenuItem)), 'session-aside: session menu entry');
    }

    return {
      name: ROW_NAME,
      inject: ['sessions', 'slots', 'locale', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'session-aside: dictionaries');
        const t = ctx.locale.bind(LOCALE_NS);
        ctx.inject(['resources', 'sidebarRightTabs'], (scope) => registerSessionAside(scope, t));
        ctx.effect(() => installDropSurface(ctx, t), 'session-aside: drop surface');
      }
    };
  }
});