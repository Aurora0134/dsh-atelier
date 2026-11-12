# dsh-theme-toggle

在 DSH Web 界面的左侧栏底部提供一个浅色/深色外观切换按钮。

## 行为

- 按钮位于侧边栏底部的操作区，靠右；侧边栏收成 56px 轨道时居中，尺寸随轨道变为 36px。
- 图标对应当前实际配色：浅色显示太阳，深色显示月亮；点击后切换到另一种外观。
- 当前为“跟随系统”时，图标按系统实际配色显示，点击后固定为另一种显式外观。
- 按钮只通过客户端 `theme` 服务读写外观，不修改 DOM 结构或其它插件状态。

## 外观对齐

尺寸、圆角、悬停底色与焦点环沿用侧边栏自身的图标按钮：

- 展开态：28px，`--dsw-radius-sm`
- 轨道态：36px，`--dsw-radius-md`
- 悬停：`--dsw-alias-interactive-bg-hover`

## 安装

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

## 禁用与移除

设置 → 插件 → 找到“外观切换”并关闭，可立即恢复原生界面。

```
plugin_manager(action="remove_bundle", target="dsh-theme-toggle")
```
