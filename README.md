# dsh-splash

把 DSH（Web 与桌面端）启动时的加载画面换成 DeepSeek Harness 品牌开屏：正中心浮现侧栏同款品牌字（鲸鱼 + `deepseek` + `HARNESS` 徽标），随后该行在徽标接缝处左右分开，`HARNESS` 徽标从下方升入空位，组成完整品牌字，再淡出进入工作区。字号刻意保持小号，不做满屏 Logo。

品牌字不是用字体拼的，而是直接复用 DSH 侧栏渲染的那套矢量图形（`browser/whale.svg` 与 `browser/wordmark.svg`），所以鲸鱼、`deepseek` 字形和 `HARNESS` 徽标与侧栏完全一致，也不依赖任何字体加载。

## 行为

- **浮现**：品牌字以「位移 + 透明度 + 模糊」在约 0.6s 内浮现，不是硬切入。
- **展开**：该行在「`deepseek` 与徽标之间」的接缝处向右打开，缓动为 `cubic-bezier(0.65, 0, 0.35, 1)`——两端对称的缓入缓出，中段峰值速度约 2.9 倍均速（此前 0.85/0.15 的曲线为 6.7 倍），打开过程更平顺。
- **徽标升入**：接缝打开的同时，`HARNESS` 徽标从基线下方 0.62em 处升起并淡入，由接缝本身裁切，所以是从字位里长出来，而不是滑过整行。
- **淡出**：展开结束并停留约 0.5s 后，整层 0.42s 淡出。若工作区此时还没挂载完，画面停在成型的品牌字上等待，挂载完成即淡出；不会先淡出再露出加载画面。
- **失败兜底**：DSH 启动失败时会把加载画面切成错误信息。插件检测到这一状态（加载旋转标记消失）立即撤下自己的遮罩，让官方错误页照常显示，错误不会被盖住。最长覆盖 15s，超时后撤下，避免任何情况下卡在开屏。
- **减少动态效果**：系统开启「减少动态效果」时跳过编排，直接显示成型的品牌字，短停留后淡出。
- 其它 DSH 原生 UI 不做改动。

## 安装 / 回滚

在 Harness 中安装（plugin_manager）：

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

已安装时通过插件设置禁用即可即时回滚（`set_plugin` 该行 `enabled=false`），或 `remove_bundle` 卸载。安装会写入 profile 的 `package.json`、`pnpm-lock.yaml` 与 `node_modules` 链接。

## 实现

- `index.js`（宿主半）读取样式与脚本，把 `browser/whale.svg`、`browser/wordmark.svg` 以字符串字面量替换进脚本占位符，再向 Web 服务的索引注入表追加一行 `<style>` 与一行 `<body>` 脚本：Web 端随 index.html 直接下发，桌面端由启动注入表在页面挂载前应用，两边都先于 shell 首帧生效。
- `browser/splash.js` 把同一份品牌字裁成两段（字标段与徽标段）并驱动时序：裁剪靠 viewBox，徽标副本的 clip id 加后缀避免重复 id，徽标字母的反白填充改用遮罩自己的底色变量。同时观察加载画面与 `#root` 决定何时交接。
- `browser/splash.css` 承载配色回退（沿用主题引导写入的 `--dsh-boot-bg`）、几何尺寸与两段缓动；字号 `32px` 是整体 em 基准，所有部件按侧栏品牌的比例换算。

## 调整参数

| 位置 | 常量 | 默认 | 作用 |
| --- | --- | --- | --- |
| `browser/splash.css` | `.dsh-splash` 的 `--dsh-splash-mark-height` | `32px` | 品牌字整体高度；所有部件按 em 等比缩放 |
| `browser/splash.css` | `.dsh-splash-slot` 的 `transition` | `760ms cubic-bezier(0.65, 0, 0.35, 1) 460ms` | 展开时长、缓动与起始延迟 |
| `browser/splash.css` | `.dsh-splash-badge` 的 `transition` | `620ms/700ms` | 徽标升起与淡入 |
| `browser/splash.js` | `LEFT_VIEW_BOX` / `BADGE_VIEW_BOX` | `26.85 0 94.75 24` / `129.3 0 52.1 24` | 两段裁剪窗口，单位是品牌字自身坐标系 |
| `browser/splash.js` | `REVEAL_AFTER` | `1740` | 展开结束后停留多久再淡出（须与上面两段时长一致） |
| `browser/splash.js` | `GIVE_UP_AFTER` | `15000` | 最长覆盖时间 |

改完重新安装（或重启）后生效；`index.js` 在激活时读取这些文件，已打开的页面需刷新。

## 兼容性

- 依赖加载画面元素上的 `data-dsh-boot` 与旋转标记上的 `data-dsh-boot-spinner`，以及应用根节点 `#root`。这些是 DSH 前端的内部标记，非公开契约；若上游改名，插件会退化为「超时撤下遮罩」，不影响应用启动与错误显示。
- 品牌图形复制自当前版本的侧栏品牌（viewBox `26 0 156 24`）。上游改版后需同步替换 `browser/whale.svg`、`browser/wordmark.svg`，坐标系变化时一并调整 `LEFT_VIEW_BOX` / `BADGE_VIEW_BOX`。
