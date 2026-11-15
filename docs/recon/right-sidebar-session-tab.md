# 右栏嵌入任意会话：tab type / resource / SessionReference 代码级契约

面向实现者的调研结论。所有结论都带 `文件:行号`；凡是本机无法证实的，集中在 §10「未核实与风险」里，不混进结论段。

**结论先行**：目标可行。`ctx.sessions.retain(<普通 sessionId 字符串>, { source })` 就是公开入口，**顶层会话不需要 parent/mode 地址**；tab body 用 `SessionProvider` 包一个自己命名的 session-scope child slot，里面渲染 `conversation.content` 工厂（`variant: "embedded"`）。与 ui-subagent 唯一的实质差异：普通会话不会被标成 subagent，所以不会出现"子代理只读 composer"，composer 是可用的（见 §7.4）。

---

## 0. 取证约定

### 0.1 引用别名

解包根：`.recon/asar/dsh/node_modules/@deepseek-ai/`（`asar` 内路径 `dsh/node_modules/@deepseek-ai/`）。下文用别名 `XX:行号`，别名对应 `@deepseek-ai/<包名>/lib/client.js`：

| 别名 | 包 | 用途 |
| --- | --- | --- |
| `SC` | `dsh-api-session-controller` | `ctx.sessions`（retain / list / binding） |
| `SR` | `dsh-client-ui-sidebar-right` | `ctx.sidebarRight`、`ctx.sidebarRightTabs`、tab 席位 |
| `SA` | `dsh-client-ui-subagent` | 唯一的现成参照实现（子代理进右栏） |
| `SE` | `dsh-client-ui-session` | `SessionProvider`、session scope 适配器、`useSession` |
| `RD` | `dsh-client-ui-renderer` | slot 装配、props 绑定、`ctx.slots` |
| `RS` | `dsh-client-resources` | `ctx.resources` 与 `useResource` |
| `CV` | `dsh-client-ui-conversation` | `conversation.content` 工厂、composer 链 |
| `WS` | `dsh-client-ui-workspace` | `ctx.uiWorkspace`、主视图 retain |
| `LY` | `dsh-client-ui-layout` | `usePanelInfo` |

另有两个非源码文件引用：
- `WEBBUNDLE:<byte>` = `@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js` 的单行压缩产物的**字节偏移**（`@deepseek-ai/dsh-client-ui-slots` 没有独立的包产物，本机构建里只有这个 bundle 含 `SlotCore`）。
- `README` = 对应包 `README.md`。

### 0.2 三件先知道的事（会影响你复核我的结论）

1. **asar 里没有任何 `.d.ts`。** `package.json` 的 `types` 字段和 `files` 都声明了 `lib/types/**/*.d.ts`（`SC` 包 `package.json`），但打包产物里 `.d.ts` 数量为 0（对 asar 全量文件清单 `grep -c '\.d\.ts$'` = 0）。所以本文的 TS 签名是**根据运行时实现 + README 反推的**，`lib/types/**/*.js` 只是被剥掉类型标注的实现副本，不是声明。
2. **之前团队用的解包偏移是错的（偏 4 字节）。** `baseOffset = 16 + readUInt32LE(8)` 会让每个文件丢掉开头 4 字节、尾部多 4 字节（`package.json` 因此无法 `JSON.parse`）。正确值：`baseOffset = 8 + readUInt32LE(4)`。验证方式：对同一 entry，前者取到 `"name": ...`、后者取到 `{"name": ...`。行号不受影响，但**内容开头会缺字**，复核代码时要注意。本文引用的包已用正确偏移重解到 `.recon/asar/`（含 `dsh-client-ui-sidebar-right`）。
3. `cordis_inspect_query` 的 client provider 本机连不上（`Service.listService` / `Slots.listSubTree` 均 `timed out after 10000ms`），所以本文全部结论来自静态源码 + 可离线执行的桩测试，没有任何一条来自运行时探查。

---

## 1. Q1 — 为任意顶层会话拿到 `SessionReference`

### 1.1 公开签名

```ts
// 反推自 SC:3842-3855 / SC:3007-3014 / SC:3745-3787
type SessionRetainTarget = string | SubagentAddress;
interface SubagentAddress {
  parentSessionId: string;
  childSessionId: string;
  mode: 'one-shot' | 'continuable' | 'unknown';
}
interface SessionRetainOptions {
  source: string;          // 保留来源标签，写进 list.byId[id].retainedBy
  signal?: AbortSignal;    // 取消"等待中"的一方；不取消别人共享的打开
}
interface SessionReference {
  readonly sessionId: string;
  readonly ready: Promise<SessionBinding>; // 打开结算后 resolve 到 binding；可 reject
  readonly binding: SessionBinding;        // getter：release/换代后 throw
  release(): void;                         // 幂等
  [Symbol.dispose](): void;
}
retain(target: SessionRetainTarget, options: SessionRetainOptions): SessionReference;
```

运行时实现（逐行）：

```js
// SC:3842
retain(target, options) {
  const { source, signal } = options;
  signal?.throwIfAborted();
  if (this.closed) throw new Error("Session Controller is disposed");
  const id = this.manager.resolveTarget(target);     // ← target 判定在这里
  const reference = this.retainScope(id, source);
  try {
    reference.attachOpening(this.manager.get(id).open(), signal);
    return reference;
  } catch (error) {
    reference.release();
    throw error;
  }
}
```

`README:79` 的官方措辞与此一致：「The target is a known Session id or a durable direct-parent subagent address」。

### 1.2 `target` 判定：字符串就是合法形态

```js
// SC:3007
resolveTarget(target) {
  const id = typeof target === "string" ? target : target.childSessionId;
  const address = typeof target === "string" ? this.subagentAddress(id) : target;
  if (typeof target === "string"
      && !this.sessions.has(id)                                  // 没有已装载实例
      && !this.summaries.some((summary) => summary.sessionId === id) // 也不在列表里
      && address === void 0) throw new Error(`sessions.retain: unknown session ${id}`);
  if (address !== void 0) this.addresses.set(id, address);
  this.sessions.get(id)?.configureSubagent(address, address === void 0 ? void 0 : this.agentAvailable(address.parentSessionId));
  return id;
}
```

关键点：`subagentAddress(id)` 对**普通会话返回 `undefined`**（`SC:3032-3033`：只有 `summary.origin === "subagent"` 且带 `parentSessionId` 才返回地址）。所以

- 顶层会话：`address === undefined` → 三个条件里 `address === void 0` 为真，但只要 id **在列表里**（`summaries`）或**已装载**，就通过；`configureSubagent(undefined, undefined)` 只是把 subagent 信息清空，无副作用。
- 子代理：字符串 id 会先被 `subagentAddress` 解析成地址，再装进会话（`SC:3011-3012`）。

**不要**给顶层会话伪造 `SubagentAddress`：地址一旦非空，历史路由会变成 subagent 形态（`SC:2923-2931`：`sessionAddress()` 在 `this.address !== undefined` 时返回 `{ kind: "subagent", ...address }`），而且会把地址记进 `addresses` 并触发 `configureSubagent` 重同步（`SC:2606-2612`）。

**前置条件**：id 必须"已知"。客户端会话列表是 Host 全量列表（`SC:3814-3819` 初始化 `{ ids: [], byId: {}, phase: "pending" }`，`SC:2979-2980` 的 `pending → ready` 边沿），只要该会话出现在列表里就能 retain；不在列表里会在 `resolveTarget` 抛 `sessions.retain: unknown session <id>`。从别的工作区拿来的旧 id，先 `ctx.sessions.refresh()`（`SC:3906-3908`）再 retain。

### 1.3 `SessionReference` 的真实形状与生命周期

`Reference` 就是 `ClientSessionReference`（`SC:3745-3787`）：

```js
var ClientSessionReference = class {
  sessionId; record; releaseReference;
  released = new AbortController();
  readiness = Promise.withResolvers();
  ready = this.readiness.promise;                      // SC:3751
  get binding() {                                      // SC:3758
    if (this.record === void 0 || !this.record.live) throw new Error(`Session reference "${id}" is released`);
    return this.record.binding;
  }
  attachOpening(opening, signal) { /* Promise.race(opening, abort) → readiness */ }  // SC:3762-3774
  release() {                                          // SC:3775-3783
    const release = this.releaseReference;
    this.released.abort(reason);
    this.readiness.reject(reason);
    this.record = void 0; this.releaseReference = void 0;
    release?.();
  }
  [Symbol.dispose]() { this.release(); }               // SC:3784-3786
};
```

- `retainScope` 记账（`SC:4059-4087`）：`retention.referenceCount + 1`、`retainedBy[source] + 1`；引用计数归零时 `retireScope` 释放该 generation（`SC:4081`）。所以**每次 retain 必须恰好 release 一次**，且同一 `source` 会被计数（同一 source 多次 retain 也正确配对）。
- `ready` 不需要 await 才能渲染：`SessionProvider` 读的是 `reference.binding`（§2.3），`ready` 只在你需要"首次历史打开已完成"时才有意义。`ready` 永远有人处理 rejection（`SC:3756` 里 `this.ready.catch(() => {})`），所以不 await 也不会 unhandled rejection。
- `binding` 是 getter，**不能缓存**（release 后抛错，`SC:3759`）。

### 1.4 与 subagent 路径的三处实质差异（决定 embedded UI 的样子）

| 维度 | 顶层会话 `retain(sessionId)` | 子代理 `retain(address)` |
| --- | --- | --- |
| 会话地址 | `address` 为 `undefined` → `sessionAddress()` 返回 `{kind:"session", sessionId}`（`SC:2923-2927`） | 地址非空 → `{kind:"subagent", parentSessionId, childSessionId, mode}`（`SC:2927-2930`） |
| 会话快照 `session.subagent` | `null`（`SC:2904`：`this.address === void 0 ? null : {...}`） | `{ address, parentAvailable? }`（`SC:2904-2910`） |
| 列表行 | 普通 retain **从不补目录行**（`README:81`：Ordinary Session retention never adds a catalog row） | 有已知地址时补一条 fallback 行并通知列表读者（`SC:4084`） |

第三条差异的后果就在 embedded UI 上：ui-subagent 的"只读 composer"选择器只认 `session.subagent`：

```js
// SA:944
function selectReadOnlySubagent(owner) {
  const subagent = owner.session?.subagent;
  if (subagent === void 0 || subagent === null) return null;   // ← 普通会话到此返回 null
  if (subagent.address.mode === "unknown") return { reason: "unknown" };
  if (subagent.address.mode === "one-shot") return { reason: "one-shot" };
  if (subagent.parentAvailable !== false) return null;
  return owner.session?.running === true ? null : { reason: "parent-unavailable" };
}
```

即：**嵌入普通会话时不会命中只读 composer**，拿到的是正常 composer（详见 §8.3）。

### 1.5 引用放在哪里活：resource 流持有（ui-subagent 同款）

参照实现把 reference 的生命周期挂在资源流上，而不是组件 effect：

```js
// SA:755
function subagentChatResourceProvider(sessions) {
  return {
    protocol: "subagentchat",
    async *open(resourceAddress, { signal }) {
      const address = parseSubagentChatAddress(resourceAddress);
      if (address === void 0) throw new Error(...);
      if (isAbortRequested(signal)) return;
      const reference = sessions.retain(address, { source: "sidebarChat", signal });   // SA:762
      try {
        yield { ok: true, value: { address, reference } };
        await waitForAbort(signal);          // SA:774
      } finally {
        reference.release();                 // SA:776
      }
    }
  };
}
```

**不要**改成在组件的 `useEffect` 里 retain/release：`ctx.resources` 的 holder 计数（`RS:109-118`）已经承担了"何时开/何时停"，而 tab 自身还额外 `pin` 住这个地址（§1.6），组件卸载不等于 tab 关闭。两套生命周期混写会导致重复 retain 或提前 release。

### 1.6 谁在保活：pin + useResource 双持有

- `TabDomain.sync` 在每个 occurrence 第一次同步时 `this.pin(occurrence.navigation.getSnapshot().address, occurrence.signal)`（`SR:1928-1930`），注入的正是 `ctx.resources.pin`（`SR:4940-4942`）。因此**只要 tab 记录还在 layout 里**，资源就不停（即使用户切走面板、收起侧栏）。
- body 挂载后 `useResource(address)` 又订阅一次 → `hold`（`RS:86-99`）。
- tab 关闭 / 该会话 layout 清空 / 插件卸载 → occurrence signal abort（`SR:1916-1918`）→ provider 的 `finally` 释放 reference。

结论：`reference` 的生命周期 = tab occurrence 的生命周期，与 body 的挂载/卸载无关。

### 1.7 其它"拿 reference"的公开途径（都不需要）

| API | 语义 | 能否替代 retain |
| --- | --- | --- |
| `sessions.using(target, options, op)`（`SC:3856-3864`） | retain + await `ready` + 回调 + finally release | 不能：回调期结束即释放，不能交给 UI 长期持有 |
| `sessions.binding(id)`（`SC:4056-4058`） | 只借用已存在的 generation，返回 `SessionBinding \| undefined` | 不能：不会新建 generation，也没引用计数保护 |
| `sessions.retainInfo(id)`（`SC:3865-3885`） | 只观察 `{referenceCount, retainedBy}` | 不能：只读元数据 |
| `ctx.uiWorkspace.openSession(id)`（`WS:1471-1473` → `WS:1652-1675`） | 主视图导航；内部 `this.sessions.retain(target, { source: "mainView" })` | 不能：它保留给主视图（`mainView` 是 ui-session 认定"当前会话"的依据，`SE:917`），副作用是切换主列 |

**结论：右栏自己的引用必须自己 retain，`source` 用自己的名字**（例如 `"sessionAside"`）。这也解释了为什么 `retainedBy` 里能同时看到 `mainView` 和你的来源（`SC:4157`）。

---

## 2. Q2 — slot 组件能拿到哪些 props，谁给的

### 2.1 装配点

`standardKit(host, entry, scope, rootBinding, scopeBinding)`（`RD:736-767`）就是"props 出厂单"：

```js
function standardKit(host, entry, scope, rootBinding, scopeBinding) {
  const standard = standardProps(scope, rootBinding, scopeBinding);   // RD:737  ← 标准席位
  const kit = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) };  // RD:738-741
  if (entry.locale !== void 0) kit["t"] = localeSeat(host.locale, entry.locale);  // RD:742-746
  const store = host.storeOf(entry, scopedStoreBinding);
  if (store !== void 0) { kit["useStore"] = observableHook(store); kit["actions"] = store.actions; } // RD:747-752
  if (entry.children !== void 0) {
    kit["renderSlot"] = boundRenderSlot(host, entry);                 // RD:754
    if (任一 child kind === "chain") kit["renderSlotChain"] = ...;     // RD:755
    if (任一 child scope !== "root") {
      const adapter = host.scope("session");
      kit["SessionProvider"] = scopeAreaProvider(adapter);            // RD:756-760
    }
  }
  return { kit, standard, actions: store?.actions };
}
```

渲染时最终 props 的合并顺序（后者覆盖前者，`RD:784-790`）：

```
{ ...kit, ...injected(entry.inject), ...slotInjected.props(声明级 inject), ...contextual(声明级 hook 工厂), ...ownerProps }
```

### 2.2 你点名的那几个 props 的来源

| prop | 谁提供 | 依据 |
| --- | --- | --- |
| `renderFactorySlot(name, input, options?)` | 渲染器，每个 entry 必有 | `RD:740`，实现在 `RD:322-334` |
| `renderSlot(key, owner)` | 渲染器，**仅当本 entry 声明了 `children`** | `RD:753-755`，实现在 `RD:342-360`（未声明的 key 会抛 `SlotOwnershipError`，`RD:347-349`） |
| `SessionProvider` | 渲染器，**仅当某个 child 的 `scope !== "root"`** | `RD:756-760` → `RD:705-723` |
| `useSession` | `ui-session` 的 session scope 源（`hooks: ["session"]`） | `SE:755-764`，绑定见 `RD:667-702` |
| `useSessions` | `ui-session` 的 **root** hook（`ctx.sessions.list` 本身） | `SE:1104-1108` |
| `useConversation` / `useInput` / `inputActions` | `ui-conversation` 向 `uiSession.provide` 注册的 session scope 源 | `CV:19912-19928` |
| `useResource` | `dsh-client-resources` 的 **root keyed hook** | `RS:176`：`keyedHooks: { resource: (address) => resources.source(address) }` |
| `useTabInfo` | **席位声明级 inject**（不是 root hook） | `SR:5046-5050`（`inject: { hooks: { tabInfo: tabInfoFactory } }`），工厂 `SR:4856`，slot 级装配 `RD:1135` + `RD:491-498` |
| `t` | 渲染器，注册时声明 `locale` 才有 | `RD:742-746`（缺 locale face 会抛，`RD:744`） |

### 2.3 `SessionProvider` 的契约（Q1 收尾要用）

```js
// RD:705
function scopeAreaProvider(adapter) {
  return function ScopeAreaProvider(props) {
    const inherited = useScopeBinding();
    const explicit = Object.hasOwn(props, "session");
    const source = adapter.bindingSource(props.session);
    const resolved = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
    const binding = explicit ? resolved : inherited;
    return <ScopeBindingProvider binding={binding}>{adapter.renderArea(binding, props)}</ScopeBindingProvider>;
  };
}
```

适配器来自 `ui-session`（`SE:802-806`，安装点 `SE:1114` `ctx.slots.installScope("session", service.adapter)`），其中：

```js
// SE:837
bindingSource(reference) {
  if (!this.active) return this.absent;
  if (reference === void 0) return this.absent;
  const owner = reference.binding;                                       // ← 读 getter，release 后 throw
  if (this.sessions.binding(reference.sessionId) !== owner)
    throw new Error("ui-session: Session reference is not active in this Controller");
  return this.sourceFor(owner);
}
```

要点：
- 传 reference 即可，**不需要 `ready`**；但**必须是当前 Controller generation 的 reference**（换代会抛，`SE:841`）。
- 渲染区只是"有 binding 就渲染 children，没有就 `empty()`"（`SE:715-718`）；`empty` 是可选项。
- 子树的 scope key 就是 `binding.key` = sessionId（`SE:1024-1030`），所以 `SessionProvider` 里再渲染 session-scope slot，拿到的 `sessionId`/`useSession` 都是被嵌入会话。

### 2.4 hook 命名规则

`standardHookPropName(name) = 'use' + name[0].toUpperCase() + name.slice(1)`（`WEBBUNDLE:484826`）。因此声明 `hooks: { session }` → `useSession`，`keyedHooks: { resource }` → `useResource`，`hooks: { tabInfo }` → `useTabInfo`。

### 2.5 root 级标准席位全集（截至本机包集）

| 来源 | 内容 |
| --- | --- |
| `SE:1104-1113` | `useSessions`、`useSessionStatus`；keyed `useSessionRetainInfo`、`useSessionAccess` |
| `WS:5040-5043` | `useWorkspaces`；keyed `useWorkspaceAccess` |
| `RS:176` | keyed `useResource` |
| `LY:621` | `usePanelInfo` |

重复的 root 名会抛 `duplicate root standard ...`（`RD:1804-1812`），所以插件**不要**用 `ctx.slots.provideRoot` 添加与上表重名的 hook。

---

## 3. Q3 — `ctx.resources.register(provider)` 契约

### 3.1 provider 契约

```ts
interface ResourceProvider<Value> {
  readonly protocol: string;   // = dsh-resource://<host> 的 host，小写
  open(address: string, options: { signal: AbortSignal }): AsyncIterable<ResourceFrame<Value>>;
}
type ResourceFrame<Value> = { ok: true; value: Value } | { ok: false; error: unknown };
```

- `protocol` 的比较键来自地址解析：`protocolOf(address)` 取 `new URL(address).hostname.toLowerCase()`，且 scheme 必须是 `dsh-resource:`，否则视为"没有 provider"（`RS:16-25`）。
- 重复 protocol 直接抛：`resources: protocol "x" already has a provider`（`RS:45`）。
- `register` 走 `ctx.effect`，返回 disposer；provider 到来时**已持有**的记录会立刻重新开始，离开时停止并置 `none`（`RS:46-57`，`RS:120-131`）。
- `open` 的调用点是 `consume`（`RS:145-159`）：`for await (const frame of stream)`，`ok:true` → `{status:"live", value}`，`ok:false` → `{status:"failed", value: 上一次的 value, failure: error}`。**流内抛异常不会被捕获**（`RS:144` 注释：a throw inside the stream is left to surface），所以"用户可达的失败"要靠 `{ok:false}` 帧，别靠 throw。

### 3.2 释放语义（引用计数）

```js
// RS:109
hold(record)    { record.holders += 1; if (record.holders === 1) this.start(record); }
release(record) { record.holders -= 1; if (record.holders > 0) return;
                  this.stop(record);                       // abort signal
                  record.store.set(idle(...)); }           // RS:113-118
```

- 每个 `source(address)` 的订阅者持有一个 holder（`RS:86-99`：subscribe 时 hold，退订时 release）。
- `pin(address, signal)` 是第二条持有来源，abort 时 release（`RS:58-65`）。
- holder 归零 → `stop()` abort `AbortController` → provider 的 `signal` 触发 → 你的 `finally` 释放 reference。

### 3.3 `useResource(contentId)` 返回结构

```ts
interface ResourceSnapshot<Value> {
  status: 'none' | 'loading' | 'live' | 'failed';
  value: Value | undefined;
  failure: unknown;
}
```

初始值 `idle(provider 存在 ? "loading" : "none")`（`RS:77-79`、`RS:26-32`）。调用形态是 **keyed hook**：`useResource(address)` 用第一个字符串参数当 key（`RD:245-287`），selector 可选。tab body 里的标准用法是 `useResource(tab.contentId)`（`SA:802`）。

---

## 4. Q4 — `ctx.sidebarRightTabs.register(definition)`

### 4.1 声明形状

```ts
interface SidebarRightTabTypeDefinition {
  id: string;                 // 实现身份，全局唯一；也是 body/title 席位的 key
  kind: string;               // tab 判别式；决定 registry 的"占位"
  patterns?: string[];        // 资源类型才有；页面类型不写
  priority?: 'extension' | 'builtin' | 'fallback';   // 字符串 band，默认 extension
  canOpen?(address: string): boolean;
  title(address: string): string;
  guide?: { id: string; kind: string; order: number; title(): string; description?: string; icon?: ... }[];
  keepMounted?: boolean;
  multiple?: boolean;
}
register(definition): () => void;
```

### 4.2 运行时校验（逐条）

```js
// SR:4580
register(definition) {
  const { id, kind } = definition;
  const entries = definition.guide ?? [];
  if (new Set(entries.map(e => e.id)).size !== entries.length)
      throw new Error(`sidebarRight: duplicate guide entry id in "${id}"`);            // SR:4583
  const band = definition.priority ?? DEFAULT_BAND;                                     // SR:4584（默认 "extension"，SR:4515）
  if (this.ids.has(id)) throw new Error(`sidebarRight: tab type id "${id}" is already registered`); // SR:4585
  const held = this.kinds.get(kind);
  if (held !== void 0 && !coexists(held, band))
      throw new Error(`sidebarRight: tab kind "${kind}" is already registered (${held.inForce.band})`); // SR:4587
  ...
  const dispose = this.ctx.effect(() => { /* ids.add / enter(kind) */ }, ...);           // SR:4598-4607
  return dispose;
}
```

- **id 唯一**：全局 `ids` Set，第二次注册抛（`SR:4585`）。同一个 id 卸载后可重注册（effect 里删除，`SR:4603`）。
- **kind 冲突**：`coexists(slot, band)` 只允许 `extension` 和 `builtin` 配对一次，且要求当前没有 shadowed；`fallback` 与任何同 kind 都不共存（`SR:4520-4522`）。band 排名 `extension:3 > builtin:2 > fallback:1`（`SR:4509-4513`），高 band 顶掉低 band，低 band 退到 `shadowed`，高 band 卸载后低 band 复职（`SR:4613-4637`）。
- **priority 取值**：`'extension' | 'builtin' | 'fallback'` 三个字符串字面量。**注意区分**：这是 tab-type 的 **band（字符串）**；slot 注册里的 `priority` 是**数字**（`RD:1606-1610` 原样透传，`WEBBUNDLE:487229` 里默认 0）。两者同名不同轴。
- **外部插件选哪个 band**：默认 `extension` 就是给"来自产品之外的 type"的（`README:85`：`extension`（a type from outside the product, the highest, and the default when none is named））。ui-subagent 用 `builtin` 是因为它属于产品内（`SA:823`）。**因此新 kind 用 `extension`**；只有当你确实要接管某个 builtin 的 kind 时才用 `extension` 去 shadow 它。

### 4.3 `patterns` 匹配规则

```js
// SR:4536
function matcherFor(pattern) {
  const whole = pattern.includes(":");
  const match = matchGlob(pattern, { nocase: true, dot: true, ...(whole ? {} : { basename: true }) });
  return (address) => {
    if (whole) return match(address);                      // 含 ":" → 匹配整条地址
    const path = pathOf(address);                          // 否则匹配 URL.pathname，任意深度、忽略大小写
    return path !== void 0 && match(path);
  };
}
```

- 含 `:` 的 pattern → picomatch 直接跑整条地址（大小写不敏感、`.` 匹配）；不含 `:` → 跑 `new URL(address).pathname`；不是 URI 的地址永远匹配不到（`SR:4524-4534`）。
- 排序规则（`SR:4672-4688`）：band 降序 → **命中的 pattern 长度**降序 → 注册顺序升序；`canOpen` 否决者剔除（`SR:4678`）。
- **点名 kind 时跳过 glob**，但仍执行 `canOpen`（`SR:4703-4711`）。

### 4.4 标题在哪捕获

`claim()` 在打开那一刻调用 `definition.title(address)` 并存进 tab 记录：

```js
// SR:4702
claim(address, kind) {
  if (kind !== void 0) {
    const definition = this.get(kind);
    if (definition === void 0) throw new Error(`sidebarRight: no tab type is registered as "${kind}"`);
    if (definition.canOpen !== void 0 && !definition.canOpen(address)) throw new Error(`sidebarRight: tab type "${kind}" refuses "${address}"`);
    return { kind, contentId: address, title: definition.title(address) };      // SR:4707-4711
  }
  const [chosen] = this.candidates(address);
  if (chosen === void 0) throw new Error(`sidebarRight: no registered tab type claims "${address}"`);
  return { kind: chosen.kind, contentId: address, title: chosen.title(address) }; // SR:4715-4719
}
```

tab 记录就三个业务字段 + id：`{ id, kind, contentId, title }`（zod 校验 `SR:788-793`；写入路径 `SR:1115-1161`，`title` 在 `SR:1148` 进入布局规划）。chip 上显示的是 `tab.title`（`SR:1442` 作为 title 席位的 fallback）；想要"标题跟着会话改名走"，需要额外注册 `sidebar.right.pane.tab.title`（`SR:5051-5055`，`key` 同样等于 definition id），否则**标题在打开时固定**（`README:147`）。

### 4.5 打开入口

```js
ctx.sidebarRight.openResource(address, { kind?, params?, paneId?, replaceTab?, revealIfOpened?, preferNewPane? }); // SR:2234
ctx.sidebarRight.openTab(kind, { ...同上 });                                                                        // SR:2243
```

- 两者都先 `require()`：`mounted` 为空（主列被全局面板占据 / 没选会话）时抛 `sidebarRight: no session surface is mounted`（`SR:2594-2601`）。
- `openResource` 要求地址以 `dsh-resource://` 开头，否则抛 `no registered tab type claims`（`SR:2294`）。
- `preferNewPane` 只在"目标 pane 是 dock、非空、未到两栏上限、当前屏幕就是这个会话、宽度够"时生效（`SR:2313`），否则回退到该 pane。
- 已存在同 `(kind, contentId)` 的 tab 时默认聚焦它（`revealIfOpened: false` 可关掉；普通页面 tab 永远去重）（`SR:1123-1125`，`SR:2333`）。
- `multiple: true` 的 type 每次打开生成不同 contentId（`SR:2301`）。

---

## 5. Q5 — `sidebar.right.pane.tab` 席位契约

### 5.1 声明与 key

声明在右栏 seat 里（`SR:5042-5060`）：

```js
yield ctx.slots.register({
  name: "rightbar.session",
  locale: NS,
  children: {
    "sidebar.right.pane.tab":       { kind: "keyed",   scope: "session", inject: { hooks: { tabInfo: tabInfoFactory } } },  // SR:5046-5050
    "sidebar.right.pane.tab.title": { kind: "keyed",   scope: "session", inject: { hooks: { tabInfo: tabInfoFactory } } },  // SR:5051-5055
    "sidebar.right.tab.menu.item":  { kind: "list",    scope: "session" }                                                    // SR:5056-5059
  },
  store,
  inject: (sessionId) => ({ ...injected, measureRoom, closeTab, keyedHooks: { tabNavigation }, occurrence })
}, RightbarSeat);
```

（该块是节选：`injected`/`measureRoom`/`closeTab`/`tabNavigation`/`occurrence` 都是 `inject` 返回的其它面，与本次结论无关；原文见 `SR:5042-5077`。）

渲染（`SR:1399-1403`）：

```js
const content = renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext });
```

`kind: "keyed"` 的 slot 注册**必须给 `key`**（否则核心抛 `keyed slot "<name>" requires options.key`，`WEBBUNDLE:487229`），而这里的 `entryKey` 就是 `definition.id`。**结论：`key` 必须等于 tab type 的 `id`**（不是 kind；kind 只在 `definition` 找不到时兜底）。ui-subagent 的写法即 `key: SUBAGENT_CHAT_ID`（`SA:832`）。

### 5.2 body 的 props

`useTabInfo()`（`SR:4856-4893`）返回：

```js
{
  sidebar: { expanded, fullscreen },
  panel: { id: pane.id },
  tab: { ...tab, visible, navigation, signal, actions, refreshShortcut }
}
```

`tab` 展开后是 `{ id, kind, contentId, title, visible, navigation:{address, params, revision}, signal, actions, refreshShortcut }`。`navigation` 是打开时记录的地址与参数（`SR:2324-2327`）；`signal` 是该 occurrence 的生命周期（关 tab / 清 layout / 插件卸载时 abort，`SR:1916-1918`）；`actions` 是绑定到本会话的动作集合（`SR:1378-1398` 的 `tabActions`）。

注意 `useTabInfo()` 在"记录还没提交"时会抛（`SR:4864`）；body 只在已提交的 tab 上渲染，正常不会撞到。

### 5.3 body 的注册写法 + 自定义 child slot（你的 `sessionaside.conversation`）

```js
// 步骤 1：在 pane.tab 的 key 上注册 body，并声明自己的 child slot
ctx.slots.inject("sidebar.right.pane.tab", () =>
  ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: TYPE_ID,                       // 必须 === definition.id（SR:1399-1403）
    children: { "sessionaside.conversation": { kind: "single", scope: "session" } }
  }, Body));

// 步骤 2：等声明落地，再注册那个 child 的组件（scope: session 的 entry）
ctx.slots.inject("sessionaside.conversation", () =>
  ctx.slots.register({ name: "sessionaside.conversation" }, ConversationBody));
```

为什么必须包 `ctx.slots.inject`：核心要求 slot **已被父级 `children` 表声明**，否则 `slot "<name>" is not declared (a parent entry's children table must declare it)`（`WEBBUNDLE:487229`）。而 `sidebar.right.pane.tab` 由右栏自己的 seat 声明（`SR:5046`），boot 顺序不确定，所以要等声明。ui-subagent 用的是同一套两步（`SA:830-838`），右栏自己注册 guide body 也是（`SR:5101`）。

`kind` / `scope` 的可用值（声明侧）：
- `kind`: `"single" | "keyed" | "list" | "chain"`（`single`/`keyed`/`list` 的冲突校验见 `WEBBUNDLE:487229`；`chain` 要求注册时给 `select`）。
- `scope`: `"root" | "session" | "session-maybe"`；`inline: true` 让 outlet 用 `<span>` 而不是 `<div>`（`RD:1117-1128`）。
- 声明级 `inject` 可以是 `{ hooks: { name: factory } }`（工厂收 `(standard, hookContext)`，`RD:491-498`）或 `{ hooks: { name: source } }`。

**取名安全**：用你自己的前缀（本例 `sessionaside.conversation`）就与 ui-subagent 的 `sidebar.chat.conversation`（`SA:833`）互不干扰。另注意 `single` slot 在同一 priority 只允许一个 entry（核心冲突检查），同名不会被静默覆盖，会抛错。

### 5.4 席位别名（可选）

`sidebar.right.pane.tab.title` 与 body 同构（`key` = definition id），用于实时标题（`SR:5051-5055`、`SR:1436-1443`）；`sidebar.right.tab.menu.item` 是 `list`，往 tab 右键菜单追加项（`SR:5056-5059`、`SR:1548`）。

---

## 6. Q6 — 右栏之外拿"当前会话"和"会话列表"

### 6.1 会话列表（权威数据）

`ctx.sessions.list` 是 snapshot store（`SC:3814-3819`），`getSnapshot()` 形状：

```ts
interface SessionListSnapshot {
  ids: string[];
  byId: Record<string, SessionListRow>;
  phase: 'pending' | 'ready';                                  // SC:2979-2980, SC:3610
  projectionsBySession: Record<string, { values: Record<string, unknown> }>;  // 各域投影值
}
interface SessionListRow {
  id: string;
  displayTitle: string;        // 展示名（title 优先，其次目录名/id）  SC:4155
  running: boolean;            // SC:4156
  retainedBy: Record<string, number>;   // 各来源引用计数  SC:4157
  blank: boolean;              // 空会话（没开始过 turn）  SC:4158
  updatedAt: number;           // SC:4159
  formatStatus?: string;       // 会话格式/迁移状态  SC:4160（来源 summary.formatStatus, SC:3634）
  projectionValues?: Record<string, unknown>;  // 含 title / subagent.label 等  SC:4161
  title?: string;              // 显式标题（有才出现）  SC:4162
  cwd?: string;                // SC:4163
  parentId?: string;           // 子代理的父 id  SC:4164
  origin?: string;             // "subagent" 等  SC:4165
}
```

**没有行级 `label` 字段**。子代理的标签在 `byId[id].projectionValues.subagent.label`（ui-subagent 就是这么取标题的，`SA:827`）。

组件里用 root hook：`useSessions((s) => ...)`（`SE:1104-1108`）。

### 6.2 当前选中的会话 id

按可靠性排序，两种公开路径：

1. **`ctx.sidebarRight.mounted`**（`SR:2183-2184`、`SR:2217`）：`ObservableSource<string | undefined>`，快照就是"主列正在显示的那个会话 id"，全局面板占据主列时为 `undefined`（`README:96` 的 `ISidebarRight.mounted`）。赋值点在 `SR:4952-4958`（`layout.panelInfo.activePanelId === null ? selected?.sessionId : void 0`）。
2. **`retainedBy.mainView`**：`Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id`。这是产品内部判定"当前会话"的统一手法（`WS:866-867`、`SE:917`、`WS:3028`），数据本身就是公开的 `retainedBy`。

`ctx.uiWorkspace` 不直接提供"当前会话 id"的公开 getter；它的 `selection` 是实例字段（`WS:1369`，持久化名 `dsh.sessions.current`），由 `replaceMain` 写入 `{ sessionId, subagentAddress? }`（`WS:1663-1666`）。要用就用上面两种，别依赖 `selection`。

### 6.3 工作区分组（如果需要）

`ctx.workspaces.list.getSnapshot()` = `{ items, archivedSessionIds, pinnedSessionIds, state, phase, error }`（`SC` 之外的 `dsh-api-workspace-controller/lib/client.js:259-268`），`items[]` 带 `workspaceId`、`title`、`path`、`sessionIds`、`createdAt`（用法见 `WS:1419-1424`、`WS:1700-1702`）。组件里用 `useWorkspaces`（`WS:5040-5043`）。

---

## 7. Q7 — `conversation.content` 工厂

### 7.1 工厂声明

```js
// CV:19936
const registerConversationContent = () => slots.registerFactory({
  name: "conversation.content",
  scope: "session-maybe",
  locale: NS,
  children: {
    "conversation.session":        { kind: "single", scope: "session" },
    "conversation.composer":       { kind: "chain",  scope: "session" },   // CV:19945-19948
    "conversation.composer.bar":   { kind: "single", scope: "session-maybe" },
    "conversation.input.dock":     { kind: "list",   scope: "session" },
    "conversation.hero.brand.mark":{ kind: "single", scope: "root" },
    ...
  },
  slots: {
    views: { scope: "session" },              // CV:19974-19977 ← 本地 slot
    widthControls: { scope: "root" }
  },
  inject: (sessionId) => ({ hooks: { composerBlock }, selectWorkspace })
}, ConversationContent);
```

### 7.2 调用参数

```js
renderFactorySlot("conversation.content",
  { variant: "main" | "embedded", phase: "settling" | "hero" | "active", hero: boolean },
  { slots: { views: <Component> }, fallback });
```

- 主列自己的调用：`{ variant: "main", phase, hero }`，`phase` 由 `settling ? "settling" : hero ? "hero" : "active"` 得出（`CV:17605-17619`）。
- 右栏参照实现：`{ variant: "embedded", phase, hero }` + `slots.views` 固定成 chat（`SA:786-798`）。
- `variant` 只影响一个 class（`CV:17929` `props.variant === "embedded" && ...embeddedBody`）；`phase` 写到 `data-content-phase`（`CV:17933`）；`hero` 决定是否渲染 HeroShell + workspace chip，以及 composer 用 hero 版还是普通版（`CV:17884-17910`）。
- `phase` 只影响样式，不影响数据。

### 7.3 `slots.views` 覆盖方式

`renderFactorySlot` 的第三参 `options.slots` 是**本地 slot 选择表**（`RD:322-334` → `FactoryOutlet`；工厂侧读法 `useFactorySlot(name, fallback)`，`RD:892-942`）。本地 slot 必须在工厂 `slots` 里声明（`CV:19974-19977`），未声明会抛 `local slot 'x' is not declared by factory 'y'`（`RD:897`）。

`views` 的默认实现是 `ConversationSessionView`（`CV:17795-17797`：`renderSlot("conversation.session", {})`）；参照实现换成：

```js
function FixedChatConversationView(props) {
  return props.renderSlot("conversation.session", { view: "chat" });   // SA:782-784
}
```

`view` 参数被 `ConversationSession` → `DefaultConversationViews` 消费：`const viewId = view ?? active?.id`，再用 `{ only: viewId }` 过滤 `conversation.view` 的 list 席位（`CV:18032-18040`）。所以传 `"chat"` = 锁死聊天视图（不走 trajectory 等视图）。

### 7.4 目标会话正在运行时

- body 照常渲染：`ConversationContent` 总是渲染 `Views` + composer 座位（`CV:17934-17942`），`session.running` 只是快照字段，不改变结构。
- composer 是否可用：`inert = sessionId === void 0 || hero && chipTitle === void 0`（`CV:17884`），其余情况 composer 都是可交互的。真正会把 composer 换成只读/禁用块的只有 `conversation.composer` 这条 **chain** 上的 entry（`CV:17911-17919`，`renderSlotChain(..., { fallback: composerBar, overlay: true })`）。产品里唯一这么干的是 ui-subagent，且只在 `session.subagent` 成立时命中（`SA:944-951`、`SA:990-995`）。
- 因此：**嵌入普通顶层会话 → composer 可交互**（可以在右栏直接发消息）。
- 嵌入的会话若正在运行，chat 视图会实时更新（同一 `SessionBinding`，见 §2.3），不需要额外处理。

**限制（重要）**：没法"只在右栏里禁用 composer"。`conversation.composer` 是全局 chain，选举只看 `select(ownerProps)`，而 `ownerProps` 只有 `{ sessionId, session, pendingInteraction }`（`CV:17911-17915`）——里面没有"我是在右栏还是主列"的信息。所以任何以会话属性为条件的只读处理都会同时作用于主列（ui-subagent 的只读 composer 在主列打开子代理时同样生效，`SA:964-967` 的 `openChild` 就是切主列）。如果产品要"右栏只读"，只能在产品层另做（例如另一种渲染，而不是共用 `conversation.content`），这不是本次 recon 能给出的照抄方案。

**另一个产品级注意点**：同一个会话同时出现在主列和右栏时，两个 composer 共用同一个输入壳——`InputHub.shells` 是按 `SessionBinding` 的 WeakMap（`CV:15779`、`CV:15811-15813`），draft 只有一份。要避免"右栏截图被人看到半截草稿"之类的体验问题，得靠产品决策（例如默认不嵌入当前主列会话）。

---

## 8. 参考实现

两份产物（ESM JS 实现 + TS 声明）都已通过 `node --check` 与桩测试，见 §9；代码即正文，可直接复制成 `client.js` / `.d.ts`。

### 8.1 包骨架

参照本仓已装的 `dsh-session-motion`（服务端一半只做占位，让 Host 扫到 `dsh.client`）：

```jsonc
// package.json
{
  "name": "dsh-session-aside",
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-resources", "@deepseek-ai/dsh-api-session-controller"] }
  }
}
```

- `client.js` 的注册 id **必须等于包名**：`dsh-session-motion/client.js:2-5` 的注释写明 "the registration id must equal the package name so the boot graph row and this factory line up"；`dsh-client-modules/README.md` 也说 manifest 的包名就是浏览器模块的身份（`<id>/client` 与 bare id 解析到同一 exports）。
- `dsh.client.inject` 是"本 bundle 之前必须先加载的客户端包"清单：Host 半边把它编进启动图并保证 providers 先于 consumers（`dsh-client-modules/README.md`），浏览器半边只做字符串数组校验并原样带入行（`@deepseek-ai/dsh-client-modules/lib/client.js:66`、`:127-139`）。**服务依赖是另一回事**，写在插件对象的 `inject` 数组里（对照 `SA:936-942`）。
- Host 一半（`index.js`）只需要 `export function apply() {}`（`dsh-session-motion/index.js`）。

### 8.2 客户端实现（可直接落地）

```js
/**
 * 浏览器一半：右栏"会话"tab。id 必须等于包名。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-aside',
  factory(require) {
    const React = require('react');

    const PLUGIN_ID = 'dsh-session-aside';
    const ROW_NAME = 'session-aside';
    const TYPE_ID = PLUGIN_ID;                    // tab type id，同时是 body 席位 key
    const KIND = 'sessionaside';
    const PROTOCOL = 'sessionaside';
    const SOURCE = 'sessionAside';                // retainedBy 里的来源名
    const ADDRESS_PREFIX = 'dsh-resource://' + PROTOCOL + '/session/';
    const CONVERSATION_SLOT = 'sessionaside.conversation';
    const NS = 'sessionAside';

    const zh = { 'title': '会话', 'loading': '正在打开会话…', 'failed': '无法打开这个会话' };
    const en = { 'title': 'Session', 'loading': 'Opening session…', 'failed': 'This session could not be opened' };

    const h = React.createElement;
    const ROOT_STYLE = { display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 };
    const NOTICE_STYLE = { padding: '12px 16px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' };

    function sessionAddress(sessionId) {
      return ADDRESS_PREFIX + encodeURIComponent(sessionId);
    }

    function parseSessionAddress(value) {
      let url;
      try { url = new URL(value); } catch (_invalidUrl) { return undefined; }
      if (url.protocol !== 'dsh-resource:') return undefined;
      if (url.hostname.toLowerCase() !== PROTOCOL) return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'session') return undefined;
      try { return decodeURIComponent(parts[1]); } catch (_invalidEncoding) { return undefined; }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
    }

    /** 资源拥有者：每个地址一个保留中的 Session generation。 */
    function sessionChatResourceProvider(sessions) {
      return {
        protocol: PROTOCOL,
        async *open(resourceAddress, { signal }) {
          const sessionId = parseSessionAddress(resourceAddress);
          if (sessionId === undefined) {
            throw new Error('session-aside: invalid chat resource address "' + resourceAddress + '"');
          }
          if (signal.aborted) return;
          let reference;
          try {
            reference = sessions.retain(sessionId, { source: SOURCE, signal });   // ← 顶层会话路径
          } catch (error) {
            yield { ok: false, error };                                           // 会话已删除等用户可见失败
            return;
          }
          try {
            yield { ok: true, value: { sessionId, reference } };
            await waitForAbort(signal);
          } finally {
            reference.release();
          }
        }
      };
    }

    function FixedChatConversationView(props) {
      return props.renderSlot('conversation.session', { view: 'chat' });
    }

    /** session scope：渲染被 SessionProvider 绑定的那个会话的 Conversation。 */
    function SessionChatConversation(props) {
      const session = props.useSession((value) => value);
      const conversation = props.useConversation((value) => value);
      const summaryBlank = props.useSessions((state) => state.byId[props.sessionId]?.blank);
      const shellPhase = conversation.activeTargets.size > 0
          || (!session.blank && !session.awaitingFirstTurn)
          || session.running
        ? 'active'
        : session.promptAttempted ? 'engaging' : 'blank';
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return props.renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: settling ? 'settling' : hero ? 'hero' : 'active',
        hero
      }, { slots: { views: FixedChatConversationView } });
    }

    /** tab body：外层 session 是右栏自己的会话；SessionProvider 把子树重绑到被嵌会话。 */
    function SessionChatTab(props) {
      const tab = props.useTabInfo().tab;
      const resource = props.useResource(tab.contentId);
      const t = props.t;
      if (resource.value === undefined) {
        return h('div', { 'data-session-aside': '', 'data-status': resource.status, style: NOTICE_STYLE },
          t(resource.status === 'failed' ? 'failed' : 'loading'));
      }
      return h('div', { 'data-session-aside': '', style: ROOT_STYLE },
        h(props.SessionProvider, { session: resource.value.reference },
          props.renderSlot(CONVERSATION_SLOT, {})));
    }

    function registerSessionAside(ctx, t) {
      ctx.effect(() => ctx.resources.register(sessionChatResourceProvider(ctx.sessions)),
        ROW_NAME + ': resource provider');
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TYPE_ID,
        kind: KIND,
        patterns: [ADDRESS_PREFIX + '**'],
        priority: 'extension',
        canOpen: (address) => parseSessionAddress(address) !== undefined,
        title: (address) => {
          const sessionId = parseSessionAddress(address);
          if (sessionId === undefined) return t('title');
          return ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? sessionId;
        }
      }), ROW_NAME + ': tab type');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TYPE_ID,
        locale: NS,
        children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } }
      }, SessionChatTab)), ROW_NAME + ': tab body');
      ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register(
        { name: CONVERSATION_SLOT }, SessionChatConversation)), ROW_NAME + ': conversation body');
    }

    return {
      name: ROW_NAME,
      inject: ['sessions', 'resources', 'slots', 'sidebarRightTabs', 'sidebarRight', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), ROW_NAME + ': dictionaries');
        registerSessionAside(ctx, ctx.locale.bind(NS));
      }
    };
  }
});
```

触发打开（任意有 `sidebarRight` 的客户端插件 / 本插件自己的按钮）：

```js
ctx.sidebarRight.openResource('dsh-resource://sessionaside/session/' + encodeURIComponent(sessionId), {
  kind: 'sessionaside',     // 点名 kind，跳过 glob 但仍走 canOpen
  preferNewPane: true       // 宽度够且当前 pane 非空时拆新栏，否则落在当前 pane
});                          // 要求当前有 mounted 会话，否则抛错（SR:2594-2601）
```

### 8.3 TypeScript 声明（可直接落进 `.d.ts`）

```ts
// ── ctx.sessions（@deepseek-ai/dsh-api-session-controller，SC:3745-4243） ──
export interface SubagentAddress {
  parentSessionId: string;
  childSessionId: string;
  mode: 'one-shot' | 'continuable' | 'unknown';
}
export type SessionRetainTarget = string | SubagentAddress;
export interface SessionRetainOptions { source: string; signal?: AbortSignal }

export interface SessionBinding {
  sessionId: string;
  session: SessionObject;
  eventSource: unknown;
  ctx: unknown;
}
export interface SessionReference {
  readonly sessionId: string;
  readonly ready: Promise<SessionBinding>;   // 可能 reject；不 await 也安全（SC:3756）
  readonly binding: SessionBinding;          // getter：release 后 throw（SC:3759）
  release(): void;
  [Symbol.dispose](): void;
}
export interface SessionListRow {
  id: string;
  displayTitle: string;
  running: boolean;
  retainedBy: Record<string, number>;
  blank: boolean;
  updatedAt: number;
  formatStatus?: string;
  projectionValues?: Record<string, unknown>;
  title?: string;
  cwd?: string;
  parentId?: string;
  origin?: string;
}
export interface SessionListSnapshot {
  ids: string[];
  byId: Record<string, SessionListRow>;
  phase: 'pending' | 'ready';
  projectionsBySession: Record<string, { values: Record<string, unknown> }>;
}
export interface ObservableSource<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export interface ClientSessions {
  readonly list: ObservableSource<SessionListSnapshot>;
  readonly searchResultLimit: number;
  retain(target: SessionRetainTarget, options: SessionRetainOptions): SessionReference;
  using<T>(target: SessionRetainTarget, options: SessionRetainOptions,
          operation: (reference: SessionReference) => T | Promise<T>): Promise<T>;
  binding(id: string): SessionBinding | undefined;
  subagentAddress(id: string): SubagentAddress | undefined;
  retainInfo(id: string): ObservableSource<{ referenceCount: number; retainedBy: Record<string, number> }>;
}

// ── ctx.resources（@deepseek-ai/dsh-client-resources，RS:16-159） ──
export type ResourceFrame<Value> = { ok: true; value: Value } | { ok: false; error: unknown };
export interface ResourceProvider<Value> {
  readonly protocol: string;                                     // dsh-resource:// 的 host，小写
  open(address: string, options: { signal: AbortSignal }): AsyncIterable<ResourceFrame<Value>>;
}
export interface ResourceSnapshot<Value> {
  status: 'none' | 'loading' | 'live' | 'failed';
  value: Value | undefined;
  failure: unknown;
}
export interface ClientResources {
  register<Value>(provider: ResourceProvider<Value>): () => void;
  pin(address: string, signal: AbortSignal): void;
  source<Value>(address: string): ObservableSource<ResourceSnapshot<Value>>;
}

// ── ctx.sidebarRightTabs / ctx.sidebarRight（SR:2178-2601, SR:4555-4740） ──
export type TabPriorityBand = 'extension' | 'builtin' | 'fallback';
export interface SidebarRightTabTypeDefinition {
  id: string;                        // 全局唯一；同时是 body/title 席位的 key
  kind: string;
  patterns?: string[];               // 含 ':' 匹配整条地址，否则匹配 pathname
  priority?: TabPriorityBand;        // 默认 'extension'
  canOpen?(address: string): boolean;
  title(address: string): string;    // 打开时即被捕获
  keepMounted?: boolean;
  multiple?: boolean;
  guide?: { id: string; kind: string; order: number; title(): string; description?: string }[];
}
export interface SidebarRightTabRecord { id: string; kind: string; contentId: string; title: string }
export interface SidebarRightOpenOptions {
  kind?: string;
  params?: Record<string, unknown>;
  paneId?: string;
  replaceTab?: string;
  revealIfOpened?: boolean;
  preferNewPane?: boolean;
}
export interface SidebarRightTabTypeRegistry {
  register(definition: SidebarRightTabTypeDefinition): () => void;
  get(kind: string): SidebarRightTabTypeDefinition | undefined;
  candidates(address: string): SidebarRightTabTypeDefinition[];
  claim(address: string, kind?: string): { kind: string; contentId: string; title: string };
}
export interface ClientSidebarRight {
  readonly mounted: ObservableSource<string | undefined>;
  openResource(address: string, options?: SidebarRightOpenOptions): void;
  openTab(kind: string, options?: SidebarRightOpenOptions): void;
  close(tabId: string): void;
  active(): SidebarRightTabRecord | undefined;
  isExpanded(): boolean;
  toggleExpanded(): void;
  focus(tabId: string): void;
  split(paneId?: string): string | undefined;
  float(tabId: string, rect?: { x: number; y: number; width: number; height: number }): void;
  dock(paneId: string): void;
  tabsIn(sessionId: string): SidebarRightTabRecord[];
  registerCloseHandler(kind: string, handler: (sessionId: string, tab: SidebarRightTabRecord) => void): () => void;
}

// ── pane.tab 席位的 props（RD:736-767 + SR:4856-4893） ──
export interface SidebarRightTabInfo {
  sidebar: { expanded: boolean; fullscreen: boolean };
  panel: { id: string };
  tab: SidebarRightTabRecord & {
    visible: boolean;
    navigation: { address: string; params?: Record<string, unknown>; revision: number };
    signal: AbortSignal;
    actions: Record<string, unknown>;
    refreshShortcut?: { id: string };
  };
}
export type SelectorHook<T> = <U = T>(selector?: (value: T) => U) => U;
export type KeyedSelectorHook<T> = <U = T>(key: string, selector?: (value: T) => U) => U;

export interface TabBodyProps<ResourceValue> {
  useSessions: SelectorHook<SessionListSnapshot>;          // root hook（SE:1104-1108）
  useResource: KeyedSelectorHook<ResourceSnapshot<ResourceValue>>;   // root keyed hook（RS:176）
  sessionId: string;                                       // session scope prop（SE:755-764）
  useSession: SelectorHook<SessionObject>;
  useConversation: SelectorHook<ConversationSnapshot>;
  useTabInfo(): SidebarRightTabInfo;                        // 席位声明级 inject（SR:5046-5050）
  SessionProvider: (props: { session: SessionReference; empty?: () => unknown; children?: unknown }) => unknown;
  renderSlot(key: string, owner?: Record<string, unknown>): unknown;
  t(key: string, params?: Record<string, unknown>): string;
}

export interface SessionObject {
  sessionId: string;
  running: boolean;
  blank: boolean;
  promptAttempted: boolean;
  awaitingFirstTurn: boolean;
  openState: 'cold' | 'loading' | 'open' | 'error';
  subagent: { address: SubagentAddress; parentAvailable?: boolean } | null;   // 普通会话恒为 null（SC:2904）
}
export interface ConversationSnapshot { activeTargets: ReadonlySet<string> }

// ── conversation.content 工厂（CV:19936-19998 / CV:17806-17942） ──
export type ConversationContentVariant = 'main' | 'embedded';
export type ConversationContentPhase = 'settling' | 'hero' | 'active';
export interface ConversationContentInput {
  variant: ConversationContentVariant;
  phase: ConversationContentPhase;
  hero: boolean;
}
export interface ConversationContentSelection {
  slots?: { views?: (props: { renderSlot(key: string, owner?: Record<string, unknown>): unknown }) => unknown };
  fallback?: unknown;
}
```

> 说明：这些声明按 §0.2 第 1 条由运行时反推——成员名、边界、默认值都能对上源码行；但**如果官方以后补 `.d.ts`，以官方为准**，尤其是 `SessionObject`（本文只列了参考代码读到的字段）与 `tab.actions`（真实类型是绑定到本会话的一整套布局动作，`SR:1378-1398`）。

### 8.4 这类实现要接受的三个事实

1. 嵌入普通会话时 composer 是可用的（§7.4），不能只对右栏禁用。
2. 同一会话主列 + 右栏并存时共享同一份 draft（§7.4 末）。
3. 右栏是**按会话**存的（`dsh.sidebar-right.v1.<sessionId>`，`SR:761`、`SR:846-886`），所以"A 会话的右栏里嵌入 B 会话"会被记在 A 的布局下，切到别的会话看不到——这是产品语义，不是 bug。

---

## 9. 验收记录

验收用的临时文件（`dsh-session-aside.client.js`、`contracts.ts`、桩测试 `smoke.cjs`）在上表跑完后已按临时文件协议删除；正文 §8.2 / §8.3 是它们的内容，逐字可重放。复核方式：

```bash
# 把 §8.2 的代码存成 dsh-session-aside.client.js
node --check dsh-session-aside.client.js          # 语法
# 把 §8.3 的代码存成 contracts.ts
node --check contracts.ts                          # Node 24 直接剥离类型
```

| 检查 | 结果 |
| --- | --- |
| `node --check dsh-session-aside.client.js` | 通过 |
| `node --check contracts.ts`（Node 24.18，类型剥离） | 通过 |
| 桩测试 `smoke.cjs`（stub `window.__ModuleLoader__` + stub `require('react')` + fake `ctx`） | `registrations OK` / `provider happy path OK` / `provider failure frame OK` / `provider address guard OK` / `tab body OK` / `conversation body OK` |

桩测试实际断言的东西（对应上文的运行时契约）：
- 注册出的 definition：`id/kind/priority/patterns` 与 `canOpen` 对 `dsh-resource://sessionaside/session/<id>` 为真、对 `dsh-resource://file/...` 为假；`title` 命中列表用 `displayTitle`、未命中回退 id（`SC:4155`）。
- 两个 slot 注册的 options 与 `children` 声明形状（`SR:1399-1403`、`WEBBUNDLE:487229`）。
- provider：正常帧 → `{ok:true,value:{sessionId,reference}}`；`signal.abort()` 后流结束且 `reference.release()` 恰好调用一次（对应 `RS:109-118` 与 `SA:774-777`）；`retain` 抛错时给 `{ok:false,error}` 帧而不是抛（对应 `RS:144-159`）；畸形地址抛（对应 `SA:720`）。
- tab body：`resource.value === undefined` 时只渲染状态壳；有值时 `SessionProvider` 收到 `session.reference` 且 child slot key 正确。
- conversation body：`renderFactorySlot` 收到 `{ variant:'embedded', phase:'active', hero:false }`，`options.slots.views` 是函数且调用后产出 `renderSlot('conversation.session', { view:'chat' })`。

---

## 10. 未核实与风险

按"会影响实现决策"排序。这些没有一条被证伪，只是本机没有证据：

1. **`priority` band 三个字面量的类型声明在哪个包。** 运行时只校验字符串进 `RANKS`（`SR:4509-4513`），没有 per-band 的 `throw`；`README:85` 说 band 是字符串字面量以便跨包无需 import。传错值（例如 `"Extension"`）会得到 `RANKS[band] === undefined` → 排序时 `NaN` 比较，行为未定义。**用字面量，别拼字符串。**
2. **slot 核心（`@deepseek-ai/dsh-client-ui-slots`）不在 asar 里**，只能从 web bundle 读压缩代码（`WEBBUNDLE:484826/485321/487229/490198`）。我读到的规则（声明必须先于注册、keyed 必须有 key、同 priority 冲突抛错、entry 按 priority 升序、`entriesOfSlot` 按 cell 去重）与你从产品包里看到的调用方式完全自洽（`SA:819-838`、`SR:5101-5126`），但**没有类型签名可引**。
3. **`ctx.slots.register` 的完整 options 类型**（`label`、`order`、`select`、`store`、`registrant`、`inline`）只从实现里读到字段搬运（`WEBBUNDLE:487229`），`label` 的语义（`resolveSlotLabel`）没有找到使用点。
4. **`ctx.reflect.provide` 是否是对外推荐的 service 暴露方式**：`SC:3840`、`RS:172`、`LY:622` 都在用，但 Cordis 侧是否有更规范的 `ctx.provide`/service 声明未核实。若你只想"暴露一个打开函数"，也可以由调用方直接 `openResource`（§8.2），不依赖服务。
5. **`session.subagent` 之外的只读成因**：除 ui-subagent 的 chain 之外，是否还有别的插件注册 `conversation.composer`（本次只解了 15 个包）。若产品里还有别的只读来源，嵌入普通会话时也可能被命中；上线前用 `ctx.slots.entries('conversation.composer')` 现场确认一次。
6. **client `cordis_inspect` 不可用**（本机 10s 超时两次）。所有运行时形状都来自源码，没有实测校验；建议实现完成后在浏览器里再核对一次 `ctx.slots.snapshot('sidebar.right.pane.tab')` 的 occupants。

---

## 11. 复现步骤（含解包修正）

```js
// 用法：node asar.mjs extract <app.asar> <outRoot> [路径子串过滤...]
import fs from 'node:fs';
import path from 'node:path';
const [mode, asarPath, out, ...filters] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);
const jsonSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString('utf8'));
const baseOffset = 8 + buf.readUInt32LE(4);        // ← 不是 16 + readUInt32LE(8)
const files = [];
(function walk(entry, prefix) {
  for (const [name, child] of Object.entries(entry.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (child.files) walk(child, p); else files.push([p, child]);
  }
})(header, '');
for (const [p, entry] of files) {
  if (filters.length && !filters.some((f) => p.includes(f))) continue;
  const dest = path.join(out, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const start = baseOffset + Number(entry.offset);
  fs.writeFileSync(dest, buf.subarray(start, start + Number(entry.size)));
}
```

- 校验方式：对同一 entry 比较两个候选 base，`8 + readUInt32LE(4)` 处正好是 `{"name": ...`，另一个候选从 `"name"` 开始（少了 `{`）。
- `SlotCore` 在本机构建里唯一出现的地方是 `@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js`（单行压缩）；检索用 `indexOf` 取字节偏移，别指望行号。
