# dsh-splash

把 DSH（Web 与桌面端）启动时的加载画面换成 DeepSeek Harness 品牌开屏：正中心浮现 `<DEEPSEEK>`，随后该行从 `>` 前的光标位左右分开，`HARNESS` 从下方升入空位，组成完整字标 `<DEEPSEEK HARNESS>`，再淡出进入工作区。字号刻意保持小号，不做满屏 Logo。

排版沿用 DSH 自带启动字标（`HARNESS`）的样式并按字标处理：系统正文字体、字重 600、全大写、字距 0.16em（原生字标为 0.08em，这里再放宽一档），让它在页面正中读起来是品牌标识，而不是一行正文。

## 行为

- **浮现**：品牌字字号 16px，以「位移 + 透明度 + 模糊」在约 0.6s 内浮现，不是硬切入。
- **展开**：该行自 `>` 前的位置向右打开一个「一个空格 + HARNESS」宽的缺口，缓动为 `cubic-bezier(0.85, 0, 0.15, 1)`——先慢、中段陡、再慢，中段速度明显快于两端。缺口宽度按当前字体实测，不依赖固定像素。
- **HARNESS 升入**：缺口打开的同时，`HARNESS` 从基线下方 0.62em 处升起并淡入，由缺口本身裁切，所以是从字位里长出来，而不是滑过整行。
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

- `index.js`（宿主半）向 Web 服务的索引注入表追加一行 `<style>` 与一行 `<body>` 脚本：Web 端随 index.html 直接下发，桌面端由启动注入表在页面挂载前应用，两边都先于 shell 首帧生效。
- `browser/splash.js` 构建品牌字、实测空格与单词宽度、驱动时序，并观察加载画面与 `#root` 决定何时交接。
- `browser/splash.css` 承载配色回退（沿用主题引导写入的 `--dsh-boot-bg`）、排版与两段缓动。

## 调整参数

| 位置 | 常量 | 默认 | 作用 |
| --- | --- | --- | --- |
| `browser/splash.css` | `.dsh-splash-word` 的 `font-size` | `16px` | 品牌字号 |
| `browser/splash.css` | `.dsh-splash-word` 的 `--dsh-splash-tracking` | `0.16em` | 字距；调大会更像字标，调小会回到普通文本的观感 |
| `browser/splash.css` | `.dsh-splash-word` 的 `--dsh-splash-bracket-pull-start` / `-end` | `0.13em` / `0.06em` | 两侧尖括号向字收紧的量，取值使两端视觉留白相等；换字体后需重调 |
| `browser/splash.css` | `.dsh-splash-slot` 的 `transition` | `760ms cubic-bezier(0.85, 0, 0.15, 1) 460ms` | 展开时长、缓动与起始延迟 |
| `browser/splash.css` | `.dsh-splash-harness` 的 `transition` | `620ms/700ms` | Harness 升起与淡入 |
| `browser/splash.js` | `REVEAL_AFTER` | `1740` | 展开结束后停留多久再淡出（须与上面两段时长一致） |
| `browser/splash.js` | `GIVE_UP_AFTER` | `15000` | 最长覆盖时间 |

改完重新安装（或重启）后生效；`index.js` 在激活时读取这两个文件，已打开的页面需刷新。

## 兼容性

依赖加载画面元素上的 `data-dsh-boot` 与旋转标记上的 `data-dsh-boot-spinner`，以及应用根节点 `#root`。这些是 DSH 前端的内部标记，非公开契约；若上游改名，插件会退化为「超时撤下遮罩」，不影响应用启动与错误显示。
