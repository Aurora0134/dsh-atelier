# dsh-session-motion

DSH 会话主屏的两处观感增强：流式输出时内容平滑上移，思考块在限高视口内逐步呈现并在结束后平滑收起。

## 行为

- **平滑上推**：流式输出时，主屏内容不再按批次硬跳。DSH 每次把会话贴到底部时都会立即写入新位置，插件在同一个渲染帧里补偿这次高度差并在 120ms 内缓出，视觉上连续上移。底部的“深度求索中…”状态行按帧对齐到底部锚点：位移、贴底写入晚一帧、上方某一行动态变高（例如手动展开思考行）都不会带偏它。补偿作用在内层内容容器上并对其做了裁剪，因此不改变滚动高度，DSH 的贴底计算不受影响。仅在“贴底跟随”时生效；用户滚动/触摸/按键立即让位；DSH 自身正在播放的折叠批次、系统“减少动态效果”都不介入。
- **思考视口**：思考块在流式输出期间自动展开，正文限制在 `min(240px, 35vh)` 高的视口内滚动（上下 20px 渐隐、左侧 1px 竖线），只纵向滚动，宽内容不会带出横向滚动条。
- **平滑收起**：思考结束自动收起时，先把整行高度在 170ms 内收缩到标题行高度，再提交官方的折叠状态；用户点击一个已展开的思考行同样按此收起。展开保持官方即时行为。用户手动开合过的行不再被插件改动；流式期间用户上滑阅读，结束也不强制收起。
- 其它 DSH 原生 UI 不做改动。

## 安装 / 回滚

在 Harness 中安装（plugin_manager）：

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

已安装时通过插件设置禁用即可即时回滚（`set_plugin` 该行 `enabled=false`），或 `remove_bundle` 卸载。安装会写入 profile 的 `package.json`、`pnpm-lock.yaml` 与 `node_modules` 链接，`cordis.patch.yml` 不变。

## 调整参数

`client.js` 顶部的常量：

| 常量 | 默认 | 作用 |
| --- | --- | --- |
| `VIEWPORT_MAX_HEIGHT` | `min(240px, 35vh)` | 思考正文视口最大高度 |
| `FADE_SIZE` | `20px` | 视口上下渐隐高度 |
| `FOLLOW_MOTION_MS` | `120` | 上推动效时长 |
| `FOLD_MOTION_MS` | `170` | 思考行收起动效时长 |
| `MOTION_EASING` | `cubic-bezier(0.4, 0, 0.2, 1)` | 两处动效的缓动曲线 |
| `STRUCTURAL_GROWTH_PX` | `800` | 超过该高度的整列变化（切会话/加载历史）不做补间 |
| `ATTACH_SETTLE_MS` | `300` | 刚接管一列时先观望的时长，避开加载历史带来的整列跳动 |

修改 `client.js` 后约 0.5 秒热更到已打开的页面，无需重装或刷新。

## 兼容性

实现依赖 DSH 会话主屏的 `data-*` 属性与非公开结构（`data-chat-flow`、`data-chat-following-tail`、`data-chat-turn-spacer`、`data-slot="conversation.chat.flow"`、`data-chat-running`、`data-variant="think"`、`data-disclosure-header/-row` 等），属于非公开契约。DSH 升级后若这些属性变化，插件会静默退回原生行为（不报错、不白屏），按需回归即可；若上游把“贴底跟随”改成自带缓动，插件的补偿会自然停用。
