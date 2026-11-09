# dsh-session-aside

在右侧栏并排查看第二个会话，主屏的当前会话保持不变。

## 用途

主屏继续显示当前会话，右侧栏同时承载另一个会话；对照两段对话时不需要切走再切回。

## 入口

- **拖拽**：把会话列表中的会话行拖到右侧栏区域。拖动开始时窗口右边会出现放置区；在其中松手即在右侧栏打开该会话。
- **会话菜单**：在会话行的「…」菜单中选择「在侧边栏打开」。

两个入口都对**当前屏幕上的会话**不生效：它已经在主屏里，把它放进自己的右侧栏没有意义，因此菜单不提供该项、拖拽也不出现放置区。

## 行为

- 每次打开生成一个右侧栏标签页，占据右侧栏整栏宽度，已有标签页留在同一栏的标签条里；标签标题跟随该会话的当前标题，同一会话重复打开只会切到已存在的标签页。
- 右侧栏布局按会话保存（DSH 自身行为）：切到别的会话后看不到上一个会话的右侧栏内容，切回来即恢复。
- 嵌入视图的输入框可用，与主屏共享同一份草稿。
- 不改变主屏选择、不改动 DSH 本身。

## 安装 / 回滚

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

禁用而不卸载：设置 → 插件 → 列表中找到本插件并关闭；关闭后右侧栏立即回到原生状态，主屏不受影响。

彻底移除：

```
plugin_manager(action="remove_bundle", target="dsh-session-aside")
```

安装会写入 profile 的 `package.json`、`pnpm-lock.yaml` 与 `node_modules` 链接，profile 的 `cordis.patch.yml` 不变。

## 实现与兼容性

本包只有 Client 半区：`index.js` 的 Host 侧为空实现，界面全部由 `client.js` 在浏览器端完成，`dsh.client.inject` 为空，不依赖其它客户端插件的加载顺序。

依靠的公开契约：会话资源协议与右侧栏标签类型（`ctx.resources.register` / `ctx.sidebarRightTabs.register` / `ctx.sidebarRight.openResource`）、会话行菜单槽位 `sidebar.workspaces.session.menu.item`、以及会话保留信息里的 `mainView` 计数（用于识别当前屏幕上的会话）。

依靠的非公开 DOM 契约：左侧会话行的 `data-row-key="session:<id>"`、右侧栏的 `data-sidebar-right-*` 与停靠容器的 `data-dockkit-*` 属性；会话行本身已是原生 HTML5 拖拽源，拖拽数据以 `text/plain` 传递会话标识，插件只负责放置与打开。这些属性不是公开插件 API，DSH 升级后可能变化；发生变化时放置区会退回视口右侧的默认位置，或禁用/卸载本插件即可回到原生界面。
