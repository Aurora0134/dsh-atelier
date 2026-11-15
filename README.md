# dsh-atelier

界面工艺：把 DSH 的四项观感增强合成一个插件包——会话主屏的动效、右侧栏的并排会话、侧栏底部的明暗切换，以及启动时的品牌开屏。

四项特性原本是四个独立插件（源码留档在 `import/`）。合并的原因很直接：一个包只有**一个**客户端注册 id，且该 id 必须等于包名，四段界面代码必须挤进同一个工厂、同一个 `apply`。

## 包内有什么

| 部分 | 文件 | 谁在跑 |
| --- | --- | --- |
| 客户端三段（动效 / 侧栏会话 / 明暗切换） | `client.js` | 浏览器端，一个注册 id `dsh-atelier` |
| 开屏动画 | `index.js` + `browser/splash.js`、`browser/splash.css`、`browser/*.svg` | 宿主半读文件后注入到页面首帧之前 |
| 卡片元信息 | `locale/zh.json`、`locale/en.json` | 插件管理页的标题与描述 |
| 图标 | `icon.svg` | 插件管理页 |

## client.js 的三段

三段共享一个工厂作用域，但互不共享可变状态：各自的常量、字典、`ctx.effect` 标签和 DOM 属性前缀都带自己的段名，同名项一律加前缀区分（`MOTION_CSS` / `ASIDE_CSS` / `THEME_CSS`、`ASIDE_ZH` / `THEME_ZH`、`ASIDE_LOCALE_NS` / `THEME_LOCALE_NS`），没有覆盖式声明。`apply` 依次调用三个子 apply，每段包在自己的 try/catch 里：某一段启动抛错只记一行 `console.error`，其余两段照常工作。

### 1. motion —— 会话动效

- **平滑上推**：流式输出时主屏内容不再按批次硬跳。DSH 贴底写入新位置的同一个渲染帧里，插件补偿这次高度差并在 160ms 内缓出；补偿作用在内层内容容器上并做了裁剪，不改变滚动高度，因此 DSH 的贴底计算不受影响。仅贴底跟随时生效，用户滚动/触摸/按键立即让位。
- **思考视口**：思考块流式期间自动展开，正文限制在 `min(240px, 35vh)` 高的视口内纵向滚动（上下 20px 渐隐、左侧 1px 竖线）。
- **平滑开合**：思考结束自动收起时先收缩到标题行高度再提交折叠；用户点击开合同样带过渡，且用户手动开合过的行不再被插件改动。
- 系统「减少动态效果」与 DSH 自身正在播放的折叠批次都不介入。

### 2. aside —— 侧栏会话

- **入口**：把会话列表中的会话行拖到窗口右边的放置区；或在会话行「…」菜单里选「在侧边栏打开」。两个入口都不对**当前屏幕上的会话**生效——它已经在主屏里。
- **行为**：每次打开生成一个右侧栏标签页，占整栏宽度，标题跟随会话当前标题，重复打开只切到已存在的标签页；嵌入视图的输入框可用，与主屏共享草稿；右侧栏布局按会话保存（DSH 自身行为）。不改动主屏选择。

### 3. theme —— 明暗切换

- 按钮叠在侧栏底部账号行的右端，只占 28px，账号行其余区域仍打开账号菜单；侧栏收成 56px 轨道时移到账号行下方，避免遮挡 36px 的账号图标。
- 图标对应实际配色：浅色显太阳、深色显月亮；「跟随系统」时按系统实际配色显示，点击后固定为另一种显式外观。
- 只通过客户端 `theme` 服务读写外观，只在账号行挂一个按钮节点，不改动宿主组件结构。尺寸、圆角、悬停底色与焦点环沿用侧栏自身的图标按钮。

## 开屏不在 client.js 里

品牌开屏由**宿主半**负责：`index.js` 读取 `browser/` 下的样式与脚本，把鲸鱼与品牌字矢量作为字符串注入，向 Web 服务的索引注入表追加一行 `<style>` 与一行 `<body>` 脚本，Web 端随 `index.html` 直接下发、桌面端在页面挂载前应用，两边都先于 shell 首帧生效。

时序：品牌字以「位移 + 透明度 + 模糊」约 0.6s 浮现，随后在徽标接缝处向右展开（`cubic-bezier(0.65, 0, 0.35, 1)`），`HARNESS` 徽标同时从基线下方升入并由接缝裁切，停留约 0.5s 后整层 0.42s 淡出。工作区未挂载完则停在成型的品牌字上等待；启动失败会立即撤下遮罩让官方错误页显示；最长覆盖 15s；「减少动态效果」下跳过编排。

## 特性开关

`client.js` 顶部有 `FEATURE_DEFAULTS = { motion: true, aside: true, theme: true }`，默认三段全开。

`readFeatureSwitches(ctx)` 会尝试从客户端根上下文读一个配置对象（`ctx.config`，或 `ctx.get('config')` 返回的服务），读取 `features.motion / features.aside / features.theme` 三个布尔值。**依据与现状**：本版客户端文档没有声明页面上下文的配置通道，行配置由宿主半通过 `ctx.fiber.entry` 与 `ctx.get('configEditor')` 读写，不进入浏览器；因此这个探测是宽容的——读不到、读错、或字段缺失时一律回落到「全开」，不会因为配置不可用而误关某项特性。要真正按行配置开关，需要上游提供客户端可读的配置通道。

## 与原插件的对应关系

| 原插件 | 原入口 | 现在的落点 |
| --- | --- | --- |
| `import/session-motion` | `client.js` | `client.js` 第 1 段，`applyMotion` |
| `import/session-aside` | `client.js` | `client.js` 第 2 段，`applyAside` |
| `import/theme-toggle` | `client.js` | `client.js` 第 3 段，`applyTheme` |
| `import/splash` | `index.js` + `browser/` | 原样留在宿主半，不进 `client.js` |

`import/` 下是四个旧包的源码留档（含各自的 recon/verify 文档与截图），只用于溯源，不参与打包。

## 安装 / 禁用 / 移除

在 Harness 中安装（plugin_manager）：

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

禁用而不卸载：设置 → 插件 → 找到本包关闭即可，界面立即回到原生状态（三段同时停用）。

```
plugin_manager(action="remove_bundle", target="dsh-atelier")
```

安装会写入 profile 的 `package.json`、`pnpm-lock.yaml` 与 `node_modules` 链接。

## 调整参数

`client.js` 顶部的常量（motion 段）：

| 常量 | 默认 | 作用 |
| --- | --- | --- |
| `VIEWPORT_MAX_HEIGHT` | `min(240px, 35vh)` | 思考正文视口最大高度 |
| `FADE_SIZE` | `20px` | 视口上下渐隐高度 |
| `FOLLOW_MOTION_MS` | `160` | 上推动效时长 |
| `DISCLOSURE_MOTION_MS` | `240` | 思考行开合动效时长 |
| `MOTION_EASING` | `cubic-bezier(0.4, 0, 0.2, 1)` | 两处动效的缓动曲线 |
| `STRUCTURAL_GROWTH_PX` | `800` | 超过该高度的整列变化（切会话/加载历史）不做补间 |
| `ATTACH_SETTLE_MS` | `300` | 刚接管一列时先观望的时长 |

开屏的可调项在 `index.js` 与 `browser/`：品牌字高度 `32px`（所有部件按 em 等比缩放）、展开时长与延迟 `760ms cubic-bezier(0.65, 0, 0.35, 1) 460ms`、两段裁剪窗口 `LEFT_VIEW_BOX` / `BADGE_VIEW_BOX`、`REVEAL_AFTER`（1740ms）、`GIVE_UP_AFTER`（15000ms）。

改 `client.js` 后约 0.5 秒热更到已打开的页面；改开屏相关文件需重新安装或重启。

## 兼容性

- **公开契约**：会话资源协议与右侧栏标签类型（`ctx.resources.register` / `ctx.sidebarRightTabs.register` / `ctx.sidebarRight.openResource`）、会话行菜单槽位 `sidebar.workspaces.session.menu.item`、槽位 `sidebar.right.pane.tab`、`conversation.chat.reasoning.body`、客户端 `theme` 与 `locale` 服务、会话保留信息里的 `mainView` 计数。
- **非公开 DOM 契约**：motion 依赖会话主屏的 `data-chat-flow`、`data-chat-following-tail`、`data-chat-turn-spacer`、`data-slot="conversation.chat.flow"`、`data-chat-running`、`data-variant="think"`；aside 依赖会话行的 `data-row-key="session:<id>"`、右侧栏的 `data-sidebar-right-*` 与停靠容器的 `data-dockkit-*`；theme 依赖 `[data-slot="sidebar.settings"]`；开屏依赖 `data-dsh-boot` 与 `data-dsh-boot-spinner`、`#root`。上游改名后各段会静默退回原生行为（不报错、不白屏）。
- **服务依赖**：合并后 `inject` 取三段并集 `['sessions', 'slots', 'locale', 'sidebarRight', 'theme']`；`resources` 与 `sidebarRightTabs` 仍由 aside 段自己的 `ctx.inject` 动态取，只在该段激活时要求。原先是三个包各自只声明自己需要的服务，现在少任一必需服务则整包不激活。
