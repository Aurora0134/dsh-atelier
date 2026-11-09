# 左栏会话行：菜单槽位 / DOM 锚点 / 拖拽现状

> 只读调研产出。取证对象：桌面安装包 `C:\Users\86183\AppData\Local\Programs\DeepSeek Harness\resources\app.asar` 内已解包的 client 插件包，以及包内自带的**生成式 Client Slot 目录**（`dsh-cordis-client-runner`）。
> 路径均相对工作区根 `C:\Users\86183\Desktop\agent-home\dsh-home`。三个别名：
> - `<PKG>` = `.recon/asar/dsh/node_modules/@deepseek-ai/`，例如 `<PKG>dsh-client-ui-workspace/lib/client.js:2276`；
> - `<RGT>` = `.tmp-recon/asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/`（右栏包在另一处解包），例如 `<RGT>lib/client.js:2234`；
> - `<BUNDLE>` / `<BUNDLECSS>` = asar 内 `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js` / `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BNyAYEM7.css`（单行压缩，dockkit / primitives / slots 只存在于这里）。
>
> 代码块约定：标「逐字」的是原样摘录；`jsx(...)` 形式的块是把压缩/`jsx(a, b)` 调用还原成可读实参（语义不变）；带 `// …` 注释的块是节选。所有 ```js 块都通过 `node --check`（23/23）；类型契约用 ```ts，bundle 证据用 ```text 或字节偏移标注。

`<BUNDLE>` 的复现提取（asar 头 + 递归 `entry.files`）：

```js
const buf = fs.readFileSync(asarPath)
const header = JSON.parse(buf.subarray(16, 16 + buf.readUInt32LE(12)))
const base = 16 + buf.readUInt32LE(8) // header 里逐层 entry.files 找到目标文件后：
fs.writeFileSync(dest, buf.subarray(base + entry.offset, base + entry.offset + entry.size))
```

## 0. 结论速览

1. **菜单项 props 形状**：`{ sessionId, displayTitle }`（owner 侧注入）+ `useMenuOpenState`（hookContext，值来自渲染出现点）+ registration 自己的 `inject` 面 +（声明了 `locale` 时）`t`。标准 props 另有 `useSessions / usePanelInfo / useWorkspaces / useSessionStatus / useSessionAccess / …`。依据：`<PKG>dsh-client-ui-workspace/lib/client.js:2345-2348`（渲染处）、`:5228-5235`（槽位声明）、`<PKG>dsh-cordis-client-runner/lib/client.js:6661-6713`（生成式契约，含 `SessionRowOwnerProps` 原文）。
2. **会话行 DOM 锚点**：`div[data-row-key="session:<sessionId>"][role="treeitem"]`，**没有** `data-session-id`。`data-row-key` 是框架自己的行身份标记（`AnimatedRows` 用它做位移测量），因此比 hash 化 class 名稳定得多。依据：`<PKG>dsh-client-ui-workspace/lib/client.js:2276`（写入）、`:2488-2497`（读回）、`:3164`（rowKeys 构造）。
3. **拖拽可行性**：左栏会话行**已经是 HTML5 拖拽源**（`draggable` + `dragstart` 写入 `text/plain = sessionId`），所以"拖出去"零成本；但右栏 dockkit **完全没有 HTML5 DnD**——它的 drop 判定是内部 pointer 状态机，只认已存在的 `tabId`，外部拖入无法复用其落点/视觉状态。**结论：外部拖入需要插件自建监听与视觉，落点建议以 `[data-dockkit-host="dock"]` 几何 + `[data-sidebar-right-panel]` 归属判定，投放动作走 `ctx.sidebarRight.openResource()`**。依据见第 5 节。

## 1. 证据与范围

| 材料 | 位置 | 用途 |
|---|---|---|
| 左栏浏览区（会话行、会话菜单、桌面端/平铺/搜索） | `<PKG>dsh-client-ui-workspace/lib/client.js`（5356 行，未压缩、带注释） | Q1–Q4、Q6 的主证据 |
| 左栏外壳（`sidebar` 槽位、`sidebar.workspaces` 洞） | `<PKG>dsh-client-ui-sidebar/lib/client.js` | 挂载链 |
| 右栏（面板、Tab 域、`ctx.sidebarRight`） | `.tmp-recon/asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js`（5144 行） | Q4、Q5 |
| dockkit（右栏布局/拖放/落点视觉） | **未单独发包**，只存在于 `<BUNDLE>`（样式 `<BUNDLECSS>`）；压缩后仍可按字节偏移定位 | Q4 |
| 生成式 Slot 目录（权威契约文本） | `<PKG>dsh-cordis-client-runner/lib/client.js:1266,1489,5844,6449,6497,6603,6661,6715` | Q1、Q2、Q5 |
| 现成"在侧边栏打开"先例 | `<PKG>dsh-client-ui-subagent/lib/client.js:295-318,701-715,755-845,964-977` | Q4 的落地路径 |

注意事项（会影响"能引用什么"）：

- 右栏/左栏的 CSS 是 **CSS Modules hash 类名**，随构建变化（如会话行 `wnFoaW_sessionRow`，见 `<PKG>dsh-client-ui-workspace/lib/client.js:1742,1782`）。**禁止**把它们写进插件选择器；本文只把它们当阅读辅助。
- `cordis_inspect_query`（client `Slots` / `Service`）在本机连续两次 10s 超时（GUI 在 `http://127.0.0.1:12022` 需认证，页面未连接），因此**没有**运行期拓扑截图；所有结论来自落盘源码 + 生成的 Slot 目录。运行期核对项列在第 8 节。
- `dsh-client-ui-dockkit` / `dsh-client-ui-primitives` / `dsh-client-ui-slots` **不在 asar 的 node_modules 里**，它们被打进 `dsh-web-frontend/dist/assets/index-BXV-oxvX.js`，并作为 Module Loader 的基线 external 暴露：
  ```js
  // index-BXV-oxvX.js（字节 917878 附近，单行压缩文件）
  { react, "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", zod,
    "@tanstack/react-virtual", "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots",
    "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-dockkit" }
  ```
  即：本项目 lane（`window.__ModuleLoader__.load({factory(require)})`）可以 `require('@deepseek-ai/dsh-client-ui-primitives')`，不需要额外依赖（与 `<PKG>dsh-client-ui-workspace/README.md:174` 的说明一致）。

## 2. Q1 — 槽位 `sidebar.workspaces.session.menu.item`

### 2.1 槽位声明（谁创建、注入什么）

声明者是 `sidebar.workspaces` 的占位者 `WorkspaceBrowser`（`client-ui-workspace`）：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:5221-5252
ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
  name: "sidebar.workspaces",
  children: {
    "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" },
    "sidebar.workspaces.session.menu.item": {
      kind: "list",
      scope: "root",
      inject: { hooks: {
        menuOpenState: menuOpenStateFactory,     // → 组件里的 useMenuOpenState
        shortcuts: ctx.shortcuts.catalog         // → 组件里的 useShortcuts
      } }
    },
    "sidebar.workspaces.session.row.action": { kind: "list", scope: "root" },
    "sidebar.session.row.leading": { kind: "list", scope: "root" },
    "sidebar.session.row.hover": { kind: "list", scope: "root" }
  },
  store: viewStore,
  inject: browserInjected,
  locale: NS
}, WorkspaceBrowser));
```

- `kind: "list"`：多个注册者按 `order` 升序排列；`id` 相同即占同一格（后者顶替）。契约原文：`<PKG>dsh-cordis-client-runner/lib/client.js:6661` 起的 `registerOptions`（`id` 必填、`order` 可选、`label` 可选）。
- 槽位级 `inject.hooks` 对**所有**子注册者生效（父级声明的注入面会下发到子条目），命名约定是 `hooks: { foo }` → 组件 props `useFoo`。`menuOpenState` 的实现：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:12-22
/**
 * Bind the row's render occurrence into the entries' `useMenuOpenState` hook:
 * the owner supplies its open-state pair as the occurrence's `hookContext`,
 * and the hook hands that pair back.
 */
const menuOpenStateFactory = (_standard, state) => () => state;
```

- `MenuOpenState` 的类型是 `[open: boolean, setOpen: (v: boolean) => void]`，由行组件在渲染菜单时以 `hookContext` 传入（见 2.2）。

### 2.2 渲染处：owner 注入的 props（唯一来源）

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:2329-2352（SessionNodeItem 内；把 jsx(...) 的实参结构原样转写）
jsx(Menu, {
  open: menuOpen,
  onClose: () => { setMenuOpen(false); },
  portal: true,
  closeOnPointerLeave: true,
  anchor: jsx("button", {
    type: "button",
    className: Rows_module_css_default.iconButton,
    "aria-label": t("actions.session.aria", { name: title }),
    onClick: () => { setMenuOpen((v) => !v); },
    children: jsx(IconEllipsisOutlineRegular, {})
  }),
  children: renderSlot("sidebar.workspaces.session.menu.item", {
    sessionId: node.id,          // ← 会话 id，字段名就是 sessionId
    displayTitle: row.title      // ← 行显示标题（空串表示没有持久标题）
  }, { hookContext: menuOpenState })
})
```

即 owner props 精确为（生成式契约原文，`<PKG>dsh-cordis-client-runner/lib/client.js:6686` 的 `ownerProps`）：

```ts
export interface SessionRowOwnerProps {
  /** Session the row shows. */
  sessionId: SessionId
  /** Row display title: persisted title, or empty when the Session has none. */
  displayTitle: string
}
```

**没有**"关闭菜单"的独立回调：关菜单只能通过 `useMenuOpenState()[1](false)`（每个现有菜单项都这么做）。行内 `Menu` 是 `portal: true`（菜单挂到 `document.body`，见 bundle 字 649922 附近 `MenuSurface` 的 `document.body.appendChild`），`closeOnPointerLeave: true`。

### 2.3 标准 props（每个 slot 占位者都有）

`<PKG>dsh-cordis-client-runner/lib/client.js:6688-6700`（`standardProps`）：

```
useRemoteAccess: (action) => boolean      useResource: UseResource
useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
usePanelInfo: UsePanelInfo                useSessions: UseSessions
useSessionStatus: UseSessionStatus        useSessionRetainInfo: UseSessionRetainInfo
useSessionAccess: (sessionId, action) => boolean
useWorkspaceAccess: (workspaceId, action) => boolean
```

`hooks` 面：`hookContext: "MenuOpenState"`，`slotInject:` 里声明 `menuOpenState` 与 `shortcuts`（同处 `:6700-6702`）。

### 2.4 现有注册者全表（该槽位只有 `client-ui-workspace` 一个包在注册）

| id | order | 组件 | 注册处 |
|---|---|---|---|
| `pin` | 100 | `PinSessionMenuItem` | `<PKG>dsh-client-ui-workspace/lib/client.js:5254-5260` |
| `rename` | 200 | `RenameSessionMenuItem` | `:5261-5267` |
| `fork` | 300 | `ForkSessionMenuItem` | `:5268-5274` |
| `archive` | 400 | `ArchiveSessionMenuItem` | `:5275-5281` |
| `session-id` | 450 | `SessionIdMenuItem` | `:5282-5288` |

（交叉验证：`<PKG>dsh-cordis-client-runner/lib/client.js:6703-6709` 的 `occupants` 与 `<PKG>dsh-client-ui-workspace/README.md:103` 完全一致；全 76 个 client 包里 grep `sidebar.workspaces.session.menu.item` 的注册只有两个文件命中——`dsh-client-ui-workspace` 与 `dsh-cordis-client-runner`（后者只是目录文本）。`dsh-client-ui-sidebar` 本身不注册任何会话菜单项。）

### 2.5 可照抄模板 A — 现有注册者的完整源码（最短、最干净的一个）

注册语句（这就是"照抄骨架"）：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:5253-5289
// 同一个生成器里还依次 yield 了 pin(100) / rename(200) / fork(300) / archive(400)，此处只留 order 450 这一项。
ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
  yield ctx.slots.register({
    name: "sidebar.workspaces.session.menu.item",
    id: "session-id",
    order: 450,
    locale: NS,                     // "workspace" 命名空间；组件因此拿到 t
    inject: sessionIdInjected       // 自己的行为面
  }, SessionIdMenuItem);
});
```

注入面工厂（组件拿到的额外 props 就从这里来）：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:5154-5156
const sessionIdInjected = () => ({ copySessionId: async (sessionId) => {
  notify({ kind: await writeClipboard(sessionId) ? "sessionIdCopied" : "sessionIdCopyFailed" });
} });
```

组件（props 解构出的字段名、返回值结构）：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:4724-4741
/** Copy the row's Session ID without opening its history. */
function SessionIdMenuItem({ sessionId, useMenuOpenState, copySessionId, t }) {
  const [, setMenuOpen] = useMenuOpenState();
  return jsx(MenuItemButton, {
    icon: jsx(IconCopyOutlineRegular, {}),
    onSelect: () => {
      setMenuOpen(false);          // 先关菜单
      copySessionId(sessionId);    // 再执行动作
    },
    children: t("menu.sessionId")
  });
}
```

对照另外两个写法，可见同一套模式的变体（需要"是否可见"和"分组"时）：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:4314-4327  ForkSessionMenuItem
function ForkSessionMenuItem({ sessionId, useMenuOpenState, useShortcuts, useSessionAccess, forkSession, t }) {
  const [, setMenuOpen] = useMenuOpenState();
  const shortcut = useShortcuts((rows) => rows.find((row) => row.id === "session.fork"));
  if (!useSessionAccess(sessionId, "session/fork")) return null;   // 自己决定可见性
  return jsx(MenuItemButton, { shortcut, icon: jsx(IconBranchOutlineRegular, {}),
    onSelect: () => { setMenuOpen(false); forkSession(sessionId); }, children: t("menu.fork") });
}

// <PKG>dsh-client-ui-workspace/lib/client.js:4137-4150  ArchiveSessionMenuItem
// 正文（读 archived → 选图标与文案 → onSelect 里先 setMenuOpen(false) 再调用）见该区间。
function ArchiveSessionMenuItem({ sessionId, useArchived, useMenuOpenState, useShortcuts, archiveSession, unarchiveSession, t }) {
}
```

### 2.6 `MenuItemButton` 的真实签名（bundle 验证）

它是 `role="menuitem"` 的按钮 + 可选前置分隔线，契约要求"每个菜单项渲染一个 `role="menuitem"` 按钮"（`<PKG>dsh-cordis-client-runner/lib/client.js:6665-6685` 的 `doc` 与 `registerOptions` doc，原因：list 的键盘遍历与焦点回收**读 DOM**）。

```js
// index-BXV-oxvX.js（单行压缩；字节偏移 649922 附近的 primitives 模块）
function MenuItemButton({ children, shortcut, icon, current, disabled = false, danger = false,
                          separatorBefore = false, onSelect }) {
  return jsx("div", { className: itemWrap, children: [
    separatorBefore && jsx("div", { className: separator, role: "separator" }),
    jsx("button", { type: "button", role: "menuitem", className: clsx(item, danger && danger),
      disabled, "aria-keyshortcuts": shortcut?.aria, "aria-current": current === true ? "page" : undefined,
      onClick: onSelect, children: [
        icon !== undefined && jsx("span", { className: itemIcon, children: icon }),
        jsx("span", { className: itemLabel, children }),
        shortcut !== undefined && jsx("span", { "aria-hidden": "true", className: shortcut, children: jsx(Kbd, { keys: shortcut.keys }) })
      ] })
  ] });
}
```

- `shortcut` 形如 `{ keys: string[], aria: string }`（从 `useShortcuts(...)` 的 catalog 行直接取，见 Fork/Archive/Rename 的用法）。
- 行内 `Menu` 的 props（bundle 同一模块 `b_`）：`{open, anchor, items, children, selectedId(s), onSelect, onClose, align, side, portal, closeOnPointerLeave, dense, compact, autoFocus, selection, getAnchorRect, minWidthFromAnchor, footer, className, listClassName}` —— 会话行的用法是 `children`（不是 `items`）+ `anchor` + `portal` + `closeOnPointerLeave`（2.2）。

### 2.7 可照抄模板 B — 本项目 lane 的完整 `client.js`（菜单项）

> 已验证 `node --check` 通过。`dsh-session-aside` 的 `package.json` 用的是 `dsh.client.platform = "web"` + `exports["./client"]`，与 `dsh-session-motion/client.js` 同 lane，故必须用 Module Loader 外壳，不能直接 `import`。

```js
/**
 * 菜单入口：会话 "..." 菜单 → "在侧边栏打开"。
 * 注册契约来自 <PKG>dsh-client-ui-workspace/lib/client.js:5228-5288 与
 * <PKG>dsh-cordis-client-runner/lib/client.js:6661-6713。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-aside',
  factory(require) {
    const React = require('react')
    const { MenuItemButton, IconChevronRightOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'sessionAside'
    const zh = { open: '在侧边栏打开' }
    const en = { open: 'Open in sidebar' }

    /** props = owner(sessionId, displayTitle) + useMenuOpenState + inject 面 + t */
    function OpenAsideMenuItem(props) {
      const { sessionId, useMenuOpenState, openAside, t } = props
      const [, setMenuOpen] = useMenuOpenState()
      return React.createElement(
        MenuItemButton,
        {
          icon: React.createElement(IconChevronRightOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false)
            openAside(sessionId)
          }
        },
        t('open')
      )
    }

    return {
      name: 'session-aside',
      inject: ['slots', 'locale', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-aside: dictionaries')
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'dsh-session-aside.open',
              order: 500, // 排在 shipped session-id(450) 之后；默认 0 会排到 pin 前面
              locale: NS,
              inject: () => ({
                openAside: (sessionId) => {
                  ctx.sidebarRight.openResource(`dsh-resource://sessionaside/session/${encodeURIComponent(sessionId)}`, {
                    kind: 'sessionaside.chat',
                    preferNewPane: true
                  })
                }
              })
            },
            OpenAsideMenuItem
          )
        )
      }
    }
  }
})
```

要点（缺一个就不成立）：

- 必须 `ctx.slots.inject(槽位名, () => ctx.slots.register(...))`：槽位由 owner 声明，`inject` 会等待声明、owner 卸载时撤销贡献、恢复后再注册（`<PKG>dsh-client-ui-workspace/README.md:170`）。
- `id` 用包名前缀；重复 shipped id 会**顶替**该项（`<PKG>dsh-client-ui-workspace/README.md:103`）。
- 组件放模块作用域（不要每次 apply 新建），否则每次重渲染都换组件类型（`<PKG>dsh-client-ui-workspace/README.md:111`）。
- 可见性、快捷键、图标、是否带分隔线全部自负；菜单的键盘遍历依赖你渲染真的 `role="menuitem"` 按钮。
- 上面 `openAside` 里的 kind 必须先在 5.5 的链路里注册，否则 `openResource` 会抛 `no registered tab type claims …`（`<RGT>lib/client.js:2294`）。

### 2.8 动态 client（`cordis-client-runner` 闭包）lane 的等价物

若插件由 `cordis-client-runner` 下发（不能 `require` 任何包），契约给的官方示例是：

```js
return {
  inject: ['slots'],
  apply(ctx) {
    const copyLabel = 'Copy session title' // Localize in the contributing package.
    ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'copy-session-title', order: 500 },
      ({ displayTitle, useMenuOpenState }) => {
        const [, setMenuOpen] = useMenuOpenState()
        return React.createElement(
          'button',
          {
            type: 'button', role: 'menuitem',
            onClick: () => { setMenuOpen(false); void navigator.clipboard.writeText(displayTitle) },
          },
          copyLabel,
        )
      },
    ))
  },
}
```

（原文：`<PKG>dsh-cordis-client-runner/lib/client.js:6711` 的 `example` 字段。）

## 3. Q2 — `sidebar.workspaces.session.row.action` 与 `sidebar.session.row.leading`

### 3.1 `session.row.action`

- owner props：与菜单项**完全相同**（`sessionId`, `displayTitle`）——渲染处 `<PKG>dsh-client-ui-workspace/lib/client.js:2349-2352`。
- 位置：会话行尾部 `span.Rows…rowActions` 里，**在 "..." 菜单按钮之后**；容器 `onClick` 已 `stopPropagation()`，所以按钮点击不会打开会话（`:2324-2328`）。
- 契约要求：渲染**一个图标按钮**（或什么都不渲染）；`order` 升序；没有 hookContext、没有额外 `slotInject`（`<PKG>dsh-cordis-client-runner/lib/client.js:6715-6762`，`hookContext: ""`、`slotInject: ""`）。
- shipped 注册者：`archive`（100，`ArchiveSessionRowButton`，`:5291-5297` 注册、`:4156-4174` 实现）、`pin`（200，`PinSessionRowButton`，`:5298-5304` 注册、`:4369-4389` 实现）。两者都用 `Tooltip + button.Rows…iconButton` 包一层。
- 复用建议：拖拽手柄/入口按钮放这里最省事（不占菜单、不会被菜单关闭吞掉），但要注意它只在 hover / 菜单打开时才 `display: inline-flex`（CSS：`<PKG>dsh-client-ui-workspace/lib/client.js:1742` 的 `.rowActions{display:none}` 与 `…:hover .rowActions{display:inline-flex}`）。

### 3.2 `sidebar.session.row.leading`

- owner props 只有 `{ sessionId }`（**没有** `displayTitle`）：渲染处 `<PKG>dsh-client-ui-workspace/lib/client.js:2307`。
- 生命周期约束（决定它能不能当入口）：这是行首 16px 的装饰位，**仅当该行主状态为 idle 时挂载**；只要行有状态点（pending interaction / 新消息 / 运行中）就被状态点顶替，归档行该格一律空白（`:2261` 的 `showStatus`、`:2305-2308` 的三元；doc 原文见 `<PKG>dsh-cordis-client-runner/lib/client.js:6497-6544`）。
- shipped 占位者：`client-ui-schedule` 的 `SessionScheduleMark`（`id: 'schedule-mark'`，同上 `occupants`）。
- 结论：**不适合**当"在侧边栏打开"的唯一入口（会随状态闪断），可作为额外的装饰/指示位。

### 3.3 顺带：`sidebar.session.row.hover`

props 只有 `{ sessionId }`，渲染在 hover card 里（`:2155`）；行悬停 800ms 打开（`:2362`），拖拽进行中/菜单打开时 hover card 禁用（`:2364`）。若要放"打开到侧边栏"的悬停卡按钮可以放这里，但触达成本高。

## 4. Q3 — 左栏会话行的 DOM 结构

### 4.1 挂载链（元素从哪一层来）

```
layout 根槽位 root（<PKG>dsh-client-ui-layout/lib/client.js:623-640）
 └ sidebar（single，ui-sidebar 注册：<PKG>dsh-client-ui-sidebar/lib/client.js:611-646）
    └ div.Sidebar…regionArea（:502-510）
       └ sidebar.workspaces（single；ui-workspace 注册为 WorkspaceBrowser：<PKG>dsh-client-ui-workspace/lib/client.js:5221-5252）
          └ HoverCardGroup div.treeBody（:3332-3333 / :3377-3378）
             └ AnimatedRows → div[role="tree"][aria-label="会话"]（:2526-2544）
                └ 分组模式：div.groupSection（:3196-3198，含 ProjectRowItem + div[role="group"]）
                  平铺模式：直接是行
                  每行 → SessionNodeItem（:2255-2369）
```

### 4.2 会话行根元素（分组/平铺同一个组件）

两个列表形态**都**走 `SessionNodeItem`：

- 分组（按工作区/工作区树）：`sessions.map(... jsx(SessionNodeItem, {…, drag: dragProps}, node.id))` —— `<PKG>dsh-client-ui-workspace/lib/client.js:3256-3308`（`key = node.id`，见 `:3308`）。
- 平铺（单列表）：`rows.map(... jsx(SessionNodeItem, {…}, node.id))` —— 同文件 `:3355-3356`（`FlatList` 定义与注释"every session is one draggable top-level row"）、`:3389-3437`。
- **例外**：搜索态结果行是另一个组件 `SearchResultItem`（`:2179-2225`），`role="treeitem"` 但**没有** `data-row-key`、不可拖拽、不渲染任何行槽位。搜索期间会话行不在 DOM 里。

行元素（`:2273-2303`，`HoverCard` 的 `anchor`，即真实 DOM 行）：

```js
jsx("div", {
  ref: rowRef,
  "data-row-key": `session:${node.id}`,        // :2276  ← 唯一稳定的 sessionId 锚点
  className: clsx(sessionRow, selected && selected, menuOpen && menuOpen,
                  row.archived && archived,
                  drag?.marker === "before" && dropBefore, drag?.marker === "after" && dropAfter),
  role: "treeitem",                            // :2278
  "aria-selected": selected,                   // :2279
  "aria-description": row.archived ? t("toast.archivedNotOpenable") : undefined,
  onClick: () => { onOpen(node.id); },
  onPointerEnter: marquee.enter, onPointerLeave: marquee.leave,
  draggable,                                   // :2286  ← 已存在的可拖属性
  onDragStart: !draggable ? undefined : (e) => {          // :2287-2291
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);        // ← 已写 sessionId
    drag.start();
  },
  onDragEnd: !draggable ? undefined : drag.end,
  onDragOver: drag === undefined ? undefined : (e) => {   // :2293-2298 只在内部拖拽态生效
    if (!drag.active) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; drag.hover(rowHalf(e));
  },
  onDrop: drag === undefined ? undefined : (e) => {        // :2299-2303
    if (!drag.active) return; e.preventDefault(); drag.drop(rowHalf(e));
  },
  children: [ span.slot, span.title, span.time, pinned && PinnedIndicator, span.rowActions ]
})
```

- `draggable` 的计算：`drag !== undefined && !row.blank && !row.archived`（`:2262`）。两个列表都始终传入 `drag` 对象，所以**普通会话行恒为 `draggable="true"`**；**空白草稿行（`blank`）和归档行不可拖**。
- 行的子结构：`span.slot`（16px 前导格，`:2305-2308`）→ `span.title`（`:2309-2317`，双击触发重命名）→ `span.time`（`:2318-2322`）→ 可选 `PinnedIndicator`（`:2323`）→ `span.rowActions`（`:2324-2353`，鼠标悬停才显示）。
- 工作区分组行是另一个元素：`div[data-row-key="workspace:<groupKey>"][role="treeitem"][draggable]`（`:1966-1978`），它的 `dragstart` 同样写 `text/plain`，但写的是**裸 workspaceId**（`row.key`，`:1975`；`owningGroupKey` 返回 `workspaceId` 或 `""`，见 `:863-865`）。

### 4.3 会话行上能读出 sessionId 的属性

| 属性 | 值 | 稳定性 |
|---|---|---|
| `data-row-key` | `session:<sessionId>` | **框架自用**：`AnimatedRows.readPositions()` 用 `querySelectorAll("[data-row-key]")` + `dataset.rowKey` 与 `props.rowKeys` 对齐做位移动画（`:2488-2497`、`:3382`、`:3164`），因此属性语义不会随便改 |
| `role` | `treeitem` | ARIA 契约，稳定 |
| `aria-selected` | 是否当前会话 | 稳定 |
| `draggable` | `"true"` | 只在 blank/archived 时可缺 |
| class | `wnFoaW_sessionRow` 等 hash | **不稳定**，随构建变（`:1742,1782`） |
| `data-session-id` | —— | **不存在** |

## 5. Q4 — 现有拖拽能力与右栏 drop 判定

### 5.1 左栏：已有 HTML5 拖拽（两个内部重排手势）

| 手势 | 源 | 载荷 | 落点判定 | 视觉 |
|---|---|---|---|---|
| 会话行重排 | `SessionNodeItem`，`draggable`，`:2286-2292` | `text/plain = sessionId`，`effectAllowed = "move"` | 同一行上的 `onDragOver/onDrop`（`:2293-2303`），仅在 `drag.active`（同组、同 pinned 态）时接管；`rowHalf(e)` 取上下半区决定插入 before/after（`:1933-1936`） | 行 class 加 `dropBefore/dropAfter`（`:2277`），CSS 画插入线（`:1742` 里 `.dropBefore:before`） |
| 工作区行重排 | `ProjectRowItem`，`:1966-1978` | `text/plain = workspaceId`，`effectAllowed = "move"` | 分组容器上 `onDragOver/onDrop`（`:3196-3222`） | `groupSection` 上的 `workspaceDropBefore/After`（`:3198`） |

两条都被内部状态门控：`drag.active` 只在"同一 account（同组/同 pinned）"时为真（`:3257-3259`、`:3390`），所以**外部来源的 drag 不会命中这些处理器**。

拖拽期间还给 `document` 加了"全局接受"：

```js
// <PKG>dsh-client-ui-workspace/lib/client.js:2854-2876
function useNativeDragAcceptance(active) {
  useEffect(() => {
    if (!active) return;
    const acceptDrag = (event) => { event.preventDefault(); if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"; };
    const acceptDrop = (event) => { event.preventDefault(); };
    document.addEventListener("dragover", acceptDrag);
    document.addEventListener("drop", acceptDrop);
    return () => { document.removeEventListener("dragover", acceptDrag); document.removeEventListener("drop", acceptDrop); };
  }, [active]);
}
```

调用点：`:3036-3037`（`drag !== null || workspaceDrag !== null`）与 `:3367`（平铺列表 `drag !== null`）。**含义**：只要拖的是左栏会话行，整页在 dragover 阶段都已被 `preventDefault`，浏览器允许任意落点；右侧插件只需在 `drop` 上做自己的事（左栏这个 `acceptDrop` 只 `preventDefault`，不做任何动作，见 `:2866-2868`）。

**没有**任何"拖拽时给 body 加 class/属性"的机制（grep `document.body.classList` / `body.setAttribute` 在 ui-workspace、ui-sidebar 内零命中）。视觉状态全在参与拖拽的行元素自身 class 上。

其它包里的 DnD 先例（用于区分约定）：

- 文件/目录拖入附件：`<PKG>dsh-client-ui-attachment/lib/client.js:541-570` —— 用 `dataTransfer.types.includes("Files")` 判定，`dropEffect = "copy"`，不碰 `text/plain`。
- 会话输入区的拖放：`<PKG>dsh-client-ui-conversation/lib/client.js:6755-6766` 读 `text/plain`（把拖来的文本当输入）。
- **结论：`text/plain` 已经是"拖拽 id"的既成约定**，但载荷本身不足以判别类型（会话 id 与 workspaceId 都是裸字符串），判定必须看**拖拽源元素**（见 5.4）。

### 5.2 右栏 dockkit：完全没有 HTML5 DnD

证据（`dsh-client-ui-dockkit` 被完整打进 `<BUNDLE>`，逐 token 统计）：

```
dragover 2   dragstart 3   dragend 5   dragenter 4   dragleave 3   dataTransfer 1   draggable 1   "drop" 2
```

上述命中**全部**落在 React 事件系统的内部表里（`registrationNameDependencies`、插件事件名表等，见 bundle 字节 78586/82019/82711/97548 等处的 React 源码片段），没有一处是应用代码。dockkit 的拖拽是**自研 pointer 状态机**：

```js
// index-BXV-oxvX.js 字节 909700-912700（dockkit DockLayout 内部，压缩后；此处还原为可读形式）
const tabHandlers = {
  onTabPressed(tabId, event) {
    let moved = false
    dragTracker(event.currentTarget, event.pointerId, {
      move: (e) => {
        if (!moved) { if (!pastThreshold(x0, y0, e.clientX, e.clientY)) return; moved = true }
        setDrag({ draggingTabId: tabId, dropTarget: dropTargetAt(container, e.clientX, e.clientY, canSplit, sizes, dropZones) })
      },
      up: (e) => {
        if (!moved) return
        const target = dropTargetAt(container, e.clientX, e.clientY, canSplit, sizes, dropZones)
        if (target === undefined) {
          if (contains(container.getBoundingClientRect(), e.clientX, e.clientY)) return  // 松手仍在容器内 → 取消
          intents.floatTab(tabId, floatRectAt(e.clientX, e.clientY))                       // 容器外 → 变浮动面板
          return
        }
        if (target.kind === "strip") intents.placeTab(tabId, target.paneId, target.index)
        else intents.dropTab(tabId, target.paneId, target.zone)
      }
    })
  }
}
```

落点判定函数（同处，字节 912380 附近）：

```js
function dropTargetAt(root, x, y, canSplit, sizes, dropZones) {
  for (const [paneId, paneEl] of panes(root)) {                    // querySelectorAll("[data-dockkit-pane]")
    const rect = paneEl.getBoundingClientRect()
    if (!contains(rect, x, y)) continue
    const strip = paneEl.querySelector("[data-dockkit-strip]")
    if (strip !== null && contains(strip.getBoundingClientRect(), x, y))
      return { kind: "strip", paneId, index: insertionIndex(chipRects, x) }   // 落在 tab 条 → 插入位置
    const zone = dropZones === "horizontal" && canSplit && paneIsRow ? (x < rect.x + rect.width / 2 ? "left" : "right")
                                                                     : edgeZone(rect, x, y, threshold)
    return { kind: "zone", paneId, zone }                                     // 落在 body → center/left/right/top/bottom
  }
  return undefined
}
```

落点视觉（同处，字节 897728-897900）：

```js
function DockHint({ zone, active, labels }) {
  return jsx("div", { className: css.dockHint, "data-dockkit-dock-zone": zone, "data-dockkit-drop-active": active || undefined,
    children: jsx("div", { className: css.dockHintCard, children: [ jsx(ZoneIcon, { zone }), jsx("span", { className: css.dockHintLabel, children: labels.dropZone[zone] }) ] }) })
}
// 只在 dropTarget.kind === "zone" 且属于该 pane 时渲染，外加一层遮罩 div[data-dockkit-dock-scrim]
```

对应 CSS（`<BUNDLECSS>`，字节 72866-74520）：`[data-dockkit-dock-zone=center|left|right|top|bottom]` 定位、`[data-dockkit-drop-active]` 高亮、`_tabDragging_{opacity:.5}`。

**判定与结论**：

1. dockkit 的拖放**入口是 `onPointerDown` 的 tab chip**（`data-dockkit-tab`），状态机是组件内部 React state（`draggingTabId/dropTarget`），**没有任何公开 API**能让外部把一次 HTML5 drag 灌进去。
2. 它的动作面 `intents.dropTab(tabId, paneId, zone)` / `placeTab(tabId, …)` 要求一个**已存在的 tabId**（右栏 store 里的记录）；外部会话不是 tab，半步都走不了。
3. drop 视觉（`DockHint` / scrim / `_tabDragging_`）是 dockkit 内部组件，由 `dropTarget` state 驱动；外部拖入时无法点亮它们。要复用视觉只能**照抄标记与样式**（`data-dockkit-dock-zone` 等属性名是稳定的，CSS 类名是 hash），做不到"官方视觉自动跟随"。
4. `dropZones: "horizontal"` 这一档（`<RGT>lib/client.js:1538`）在 `dropTab` 里明确丢弃 `top/bottom`（`:1193`），双 pane 时非 center 直接不加分栏（`:1194`）。
5. 右栏面板元素本身是 `pointer-events: none`（`SidebarRight.module.css` 的 `.panel` 规则，`<RGT>lib/client.js:1258`），命中它的是内部 `[data-dockkit-host]`（`pointer-events: auto`，dockkit CSS 字节 66231 附近）等子元素；**给"面板 DIV"挂监听要靠事件冒泡，靠 hit-test 的单点判定要用 `elementFromPoint`/几何**。

### 5.3 结论：现有实现**不支持**外部拖入，但拖拽源已现成

- 可白拿的一半：左栏行 `dragstart` 已把 `sessionId` 放进 `text/plain`，且拖拽期间整页 `dragover` 已被左栏 `preventDefault`（5.1）。插件**不需要**再给行加 `draggable`。
- 必须自建的一半：右栏落点监听、落点判定、视觉反馈、投放语义。

### 5.4 落地方案要点（插件侧）

**监听什么事件**

| 事件 | 阶段 | 作用 |
|---|---|---|
| `dragstart` | capture（`document`） | 记录拖拽源：`event.target.closest('[data-row-key^="session:"]')` → `dataset.rowKey.slice(8)`。**这是唯一可靠的 sessionId 来源**（workspace 行也写 `text/plain`，载荷无法区分） |
| `dragover` | capture（`document`） | 命中右栏才 `preventDefault()` 并设 `dropEffect`；同时点亮自己的落点视觉。`dragover` 阶段 `getData()` 取不到数据（保护模式），只能用 `types.includes('text/plain')` 兜底 |
| `drop` | capture（`document`） | 命中右栏 → `preventDefault()` → `ctx.sidebarRight.openResource(...)`；随后清状态 |
| `dragend` | capture（`document`） | 兜底清理（拖到窗口外/Esc 取消时不会有 `drop`） |

**在哪个元素上判定放置**

- 首选几何判定 + 归属校验，避开 `pointer-events` 陷阱：
  ```js
  const dock = document.querySelector('[data-dockkit-host="dock"]')   // 右栏停靠面（折叠时被 translate 出视口、visibility:hidden）
  const rect = dock.getBoundingClientRect()
  const overDock = rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  ```
- 兜底（拖到 pane 之间的 0 宽分隔线、或 `data-dockkit-host` 尚未渲染）：
  ```js
  const hit = document.elementFromPoint(x, y)
  const panel = hit && hit.closest('[data-sidebar-right-panel]')   // 面板根：data-sidebar-right-session / -panel / -open
  ```
  面板根属性来自 `<RGT>lib/client.js:1522-1532`（`data-sidebar-right-session={sessionId}`、`-panel="push|fullscreen"`、`-open`）。
- 分栏落点（可选）：`document.elementFromPoint(...).closest('[data-dockkit-pane]')?.dataset.dockkitPane` 得到 paneId，配合左右半区决定 `preferNewPane`。
- **折叠态**：折叠时 dock 面被 `transform: translateX(var(--dsh-sidebar-width))` + `visibility: hidden`（CSS `<RGT>lib/client.js:1258`），几何判定会失败。此时用 `ctx.sidebarRight.isExpanded() === false` 时放宽为"视口右侧 20%~25% 视为落点"，并在 `drop` 里正常 `openResource`（该 API 本身就会展开面板："content the user cannot see is not opened"，`<RGT>README.md:92`）。

**投放动作**：不要自己造右栏状态。用 `ctx.sidebarRight.openResource(address, { kind, preferNewPane })`（`<RGT>lib/client.js:2225-2237`）或 `openTab(kind, options)`（`:2238-2246`）；两者都要求"屏上有一个 Session"（内部 `this.require()`，`:2235`、`:2244`），无 Session 时会抛错（`<RGT>README.md:96` 的 `mounted` 说明）。**也因此这条链路必须先注册自己的 tab 类型**（见 5.5），否则 `openResource` 抛 `no registered tab type claims "…"`（`:2294`）。

**视觉**：自建。用插件自己的属性（如 `data-session-aside-drop`）+ 一段 `styles.insert`/`<style>`，描边/填充照抄右栏既有 token（`--dsw-alias-state-business-primary` 等，见 dockkit CSS 字节 73753、74633 的用法）。**不要**去改 dockkit 的 `data-dockkit-drop-active`，那是它内部 state 的渲染结果，下一帧就被 React 覆盖。

### 5.5 右栏"装一个会话"的现成链条（关键先例）

`client-ui-subagent` 已经实现了"把某个会话作为右栏 tab 打开"，正是本需求要的形状（`<PKG>dsh-client-ui-subagent/lib/client.js`）：

1. 资源地址与解析：`:701-743`（`dsh-resource://subagentchat/session/<id>?parent=…&mode=…`，`parseSubagentChatAddress` 做严格校验）。
2. 资源提供者（**持有会话引用**）：`:755-780` —— `ctx.resources.register({ protocol, async *open(address, {signal}) { const ref = sessions.retain(address, {source, signal}); try { yield {ok:true, value:{address, reference:ref}}; await waitForAbort(signal) } finally { ref.release() } } })`。
3. tab 类型注册：`:819-829` —— `ctx.sidebarRightTabs.register({ id, kind: 'subagentchat', patterns: ['dsh-resource://subagentchat/**'], priority: 'builtin', canOpen, title: (address) => … })`。
4. tab 本体：`:800-816`（`SidebarChatTab`：`useTabInfo()` 取 `tab`，`useResource(tab.contentId)` 取引用，包 `SessionProvider`，再 `renderSlot('sidebar.chat.conversation')`）+ `:830-837` 注册到 `sidebar.right.pane.tab`（`key` = 类型 id，子槽 `sidebar.chat.conversation`）；`:838` 再用 `ConversationSlotPanel`（`:786-798`）把内容交给 factory 槽 `conversation.content`（`variant: "embedded"`）。
5. 触发点：`:964-977` —— 菜单/按钮里调 `ctx.sidebarRight.openResource(subagentChatAddress(address), { kind:'subagentchat', preferNewPane: true })`；UI 文案 `open.sidebar`（`"在侧边栏打开"`，`:881`）。

这 5 步就是"在侧边栏打开一个会话"的完整可复制路径（含中文文案先例）。差别只在于：subagent 的地址带 `parent/mode` 且只对子会话生效；本需求要对任意会话生效，因此要自己定义地址格式、`canOpen`、`title(address)`（可读 `ctx.sessions.list` 拿 `displayTitle`，参考 `:826-828`）。

## 6. Q5 — `ctx.uiWorkspace` / `ctx.sessions` / `ctx.layout` 公开面

### 6.1 `ctx.uiWorkspace`（`UiWorkspaceService`，`super(ctx, "uiWorkspace")`，`<PKG>dsh-client-ui-workspace/lib/client.js:1360-1380`）

生成式契约：`<PKG>dsh-cordis-client-runner/lib/client.js:1489-1620`。

| 方法 | 签名 | 语义 / 行号 |
|---|---|---|
| `openSession` | `(target: SessionTarget) => void` | 选中会话并把 Conversation 显示出来（一次导航）；`SessionTarget` 可以是 id 或 subagent 地址。`:1471-1473` |
| `openWorkspace` | `(workspaceId, beforeOpen?, options?) => Promise<void>` | 连接工作区并打开其会话，可被后续导航取代。`:1474-1491` |
| `connectWorkspace` | `(workspaceId, options?) => Promise<SessionId>` | 解析/新建 blank 会话。`:1397-1416` |
| `startSession` | `(workspaceId?, options?) => void` | 新建会话（含草稿初始化）。`:1500-1528` |
| `forkSession` | `(sessionId, onCreated?, options?) => Promise<SessionId>` | 分叉不改当前选择。`:1492-1499` |
| `archiveSession` / `unarchiveSession` | `(sessionId, {stopActivity?}) => Promise<void>` / `(sessionId) => Promise<void>` | `:1542-1548` |
| `pinSession` / `unpinSession` | `(sessionId) => Promise<void>` | pin 还会改写本地顺序。`:1549-1559` |
| `pickDirectory` / `listDirectory` / `createDirectory` | 目录选择 | `:1560-1574` |

**当前选中的会话 id**：`ctx.uiWorkspace.mainReference?.sessionId`（内部字段，`:1370`、`:1652-1675`），或读它的持久 store：`ctx.uiWorkspace.selection.getSnapshot()` → `{ sessionId?, subagentAddress? }`（`:1369` 定义，`persist.name = "dsh.sessions.current"`；写入点 `:1648`、`:1663-1666`）。`selection` 是普通类字段（非 `#private`），可读；`mainReference` 同名。注意 `mainReference` 只表示"主视图持有"，当"全局面板占屏"时它仍存在——**"当前 panel 是否被全局页面占位"要看 6.3 的 `panelInfo`**。

### 6.2 `ctx.sessions.list`（会话目录快照）

- 服务：`ctx.sessions`（Session Controller 客户端面，生成式契约 `<PKG>dsh-cordis-client-runner/lib/client.js:1266-1360`）。
- `list` 是**快照 store 字段**（契约目录只列方法，故没写进去；源码见 `<PKG>dsh-api-session-controller/lib/types/client/sessions/service.js:150,165`）：
  ```js
  // <PKG>dsh-api-session-controller/lib/types/client/sessions/service.js
  this.list = createSnapshotStore({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} })   // :165-166
  // … manager 的列表快照投影进来（:488-566）…
  this.list.set({ ids, byId, phase, projectionsBySession })                                            // :566
  ```
- 订阅：`ctx.sessions.list.subscribe(listener)` + `ctx.sessions.list.getSnapshot()`（快照 store 自带的这一对；`ui-workspace` 自己就这么用：`<PKG>dsh-client-ui-workspace/lib/client.js:1597-1598`，列表快照的构建在 `<PKG>dsh-api-session-controller/lib/types/client/sessions/manager.js:536-545`）。
- 行数据（`byId[id]`，`:493-520`）：`{ id, displayTitle, running, retainedBy, blank, updatedAt, formatStatus, projectionValues?, title?, cwd?, parentId?, origin? }`。`parentId/origin:'subagent'` 的行是子代理目录行（左栏会隐藏 `origin: 'subagent'` 的持久摘要，见 `<PKG>dsh-client-ui-workspace/README.md:180`）。
- 组件里不要直接摸 store：用根 hook `useSessions`（selector 版快照 hook）。绑定处：
  ```js
  // <PKG>dsh-client-ui-session/lib/client.js:1102-1113
  ctx.slots.provideRoot({
    hooks: { sessions: ctx.sessions.list, sessionStatus: service.sessionStatus },
    keyedHooks: {
      sessionRetainInfo: (key) => ctx.sessions.retainInfo(key),
      sessionAccess: (sessionId, action) => action === void 0 ? void 0 : ctx.remoteAccess.source("session", sessionId, action)
    }
  });
  ```
  即 `useSessions((s) => s.byId[id]?.displayTitle)`；同一处还提供 `useSessionStatus`（用于"运行中/待交互"标记）。

### 6.3 `ctx.layout` 与 `panelInfo`

```js
// <PKG>dsh-client-ui-layout/lib/client.js:391-409（defineStore 的 init / actions 片段）
const store = {
  init: () => ({
    panelInfo: { activePanelId: null },
    layoutInfo: { sidebar: 280, viewportWidth: window.innerWidth, narrowExpanded: false,
      rightbar: null, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false, rightbarInstant: false }
  }),
  actions: {
    selectPanel: (d, panelId) => { d.panelInfo.activePanelId = panelId }
    // retainMainPanels / setSidebar / toggleSidebar / setViewportWidth / setRightbar / openRightbar / closeRightbar …
  }
}

// <PKG>dsh-client-ui-layout/lib/client.js:452-495  LayoutController（= ctx.layout）
class LayoutController {
  panelInfo;                   // 快照读面，见 :617-620
  selectPanel(panelId) {}      // panelId 为 null = 回到 Conversation；未注册的 id 抛错 :468-472
  beginNavigation() {}         // 返回取消信号 :473-478
  toggleSidebar() {}           // :483-486
  openRightbar(track, fullscreen) {}  // :487-490
  closeRightbar() {}                  // :491-494
}
```

- **"当前 panel 是否被全局页面占位"**：`ctx.layout.panelInfo.getSnapshot().activePanelId !== null`（初始化 `null`，`:394`）；组件里用 hook `usePanelInfo((info) => info.activePanelId !== null)`（根 hook 绑定：`<PKG>dsh-client-ui-layout/lib/client.js:621`；实际用法：左栏 `<PKG>dsh-client-ui-workspace/lib/client.js:3357,3368`，框架本身 `:58,119`）。
- 注意 `selectPanel(null)` 会把主视图切回 Conversation；`uiWorkspace.replaceMain(..., "reveal")`/`clearMain()` 内部就调用它（`<PKG>dsh-client-ui-workspace/lib/client.js:1650`、`:1674`）。**所以"在右栏打开第二个会话"不能用 `uiWorkspace.openSession`**——它会把主栏换掉。

### 6.4 `ctx.sidebarRight`（右栏控制器，`inject: ['sidebarRight']`）

提供处：`<RGT>lib/client.js:4965-4966`（`ctx.reflect.provide("sidebarRightTabs", tabs)` / `("sidebarRight", controller)`）。契约：`<RGT>README.md:92-98`。

| 成员 | 说明 | 行号 |
|---|---|---|
| `openResource(address, options?)` | 认领 `dsh-resource://…` 地址并放置；面板会自动展开 | `:2234-2237`（放置细节 `:2292-2339`） |
| `openTab(kind, options?)` | 按 kind 打开页面型 tab | `:2243-2246` |
| `close(tabId)` / `active()` / `isExpanded()` / `toggleExpanded()` / `focus(tabId)` | 状态与操作 | `:2344-2381` |
| `split/float/dock/focusedTarget/commandTarget/isTargetCurrent` | 布局与焦点 | `<RGT>README.md:96-98` |
| `tabsIn(sessionId)` / `openTabs` / `mounted` | 只读元数据 | `:2226-2228`、`<RGT>README.md:75,96` |

前置条件：**屏上必须有 Session**（`require()`，`:2235`/`:2244`），否则抛错；地址必须以 `dsh-resource:` 开头并有类型认领（`:2294`），页面 kind 必须已注册（`:2300`）。

### 6.5 右栏 tab 类型注册（配合 5.5）

- `ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted?, multiple? })`（`<RGT>README.md:82`，实现调用见 subagent `:819-829`）。
- tab 本体槽位：`{ name: 'sidebar.right.pane.tab', key: <类型 id> }`，`kind: "keyed"`、`scope: "session"`；占位者能拿到 `useTabInfo()`（`hookContext: "TabHookContext"`）与 `SidebarRightTabInjected`，标准 props 还含 `useChat/useConversation/useInput/useSession/useProjection/useTrajectory`，见 `<PKG>dsh-cordis-client-runner/lib/client.js:5844-5897`。
- 标题槽位：`sidebar.right.pane.tab.title`（同一 key）。

## 7. Q6 — 会话行能否被插件用 DOM 方式安全增强

### 7.1 稳定选择器锚点（按可用度排序）

| 锚点 | 说明 |
|---|---|
| `[data-row-key^="session:"]` | **首选**。值 `session:<id>`；框架自用（位移动画 key），跨版本可用；同时天然给出 sessionId |
| `[role="treeitem"]`（在 `[role="tree"]` 内） | ARIA 契约；但要注意 `role="tree"` 容器同时含工作区分组行（`data-row-key^="workspace:"`）与"展开其余 N 个会话"按钮 |
| `[data-row-key^="workspace:"]` | 分组行，别和会话行混淆 |
| `[data-dockkit-pane]` / `[data-dockkit-host="dock"]` / `[data-dockkit-strip]` / `[data-dockkit-tab]` | 右栏（dockkit 公开标注，见 5.2 与 `<RGT>lib/client.js:1258` 的 CSS 选择器用法） |
| `[data-sidebar-right-session]` / `[data-sidebar-right-panel]` / `[data-sidebar-right-open]` | 右栏面板根（`<RGT>lib/client.js:1529-1531`） |
| `.wnFoaW_sessionRow` 等 hash class | **禁用**：CSS Modules hash，随构建变化（`:1742,1782`） |

### 7.2 React 重渲染会不会丢掉插件加的属性/监听

判断依据（全部来自行组件的实现，`<PKG>dsh-client-ui-workspace/lib/client.js:2255-2369`）：

1. 行是 React 管理的 `div`，其 props 固定为 `:2274-2303` 那一组（`data-row-key`/`className`/`role`/`aria-*`/`draggable`/`onClick`/`onPointer*`/`onDrag*`）。React 只写它**自己拥有**的 props，**不会**清除插件用 `setAttribute`/`addEventListener` 加的东西——只要 DOM 节点是同一个。
2. **节点会被复用**：行在列表里以 `node.id` 为 key（`:3308`、`:3437`），所以排序/插入/选中态变化、`menuOpen` 切换、拖拽 marker 变化都只是重渲染同一节点 → 插件加的属性、监听**存活**。
3. **节点会消失并重建的时机**（插件增强必须能重放）：
   - 分组折叠 / "展开其余 N 个会话"水位变化（`watermarkRows`，节点被卸载；`:3157-3165`、`:3310-3327`）；
   - 切换分组方式/排序/归档筛选 → 分组树与平铺列表互换组件（`:3339` vs `:3379`）；
   - 进入/退出搜索态（会话行整体不在 DOM，换成 `SearchResultItem`，`:2179`）；
   - 会话被归档/恢复、行从可见集合移除；
   - 行被 `AnimatedRows` 当作"退出行"搬到惰性覆盖层：`overlay.append(element)` 会把**原节点**移出列表（`:2470`，覆盖层 `:2539-2543`），100ms 后删除（`ROW_FADE_MS`，`:2385`）——节点上的属性还在，但已不在树内、且 `pointer-events: none`（CSS `RsIu1q_exits`，`:2372`）。
   - 左栏折叠为 rail：Windows 标题栏形态下 `regionArea` 被 `display:none`（节点仍在、只是不渲染），规则在 `<PKG>dsh-client-ui-sidebar/lib/client.js:115`（选择器带 `[data-windows-titlebar]` 前缀）；非该形态的 rail 渲染本次未取证，按"节点可能被卸载"处理更安全。
4. 反过来：**官方不会**因为重渲染重建 `data-row-key` 的值，也不会给行加 `draggable=false`（除 blank/archived）。

结论：DOM 增强**可行但必须幂等 + 可重放**。推荐骨架（与 `dsh-session-motion/client.js:304-328` 同款做法）：

```js
const marked = new WeakSet()
function enhanceRow(row) { if (marked.has(row)) return; marked.add(row); row.setAttribute('data-session-aside-row', '') /* 挂监听、插入按钮 */ }
function scan() { for (const row of document.querySelectorAll('[data-row-key^="session:"]')) enhanceRow(row) }
const observer = new MutationObserver(() => schedule(scan))     // childList 为主，属性变化可省
observer.observe(document.body, { subtree: true, childList: true })
```

- 判重不要用"节点是否还在"（覆盖层里的退出行仍在），用 `WeakSet` + 标记属性；插件卸载时 `observer.disconnect()` 并清理自己加的节点/属性。
- 若只是为了"菜单里多一项 / 行尾多一个按钮"，**优先走 slot（第 2、3 节）**：那是 React 树内注册，重渲染不丢，也不需要 MutationObserver，且没有和官方行结构耦合的风险。

## 8. 运行期待核对项（本机 GUI 需认证，未做）

1. `cordis_inspect_query`（client `Slots.listSubTree`，root=`sidebar.workspaces.session.menu.item`）应在运行页里确认：occupants 恰为 pin/rename/fork/archive/session-id + 插件新项，`order` 排序符合预期。
2. 真实 DOM 里会话行是否如 4.2 所画（`data-row-key`、`role`、`draggable`、`rowActions` 顺序）。
3. 拖拽时 `document` 上确实只有左栏那对 `dragover/drop` 监听（5.1），以及 `drop` 后 `dropEffect` 的实际反馈。
4. 右栏折叠态下 `[data-dockkit-host="dock"]` 的 `getBoundingClientRect()` 是否如推断落在视口外（决定 5.4 的折叠兜底阈值）。

## 9. 关键行号索引（速查）

| 结论 | 出处 |
|---|---|
| 菜单槽位声明 + 注入 hooks | `<PKG>dsh-client-ui-workspace/lib/client.js:5228-5235` |
| 菜单渲染 + owner props | 同文件 `:2345-2348` |
| 五个 shipped 菜单项注册 | 同文件 `:5253-5289` |
| `SessionIdMenuItem` 实现 | 同文件 `:4724-4741` |
| `sessionIdInjected` | 同文件 `:5154-5156` |
| `menuOpenStateFactory` | 同文件 `:12-22` |
| 行 `data-row-key`/`draggable`/`dragstart` | 同文件 `:2276,2286-2303` |
| `drag` 可用性判定 | 同文件 `:2262` |
| 行 action 槽渲染 | 同文件 `:2349-2352` |
| leading 槽渲染（仅 idle） | 同文件 `:2305-2308`、`:2261` |
| 分组列表渲染 SessionNodeItem | 同文件 `:3256-3308` |
| 平铺列表渲染 SessionNodeItem | 同文件 `:3355-3356`、`:3389-3437` |
| 搜索行组件（无 data-row-key） | 同文件 `:2179-2225` |
| 拖拽期间 document 级接受 | 同文件 `:2854-2876`、调用点 `:3036-3037,3367` |
| `data-row-key` 被框架读回 | 同文件 `:2488-2497` |
| `uiWorkspace` 服务类 | 同文件 `:1360-1380`、`openSession:1471-1473`、`selection:1369` |
| 右栏面板根 data 属性 | `<RGT>lib/client.js:1522-1532` |
| `ctx.sidebarRight` 提供与 API | 同文件 `:4965-4966`、`:2225-2381`、`:2294/2300`（抛错条件） |
| dockkit 落点判定/拖拽状态机 | `<BUNDLE>` 字节 909700-912700 |
| dockkit 落点视觉组件 | `<BUNDLE>` 字节 897728-897900；`<BUNDLECSS>` 字节 72866-74520 |
| 生成式 Slot 契约（menu.item / row.action / leading / hover） | `<PKG>dsh-cordis-client-runner/lib/client.js:6661-6713 / 6715-6762 / 6497-6544 / 6449-6496` |
| 生成式服务契约（uiWorkspace / sessions） | 同文件 `:1489-1620` / `:1266-1360` |
| 会话目录快照 store | `<PKG>dsh-api-session-controller/lib/types/client/sessions/service.js:150,165-166,493-566`；`manager.js:536-545` |
| `useSessions` 根绑定 | `<PKG>dsh-client-ui-session/lib/client.js:1102-1113` |
| `panelInfo` / `selectPanel` / 根绑定 | `<PKG>dsh-client-ui-layout/lib/client.js:391-409,452-495,617-621` |
| "在侧边栏打开"先例（子代理聊天） | `<PKG>dsh-client-ui-subagent/lib/client.js:295-318,701-715,755-845,964-977` |
