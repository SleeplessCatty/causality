# P1-07 局部因果图基础展示设计

版本：V1.0
日期：2026-07-24
状态：已完成
所属路线图步骤：P1-07 局部因果图基础展示
前置步骤：P1-06 已完成用户验收并提交

## 1. 目标

在现有桌面端 Web 应用中新增“因果图”一级模块，使用户能够搜索一个原子事件作为中心，自动查询并展示初始 20 个关联节点的上游、下游或双向局部因果图。

P1-07 只交付清晰、稳定、可缩放和平移的基础图形页面。复杂节点和关系交互、详情查看、节点拖动固定、50/100 节点扩展及筛选继续由 P1-08 和 P1-09 实现。

## 2. 非目标

P1-07 不实现：

- 50 或 100 个关联节点扩展；
- 最低置信度和最低案例数筛选控件；
- 节点或关系选择、悬浮高亮和详情卡；
- 点击、双击或空格打开详情；
- 把节点设置为新的中心事件；
- 节点拖动和临时固定；
- 常驻的手动重新布局按钮，布局失败后的重试除外；
- 扩展时保留原有布局；
- 图坐标持久化；
- 移动端和平板适配；
- 全局因果图、时间轴或替代布局引擎。

## 3. 已确认原则

- 顶部新增一级导航“因果图”，路由为 `/graph`；
- 页面采用紧凑工具栏加全宽画布；
- 选择中心事件后自动生成默认双向图；
- 切换方向后自动重新查询和布局；
- 中心事件和方向写入 URL；
- 图始终按真实因果方向从左向右布局；
- 初始查询固定为 20 个非中心节点；
- 所有节点使用相同的 `220 × 96px` 圆角矩形；
- 名称完整显示，通过换行和 `14–9px` 动态字号适配；
- 所有关系始终显示紧凑标签，格式为 `80% · 6例`；
- 画布使用视口剩余空间，最小高度为 560px；
- 重新查询时保留旧图并覆盖加载状态；
- 孤立事件仍显示中心节点；
- 按钮和鼠标都支持缩放与平移；
- P1-07 节点不可拖动；
- React 直接管理 Cytoscape 实例，不引入 React 包装组件。

## 4. 信息架构与 URL

主导航调整为：

```text
事件 | 因果关系 | 具体案例 | 因果图 | 系统状态
```

已选图使用以下地址：

```text
/graph?centerEventId=<UUID>&direction=both
```

规则：

- `centerEventId` 和 `direction` 是唯一写入 URL 的图状态；
- 未确认的搜索输入不写入 URL；
- `direction` 只接受 `upstream`、`downstream`、`both`；
- 已有中心事件但方向缺失或无效时，使用 `both` 并替换为规范 URL；
- 非 UUID 的中心 ID 不发送请求，显示链接无效状态；
- 有效 UUID 对应的事件不存在时显示 404 状态并允许重新选择；
- 刷新、前进、后退和复制链接都恢复同一中心事件与方向。

## 5. 页面结构

页面保持现有 1280px 桌面内容区：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 局部因果图                              21 个节点 · 34 条关系       │
│ 从一个原子事件查看局部因果网络                                      │
├─────────────────────────────────────────────────────────────────────┤
│ [搜索中心事件……………………] [上游|下游|双向] [－][100%][＋][适应] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                         因果图画布                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

标题区右侧显示最终响应中的节点数和关系数，节点数包含中心事件。

工具栏使用白色轻边框容器，依次放置中心事件搜索、方向分段控件、缩小、当前缩放百分比、放大和适应画布。

画布宽度占满内容区，高度使用剩余视口空间，最小 560px。窗口高度不足时页面纵向滚动，不继续压缩画布。背景使用暖白色和极浅网格，与现有管理页面视觉一致。

## 6. 中心事件搜索与查询

中心事件搜索复用 `GET /api/events/candidates`：

- 输入停止 250ms 后查询；
- 空输入不请求；
- 最多显示 8 个候选；
- 候选只显示事件名称，不显示命中字段、匹配原因或分数；
- 支持鼠标、方向键、Enter 和 Escape；
- 搜索错误显示在控件附近，不清空已显示图。

图页面使用独立的 `GraphEventSelector`，不修改关系表单的 `EventSelector`，避免混合页面导航和表单校验职责。

选择候选后立即：

1. 把中心事件和 `direction=both` 写入 URL；
2. 查询事件详情以恢复输入框名称；
3. 请求局部图；
4. 转换为 Cytoscape 元素；
5. 运行 ELK；
6. 布局完成后适应画布。

方向切换直接更新 URL 并重新执行第 3–6 步，不增加“生成因果图”按钮。

P1-07 请求固定使用：

```text
limit=20
minConfidence=0
minCaseCount=0
```

## 7. 因果方向与 ELK 布局

图保留 API 返回关系的真实原因端和结果端，箭头由原因指向结果：

- `downstream`：中心事件位于左侧，结果向右展开；
- `upstream`：原因位于左侧，中心事件位于右侧；
- `both`：中心事件通常位于中部，上游在左、下游在右；
- 反向关系和循环不改变箭头方向，由布局和曲线样式处理。

初始 ELK 配置：

```ts
{
  name: 'elk',
  fit: false,
  animate: false,
  nodeDimensionsIncludeLabels: false,
  elk: {
    algorithm: 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '140',
  },
}
```

布局完成后调用一次 `fit`，内边距为 48px。布局本身不动画；旧图和加载覆盖层保留到新布局完成，避免看到节点跳动。

初始最多 21 个总节点，ELK 在主线程执行。P1-07 不增加 Web Worker。若 P1-09 的 100 节点测试证明主线程布局影响交互，再单独评估 Worker。

## 8. 节点设计

所有节点统一为 `220 × 96px` 圆角矩形。中心节点使用浅绿色背景、深绿色粗边框和略高字重；其他节点使用白底和中绿色细边框。节点使用轻微阴影，但不使用发光或渐变。

P1-07 不显示选中、悬浮或详情状态。节点不可抓取并保持锁定，拖动节点区域不会改变位置。

### 8.1 名称适配

`fitNodeLabel()` 在生成 Cytoscape 元素前处理名称，可用文字区域为 `196 × 72px`：

1. 使用 Canvas 2D 文本测量；
2. 依次尝试 14px、12px、10px、9px；
3. 中文按字符换行；
4. 英文优先按单词换行；
5. 单词超过行宽时按字符拆分；
6. 使用约 1.3 倍行高判断总高度；
7. 选择能完整容纳名称的最大字号；
8. 将换行文本和字号写入节点数据。

事件名称上限为 120 字符。固定节点和最低 9px 字号必须覆盖该边界，测试使用中文、英文、混合文本和无空格长文本验证。

## 9. 关系设计

每条关系始终显示：

```text
{confidence}% · {caseCount}例
```

例如 `80% · 6例`。

关系使用绿色系细线、结果端三角箭头和贝塞尔曲线。反向关系自动分向弯曲。标签位于线条中部，约 10px 字号，带半透明白色背景和少量内边距；在 25%–200% 的全部缩放范围内保持启用。

P1-07 不根据置信度改变线宽、颜色或透明度，避免同时编码过多含义。关系选择、高亮和详情由 P1-08 增加。

## 10. 缩放和平移

画布支持：

- 鼠标滚轮围绕指针位置缩放；
- 拖动画布空白处平移；
- 工具栏按钮缩小和放大；
- 点击“适应画布”显示全部元素。

缩放范围为 25%–200%。按钮每次按固定比例围绕画布中心调整，中间百分比实时反映 Cytoscape zoom；达到边界后对应按钮禁用。

“适应画布”只调整 zoom 和 pan，不重新运行 ELK，使用 48px 内边距。系统启用“减少动态效果”时取消 viewport 动画、画布淡入和遮罩过渡。

## 11. 页面状态

### 11.1 未选择中心事件

保留工具栏和画布。画布中央显示：

```text
搜索并选择一个中心事件
选择后将自动生成初始局部因果图
```

不显示创建事件按钮，事件创建继续在事件模块完成。

### 11.2 加载与重新查询

- 首次生成显示居中“正在生成因果图…”；
- 已有图时保留旧图并降低透明度；
- 覆盖“正在重新生成…”；
- API 和布局都完成后一次性替换；
- 旧查询通过 TanStack Query 的 AbortSignal 取消。

### 11.3 孤立事件

当前方向没有关系时，在画布中心显示唯一中心节点，并在底部提示“当前方向暂无关联事件”。方向切换和适应画布保持可用。

### 11.4 关系上限

`meta.stopReason = relation_limit` 时正常显示 API 返回的较小完整图，标题区增加“已按关系上限缩小”。该状态不是错误，不提供继续扩展。

### 11.5 请求错误

- 非 UUID：显示“链接中的中心事件无效”，不请求 API；
- 中心事件不存在：显示“中心事件不存在”和“重新选择”；
- 网络或服务错误：显示“无法加载因果图”和“重试”；
- 已有旧图时错误覆盖在旧图上，不清空旧图；
- 不显示堆栈、原始 Zod 错误或内部响应内容。

### 11.6 布局错误

API 成功但 ELK 失败时显示“无法生成布局”和“重新布局”。重新布局复用已有节点和关系，不重复请求 API。

## 12. 前端架构

新增：

```text
apps/web/src/features/causal-graph/
├── api/causalGraphApi.ts
├── components/CausalGraphToolbar.tsx
├── components/GraphEventSelector.tsx
├── components/CausalGraphCanvas.tsx
├── graph/createGraphElements.ts
├── graph/fitNodeLabel.ts
├── graph/graphLayoutOptions.ts
├── pages/CausalGraphPage.tsx
└── causalGraph.css
```

职责：

- `causalGraphApi`：构造参数、请求 P1-06 API、用共享 Schema 校验；
- `CausalGraphPage`：URL、React Query、旧图保留和页面状态；
- `CausalGraphToolbar`：搜索、方向和 viewport 按钮；
- `GraphEventSelector`：事件候选搜索和键盘选择；
- `CausalGraphCanvas`：Cytoscape 生命周期、元素替换、布局和 viewport；
- `createGraphElements`：把通用响应转换为 Cytoscape 元素；
- `fitNodeLabel`：无框架文字测量和字号选择；
- `graphLayoutOptions`：集中维护 ELK 配置；
- `causalGraph.css`：页面、工具栏、状态层和画布外观。

`CausalGraphCanvas` 只向父组件暴露：

```ts
interface CausalGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  retryLayout(): void;
}
```

页面和工具栏不访问原始 Cytoscape 实例。实例不进入 Context 或全局状态，组件卸载时必须调用 `destroy()`。

## 13. 技术依赖与加载策略

新增精确版本：

```text
cytoscape 3.34.0
cytoscape-elk 2.3.0
elkjs 0.12.0
```

不安装 `react-cytoscapejs` 或 `@types/cytoscape`。Cytoscape 自带类型声明，`cytoscape-elk` 直接注册扩展。

因果图页面采用路由级动态导入。Cytoscape、ELK 和页面代码形成独立构建 chunk；访问其他模块时不下载图形依赖。

版本和能力依据：

- [Cytoscape.js 官方文档](https://js.cytoscape.org/index.html)
- [cytoscape-elk 官方仓库](https://github.com/cytoscape/cytoscape.js-elk)
- [elkjs 官方仓库](https://github.com/kieler/elkjs)
- [Cytoscape 3.34.0 npm 页面](https://www.npmjs.com/package/cytoscape?activeTab=versions)
- [cytoscape-elk 2.3.0 npm 页面](https://www.npmjs.com/package/cytoscape-elk)
- [elkjs 0.12.0 npm 页面](https://www.npmjs.com/package/elkjs?activeTab=readme)

## 14. 无障碍边界

P1-07 保证：

- 搜索框使用 combobox/listbox 语义并支持键盘选择；
- 方向控件可通过键盘操作并暴露当前选择；
- 缩放和适应按钮有明确名称；
- 加载和错误使用适当的状态或警告语义；
- 图容器的可访问名称包含中心事件、节点数和关系数；
- 焦点样式与现有应用一致。

Cytoscape 使用 Canvas 渲染，P1-07 不实现逐节点和逐关系的键盘导航。完整图元素选择和空格打开详情属于 P1-08。

## 15. 自动化测试

### 15.1 API 与纯函数

- 正确构造中心事件、方向和固定筛选参数；
- 共享 Schema 拒绝错误响应；
- 生成中心节点标记、真实边方向和紧凑关系标签；
- 节点和关系顺序不被转换函数改变；
- 名称适配覆盖中文、英文、混合文本、长单词和 120 字符；
- 动态字号只产生 14、12、10、9px；
- 统一节点尺寸不随名称改变；
- ELK 配置为 layered 和 RIGHT。

### 15.2 React 组件

- 未选择中心事件；
- 候选延迟搜索和键盘选择；
- 选择后 URL 使用默认 `both`；
- 从 URL 恢复中心事件和方向；
- 无效方向规范为 `both`；
- 非 UUID 不发送图请求；
- 三种方向自动查询；
- 首次加载和保留旧图；
- 请求错误、重试、孤立节点和关系上限；
- Cytoscape 创建、销毁和节点锁定；
- zoom、pan、fit 及缩放边界；
- ELK 错误和重新布局；
- 减少动态效果。

Cytoscape 在组件测试中通过窄适配接口替换，测试生命周期和命令，不依赖 Happy DOM 的实际 Canvas 绘制。

### 15.3 Playwright

使用真实 API 和确定性测试数据验证：

1. 顶部导航进入 `/graph`；
2. 搜索并选择中心事件；
3. 自动生成双向 20 节点档位图；
4. URL 包含中心事件和方向；
5. 切换三种方向；
6. 刷新恢复同一图；
7. 画布报告布局完成；
8. 节点数和关系数与 API 一致；
9. 缩放、平移和适应画布有效；
10. 孤立事件状态；
11. 浏览器控制台无错误。

Canvas 内部文本不作为 DOM 定位器。图容器提供稳定测试属性：

```text
data-layout-state
data-node-count
data-relation-count
```

Playwright 在 1280×720 桌面视口保存页面截图，供人工视觉复核。

## 16. 人工复核

自动化门禁通过后检查：

1. 因果图导航与现有模块风格一致；
2. 页面为紧凑工具栏和全宽画布；
3. 搜索选择后立即生成；
4. 三种方向符合左因右果；
5. 节点全部同尺寸；
6. 长名称完整、字号可读；
7. 关系标签始终显示且不遮挡箭头；
8. 反向关系和循环曲线可区分；
9. 20 节点图没有明显节点或文字重叠；
10. 滚轮、按钮缩放、平移和适应画布流畅；
11. 切换方向时旧图不闪空白；
12. 孤立节点和错误状态符合设计；
13. 1280×720 下可用，矮窗口允许滚动；
14. 页面无控制台错误。

只有用户明确确认人工复核成功，P1-07 才标记为完成并进入 P1-08。

## 17. 预计文件

预计新增：

```text
apps/web/src/features/causal-graph/api/causalGraphApi.ts
apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx
apps/web/src/features/causal-graph/components/GraphEventSelector.tsx
apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx
apps/web/src/features/causal-graph/graph/createGraphElements.ts
apps/web/src/features/causal-graph/graph/fitNodeLabel.ts
apps/web/src/features/causal-graph/graph/graphLayoutOptions.ts
apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx
apps/web/src/features/causal-graph/causalGraph.css
apps/web/src/features/causal-graph/**/*.test.ts
apps/web/src/features/causal-graph/**/*.test.tsx
tests/e2e/causal-graph.spec.ts
```

预计修改：

```text
apps/web/package.json
pnpm-lock.yaml
apps/web/src/app/AppShell.tsx
apps/web/src/app/router.tsx
README.md
docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
```

P1-07 不修改共享 API 契约、后端服务、数据库 Schema 或迁移。

## 18. 审核重点

请重点确认：

1. 一级导航和 `/graph` 路由；
2. 选择与切换后自动生成；
3. URL 保存中心事件和方向；
4. 真实因果方向从左向右；
5. 固定 `220 × 96px` 节点和动态字号；
6. 始终显示 `80% · 6例` 关系标签；
7. 视口自适应、最小 560px 画布；
8. 重新查询保留旧图；
9. 孤立事件显示中心节点；
10. `25%–200%` 缩放范围；
11. P1-07 不提前实现 P1-08/P1-09 交互；
12. 直接封装 Cytoscape，不增加 React 包装依赖。

## 19. 实施与自动化验证记录

P1-07 已按确认设计完成前端实现，未修改共享 API 契约、后端服务或数据库结构。

已完成的自动化验证：

- Web 单元与组件测试：19 个测试文件、57 项测试通过；
- TypeScript 类型检查通过；
- Vite 生产构建通过，因果图页面和样式为独立懒加载 chunk；
- Playwright 真实浏览器测试通过：导航、候选选择、URL 恢复、三种方向、布局完成、节点/关系数量、缩放、平移、适应画布和孤立事件；
- 完整浏览器回归共 9 项全部通过，既有事件、关系、案例和系统状态页面未发生回归；
- 1280×720 页面截图已人工检查，无明显裁切、节点重叠或布局异常；
- 浏览器页面控制台无错误或产品代码警告。

用户已按第 16 节完成人工复核并确认通过。P1-07 正式完成，后续工作从 P1-08 设计阶段开始。
