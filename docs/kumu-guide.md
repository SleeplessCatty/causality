# Kumu 功能与用法指南

> 调研日期：2026-07-19。本文只引用 Kumu 官方网站和官方文档。

## 结论

Kumu 是一个通用的关系网络与系统地图平台。它的强项是：用灵活的元素、连接、字段和视图组织结构化网络数据，再通过筛选、聚焦、布局、装饰规则和交互式演示，把复杂系统讲清楚。

对本项目而言，Kumu 很适合快速制作“抽象事件 → 抽象因果关系”的专业网络原型，也可以在连接 Profile 中保存证据摘要和引用。但是，它没有 Causal Map 那样面向原文的因果编码流程，也不会自动把多条具体证据聚合成一条抽象关系并计算证据来源数。具体事件、具体因果证据、关系聚合与置信度必须自行设计字段、表格和计算流程。

[Kumu 官方概览](https://docs.kumu.io/about-kumu/how-does-it-work)说明，Kumu 是一个支持团队协作的 Web 网络可视化平台，可以手工建图，也可以从电子表格导入数据。

## 一、Kumu 的核心数据模型

Kumu 的层级可以概括为：

```text
Workspace
└── Project
    ├── Master data：Elements / Connections / Loops / Fields
    ├── Maps：选择哪些对象进入地图，并保存位置
    ├── Views：筛选、样式、布局和交互规则
    └── Presentations：用于讲解和发布的幻灯片
```

官方对其架构的定义见 [Kumu's architecture](https://docs.kumu.io/overview/kumus-architecture)。

### 1. Workspace

Workspace 是项目容器和计费单位。

- Basic Workspace 由单个用户管理。
- Pro Workspace 可以提供更多团队、品牌、备份和权限功能。
- 一个 Workspace 可以拥有多个公开或私有 Project。

### 2. Project

Project 是最高层的数据容器，保存：

- Elements
- Connections
- Loops
- Fields
- Maps
- Views
- Presentations
- 项目隐私设置、成员、许可和扩展

Project 中有一份主数据。不同 Map 或 View 引用的是同一批对象，而不是复制品。因此，在某张 Map 中修改一个 Element 的名称或字段，该修改会影响项目中所有引用该 Element 的 Map。[官方架构说明](https://docs.kumu.io/overview/kumus-architecture)

### 3. Element

Element 是地图上的节点，可以表示：

- 一个因素
- 一个人或组织
- 一个概念
- 一个抽象事件
- 一个步骤或状态

在系统图中，Element 通常表示“系统中的因素或变量”。在本项目中，可将其用于表示抽象原子事件。

### 4. Connection

Connection 是两个 Element 之间的边，可以是：

- Directed：单向箭头
- Undirected：无方向
- Mutual：双向箭头

因果关系应使用 Directed，并让 From 指向原因、To 指向结果。方向也会参与 Kumu 的网络指标计算。[字段与方向说明](https://docs.kumu.io/guides/fields)

Connection 自身也是完整对象，可以拥有 ID、Label、Type、Description、Tags 和自定义 Fields。因此可以在一条边上记录强度、证据、来源链接、时间延迟和审核状态。

### 5. Loop

Loop 是由两条或更多 Connection 组成的一组关系，通常用于表示：

- 因果回路
- 子系统
- 一段流程
- 一个关系群组

Loop 有自己的 Label、Profile、Description、Type、Tags 和字段，也能被装饰。Kumu 可以自动检测回路，但大型高连接度地图可能产生数千个候选回路；Google Sheets 连接地图暂不支持自动回路检测。Loop 只能通过 JSON 完整导出，不能随 XLSX 导出。[Loops 官方指南](https://docs.kumu.io/guides/what-are-loops)

## 二、Map 和 View 的区别

这是使用 Kumu 时最重要的概念之一。

### Map 决定“有哪些对象、放在哪里”

一张 Map 保存：

- 使用哪些 Elements、Connections 和 Loops
- 节点坐标
- Loop 标签位置
- 默认 View
- 默认节点行为：固定或浮动
- 默认连接方向
- Map Overview 说明

一个 Project 可以建立多张 Map。例如：

- 全局因果图
- 用户流失子图
- 供应链风险子图

它们可以引用 Project 主数据中的同一个 Element。

### View 决定“如何看这批对象”

View 是一套数据驱动的显示和交互规则，主要包含：

- Decorations：颜色、大小、形状、线宽等
- Filters：隐藏不符合条件的数据
- Focus：从某个节点向外展开
- Showcase：突出一组对象、淡化其他对象
- Layout settings：布局设置
- Controls：交互控件
- Cluster / Bridge 等派生连接规则

一个 View 可以应用到多张 Map，同一张 Map 也能切换多个 View。例如：

- “证据强度”View：按证据数调整边宽
- “审核状态”View：按状态着色
- “只看高置信关系”View：筛掉弱关系
- “时间阶段”View：按年份或阶段筛选

[Views 官方指南](https://docs.kumu.io/guides/views)说明，View 只改变可见内容和表现方式，不需要修改基础数据。

## 三、Profile、Fields、Type 和 Tags

### Profile

每个 Element、Connection 和 Loop 都有一个 Profile。点击对象后，侧栏显示其 Profile，用户可以编辑字段、添加叙述或引用资料。[Profiles 官方指南](https://docs.kumu.io/guides/profiles)

默认字段包括：

- Label
- Type
- Description
- Tags
- Image

还可以创建任意数量的自定义字段。

### Label

Label 是对象显示名称。Element 通常需要 Label，Connection 不强制要求 Label。

对于抽象事件，建议使用：

```text
主体 + 单一状态变化
```

例如：

- 订阅价格上涨
- 用户取消订阅
- 服务器磁盘空间耗尽
- 数据库停止写入

### Type

Type 表示互斥分类，一个对象只能有一个 Type。例如：

```text
Element Type = Abstract Event
Connection Type = Causal Relation
```

在系统模板中，Connection Type 还能表达 same/opposite 或 `++`、`+-`、`-+`、`--` 等极性。[Systems mapping 官方指南](https://docs.kumu.io/disciplines/system-mapping)

### Tags

Tags 是多值字段，适合非互斥标记，例如：

```text
verified | review | financial | customer-behavior
```

Type 与 Tags 的区别：

| 字段 | 值的数量 | 推荐用途                           |
| ---- | -------: | ---------------------------------- |
| Type |     单值 | 对象主要类别或关系极性             |
| Tags |     多值 | 主题、审核状态、数据来源、补充分类 |

### Description

Description 适合保存长文本，支持 Markdown、多个段落及多媒体内容。对于因果图，可以保存：

- 抽象事件定义
- 因果机制说明
- 纳入和排除条件
- 证据摘要
- 资料链接

### Custom Fields

自定义 Field 可以设置数据类型、输入提示、分类、顺序、适用对象和隐私显示。可用于货币、数字、清单、日期或其他结构化数据。[Fields 官方指南](https://docs.kumu.io/guides/fields)

需要注意：标记为 private 的 Field 只是对普通查看者隐藏 Profile 展示；数据仍可能被发送到浏览器以支持 View 和 Decoration。官方明确提示，有访问地图权限的人在技术上仍可能取得这些字段。因此，机密数据不应只依靠 Field 的“隐藏”开关保护。

## 四、手工建立一张因果图

### 第一步：创建 Project

在 Dashboard 创建 Project：

1. 输入项目名称。
2. 选择公开或私有。
3. 选择 Systems 或 Causal Loop 模板。
4. 创建第一张 Map。

Systems 模板适合更自由的系统图；Causal Loop 模板更强调极性和反馈回路。

### 第二步：添加 Element

点击底部绿色 `+`，选择 Add element，输入名称并确认。快捷键为 `E`。

也可以开启 Sketch Mode：

- 按 `K` 进入。
- 点击画布创建 Element。
- 从已有 Element 拖出 Connection。
- 按 `Esc` 退出。

如果地图少于约 50 个 Element，Kumu 官方的系统图指南认为手工构建通常较方便；更大数据可考虑电子表格导入。[Systems mapping](https://docs.kumu.io/disciplines/system-mapping)

### 第三步：添加 Connection

点击绿色 `+` → Add connection，或按 `C`，依次选择原因和结果。

例如：

```text
From：订阅价格上涨
To：用户购买意愿下降
Direction：directed
Type：opposite
```

如果箭头方向错误，可以选中 Connection 后 Reverse。也可以批量选择 Connection，统一设置 Directed、Undirected 或 Mutual。[箭头设置说明](https://docs.kumu.io/frequently-asked-questions/how-do-i-add-arrows-to-my-connections)

### 第四步：补充 Profile

为 Element 建议填写：

- Description：事件定义
- Tags：主题或状态
- Atomicity status：是否通过原子性审核
- Inclusion criteria：纳入条件
- Exclusion criteria：排除条件

为 Connection 建议填写：

- Description：因果机制与摘要
- Evidence count：证据数量
- Independent source count：独立来源数
- Confidence：人工或模型置信度
- Evidence URL：证据库链接
- Review status：审核状态
- Polarity：same/opposite
- Delay：时间延迟说明

### 第五步：添加 Loop

点击绿色 `+` → Add loop，或按 `L`：

1. 点击属于该回路的 Connections。
2. 输入 Loop Label。
3. 用 `R` 表示 reinforcing，用 `B` 表示 balancing。

例如：

```text
R1：价格—流失—收入压力回路
B1：故障—修复投入—故障率回路
```

点击 Loop 标签即可在 Profile 中说明当前行为、历史变化和支持资料。官方建议把叙述与证据加入 Loop Profile，而不是只留下一个无法解释的图形。[Systems mapping](https://docs.kumu.io/disciplines/system-mapping)

## 五、因果回路图和系统图的表达方法

### 1. 方向

因果关系使用箭头：

```text
原因 → 结果
```

### 2. 极性

Kumu 支持用 Connection Type 表达关系极性：

- `same`：原因增加时结果增加，原因减少时结果也减少。
- `opposite`：原因增加时结果减少，或原因减少时结果增加。
- `++`：两端均标 `+`。
- `--`：两端均标 `-`。
- `+-` / `-+`：在两端显示对应符号。

在 Systems 模板中，same 通常显示实线，opposite 通常显示虚线。还可以使用 `Prelabel` 和 `Postlabel` 自定义边两端标签。[系统图极性说明](https://docs.kumu.io/disciplines/system-mapping)

极性不是“这条关系好或坏”，而是两个变量变化方向是否一致。例如：

```text
服务故障率 --opposite→ 用户满意度
营销投入 --same→ 品牌曝光
```

### 3. 时间延迟

如果原因发生后，结果不会立刻出现，可以为 Connection 添加两条平行短线作为 delay marking。选中边，在 Profile 底部点击 Delay 图标即可。[系统图官方指南](https://docs.kumu.io/disciplines/system-mapping)

### 4. Reinforcing 与 Balancing

- Reinforcing loop：变化会被循环继续放大，可能表现为持续增长或持续衰退。
- Balancing loop：循环产生抵消或稳定作用，把系统拉回某个范围。

Kumu 不会替用户判断某个回路是 R 还是 B。常用做法是人工分析极性，然后在 Loop Label 中写 `R:` 或 `B:`。

### 5. 自动回路检测

操作方法：

1. 先建立有方向的 Elements 和 Connections。
2. 点击 Add loop。
3. 选择 Detect loops automatically。
4. 悬停候选回路查看其范围。
5. 给需要保留的回路命名；未命名的候选不会保存。

候选按照连接长度从短到长排列。密集网络中回路数会迅速膨胀，应先 Filter 出一个子系统再检测。[Loops 官方指南](https://docs.kumu.io/guides/what-are-loops)

## 六、View：筛选、聚焦和呈现

### Filter

Filter 会暂时隐藏匹配或不匹配条件的对象，不删除数据。典型用途：

- 只显示 `Review status = verified` 的关系。
- 隐藏 `Evidence count < 3` 的连接。
- 只显示某一时间段或主题。
- 排除具体证据节点，只展示抽象网络。

可以用 Basic Editor 的条件构建器，也可用 Advanced Editor 的 selector。Filter Controls 使用 AND 逻辑；多个控件同时应用时，结果必须满足所有条件。[Filter control](https://docs.kumu.io/guides/controls/filter-control)

### Focus

Focus 从一个或多个对象出发，只保留一定“度数”范围内的邻居：

- 点击并长按对象，或选择对象后点击 Focus。
- `+` / `-` 扩大或缩小范围。
- 数字键直接指定度数。
- `Esc` 恢复完整地图。

Advanced Editor 还能指定方向：

- `in`：只显示进入焦点的关系。
- `out`：只显示从焦点发出的关系。
- `all`：显示全部相邻关系。

这非常适合查看某个事件的上游原因和下游后果。[Focus 官方指南](https://docs.kumu.io/guides/focus)

### Showcase

Showcase 不完全隐藏其他数据，而是突出目标对象、淡化背景，适合讲故事和保持上下文。

### Selectors

Selector 是 Kumu 的高级选择语言，可以按照以下条件选择对象：

- Type
- Label 或 ID
- Tag
- 自定义字段值
- 数值比较
- From / To 方向
- 是否属于某个 Loop
- 是否为孤立节点

Selector 可用于搜索、Filter、Focus、Decoration、Cluster、Bridge 和 Controls。[Selectors 官方指南](https://docs.kumu.io/guides/selectors)

## 七、Decorations：把字段转化成视觉信息

Decoration 控制 Element、Connection 和 Loop 的：

- 颜色
- 大小
- 形状
- 边框和阴影
- 标签
- Connection 粗细、颜色、曲率

有两类 Decoration：

1. Direct decoration：直接修改少量指定对象。
2. Data-driven decoration：根据 Profile 字段自动应用规则。

对于会持续增加数据的项目，应优先用 Data-driven decoration。例如：

```text
所有 verified 关系显示深色
Evidence count 越大，Connection 越粗
Confidence 越高，Connection 越不透明
Abstract Event 显示为圆形
Concrete Evidence 显示为小方块
```

Basic Editor 提供 Size by、Color by、Shape by 和 Decoration Builder；Advanced Editor 可写更精确的选择和样式规则。[Data-driven decorations](https://docs.kumu.io/guides/decorate/data-driven-decorations)

Decoration 使用级联顺序，后创建或后声明的规则会覆盖前面的规则；Direct decoration 又会覆盖数据驱动规则。遇到样式“不生效”时，应优先检查规则顺序和是否存在 Direct decoration。

## 八、布局功能

Kumu 支持多类布局，包括：

- Fixed：人工固定位置。
- Force-directed：根据网络关系自动布局。
- Scatter plot：由字段值决定 X/Y 位置。
- Geo：按地理位置展示。

[Layouts 官方说明](https://docs.kumu.io/guides/layouts)

### Fixed

适合：

- 因果回路图
- 需要严格阅读顺序的演示图
- 需要手工控制箭头和标签的系统图

Systems 模板通常使用固定位置，这样可以拖动边中部调整曲率。

### Force-directed

Force-directed 使用三类力：

- Gravity：把对象拉向中心。
- Particle charge：让节点互相排斥。
- Connection force：把相连节点拉近。

可以选择 auto、dense、hairball 预设，或在 Advanced Editor 中调节 gravity、particle charge、connection length 和 strength。节点可以 Pin 住以覆盖自动位置。[Force-directed 官方指南](https://docs.kumu.io/guides/layouts/force-directed)

它适合探索结构，但自动布局的位置本身不代表时间、因果强度或真实距离。

## 九、Metrics 与权重

Kumu 内置网络指标引擎，包含：

- Degree
- Indegree
- Outdegree
- Closeness centrality
- Betweenness centrality
- Size / Reach
- 社区检测等

执行步骤：

1. 点击右下 Metrics。
2. 选择 Social Network Analysis。
3. 选择指标。
4. 点击 Discover。
5. 结果保存到新的 Field，再用 Size by 或 Color by 显示。

指标只针对当前未被 Filter 隐藏的对象计算；数据更新后需要重新运行。[Metrics 官方指南](https://docs.kumu.io/guides/metrics)

部分指标支持权重：

- Betweenness、Closeness、Degree 使用 Connection 数字字段作为权重。
- Size、Reach 使用 Element 数字字段作为权重。

可以把 `Strength`、`Frequency` 或 `Evidence count` 设为数字字段参与计算，但必须先明确权重的数学含义。特别是最短路径指标中，“权重越大”究竟表示距离更大还是关系更强，需要根据具体指标检查和转换，不能直接把置信度塞进去就解释为因果强度。

SNA Dashboard 还能显示整体节点数、边数、密度、互惠性、直径、平均度和平均路径长度。[SNA Dashboard](https://docs.kumu.io/guides/controls/sna-dashboard-control)

这些都是图结构指标，不是因果效应大小，也不是因果置信度。

## 十、电子表格导入

### Elements 表

最简格式：

| Label        | Type           | Description      | Tags    |
| ------------ | -------------- | ---------------- | ------- |
| 订阅价格上涨 | Abstract Event | 订阅单价发生增加 | pricing |
| 用户取消订阅 | Abstract Event | 用户主动终止订阅 | churn   |

`Label` 必须位于 A1；如果使用 ID，则 ID 可以位于第一列。

### Connections 表

| ID     | From         | To           | Type     | Evidence count | Confidence | Description       |
| ------ | ------------ | ------------ | -------- | -------------: | ---------: | ----------------- |
| CR-001 | 订阅价格上涨 | 用户取消订阅 | opposite |              4 |       0.72 | 由4个具体案例支持 |

如果 Elements 使用 ID，Connections 的 From 和 To 也必须使用这些 ID。多值字段使用 `|` 分隔。[导入数据结构说明](https://docs.kumu.io/guides/import/import)

### 三种导入方式

1. XLSX / CSV：适合批量录入和修改；重新导入时需要防止重复。
2. Google Sheets：刷新地图时读取最新表格，适合多人收集；在 Kumu 中只读，是单向同步。
3. JSON / Blueprint：适合备份、恢复和程序生成；远程 JSON 是 Kumu 最接近公共 API 的方式。

[Import 官方指南](https://docs.kumu.io/guides/import)

Google Sheets 模式存在限制：不能直接在 Kumu 修改底层数据，Pin、Popover、Direct Decoration 等部分功能不可用，也不能自动检测 Loop。[Google Sheets 官方指南](https://docs.kumu.io/guides/import/google-sheets)

### 必须使用稳定 ID

如果不提供 ID，Kumu 会根据 Label，或者 Label + Type，判断是创建还是更新对象。这可能导致同名对象合并或重新导入产生重复。

推荐：

```text
Element ID：AE-0001
Connection ID：CR-0001
Evidence ID：CE-0001
```

需要保留同起点、同终点的多条具体证据 Connection 时，每条 Connection 必须具有唯一 ID。[避免重复数据指南](https://docs.kumu.io/frequently-asked-questions/how-do-i-avoid-duplicating-data)

## 十一、导出和备份

右下角 Export 支持：

- PDF：高分辨率矢量图，所有项目均可无限导出；不支持 Geo、Presentation、Grid/Guide、背景图等内容。
- PNG：当前视口截图；Geo Map 不支持 PNG。
- XLSX：Elements 与 Connections 分表，可导出选中部分。
- JSON：项目 Blueprint，保存 Maps、Views 和基础数据，但不包含 Presentations。

Loops 不随 XLSX 导出，只能保存在 JSON 中；JSON 也不包括 Presentations。[Export 官方指南](https://docs.kumu.io/guides/export)

因此正式项目建议同时保留：

```text
XLSX：便于审核和迁移的数据表
JSON：Kumu 项目级备份
Presentation URL/单独记录：发布成果
```

## 十二、分享、演示和协作

### Share / Embed

右下角 Share 可生成：

- 可分享链接
- iframe 嵌入代码

可以选择是否显示 Map Overview、是否保留当前缩放和位置。私有项目的分享链接可以设置密码；知道链接和密码的人可以查看，即使没有加入 Project。共享地图对更新的同步可能延迟最多约一小时。[Share and embed 官方指南](https://docs.kumu.io/guides/share-and-embed)

### Presentation

Presentation 可以组合：

- Title slide
- Map slide
- Text slide
- Image slide
- Embed slide

Map slide 会记住 Map、View、缩放、Focus 和 Filter，因此可以分步骤展开复杂因果网络。发布后可通过 URL 访问、设置密码、嵌入网站或开启自动播放。[Presentations 官方指南](https://docs.kumu.io/guides/presentations)

项目更新后，需要重新 Publish / Update presentation 才会反映新版本。项目隐私变化也不会自动改变 Presentation 隐私。

### Collaboration

公开和私有项目都可以添加无限 Collaborators。公开 Project 可能被搜索引擎索引，也可以被其他 Kumu 用户 Fork；私有 Project 只对授权用户或持有共享凭据的人开放。[协作与分享说明](https://docs.kumu.io/overview/collaboration)

Pro Workspace 才提供 View-only collaborators、Manager 权限、实时讨论、活动记录、定制品牌和更频繁备份等高级能力。

## 十三、当前价格和限制

截至 2026-07-19，[Kumu 官方价格页](https://kumu.io/pricing)和[官方价格 FAQ](https://docs.kumu.io/frequently-asked-questions/what-pricing-plans-does-kumu-have)列出的标准费用为：

| 项目                                  |              Basic Workspace |               Pro Workspace |
| ------------------------------------- | ---------------------------: | --------------------------: |
| Workspace 费用                        |                         免费 |       US$10/月，或 US$96/年 |
| 公开项目                              |                   无限、免费 |   无限、包含在 Workspace 中 |
| 私有项目                              | US$9/项目/月，或 US$86.40/年 | US$20/项目/月，或 US$192/年 |
| Collaborators                         |                         无限 |                        无限 |
| 备份                                  |                         每日 |          每小时，保留六个月 |
| View-only / Manager / 品牌 / 实时讨论 |                       不提供 |                        提供 |

私有项目通常有两周试用。Enterprise 可自托管或由 Kumu 托管，面向高敏感数据、SAML、数据地域和隔离环境等需求；官方 FAQ 当前称从每年 US$20,000、每5席位一组起，实际需询价。价格可能变化，采购前应重新确认官网。

### 性能限制

Kumu 没有公开宣称固定的数据条数硬限制，但实际性能取决于浏览器、电脑、网络、字段数量、图形复杂度和连接密度。官方导入文档建议，当 10,000+ 数据点出现问题时先尝试子集；官方 FAQ 也强调存在因设备而异的实践上限。[数据容量 FAQ](https://docs.kumu.io/frequently-asked-questions/how-much-data-can-kumu-handle)

## 十四、如何映射本项目的数据模型

### 推荐方案 A：Kumu 只展示抽象层

这是最稳妥、最容易维护的方案。

| 本项目对象             | Kumu 对象                     |
| ---------------------- | ----------------------------- |
| 抽象原子事件           | Element                       |
| 抽象因果关系           | Connection                    |
| 具体事件               | 外部数据库或证据表            |
| 具体因果依据           | 外部数据库或证据表            |
| 证据数量/来源数/置信度 | Connection 自定义 Fields      |
| 证据详情入口           | Connection URL 或 Description |

例如：

```text
Element AE-001：订阅价格上涨
Element AE-002：用户取消订阅
Connection AR-001：AE-001 → AE-002
Evidence count：4
Independent source count：3
Confidence：0.72
Evidence URL：https://your-app/relations/AR-001/evidence
```

优点：网络清晰，性能和交互较好。缺点：证据库需要外部系统。

### 方案 B：抽象层和具体层都放入 Kumu

可以定义：

```text
Element Type = Abstract Event
Element Type = Concrete Event
Connection Type = Abstract Causality
Connection Type = Evidence Of
Connection Type = Concrete Causality
```

然后用不同 Views：

- Abstract Network：Filter 掉 Concrete Event 和证据连接。
- Evidence View：Focus 某条抽象关系对应的具体事件。
- Timeline/Case View：只看一个案例。

问题在于 Kumu 的 Connection 不能直接“连接到另一条 Connection”。要表示“某条具体关系是某条抽象关系的证据”，通常需要把“抽象关系”额外建模成 Element，形成关系实体化：

```text
抽象原因事件 → 关系实体 → 抽象结果事件
具体案例 → supports → 关系实体
```

这会让图和数据模型显著复杂化，不建议作为第一版。

### 方案 C：每条具体证据都是一条平行 Connection

为每个具体因果实例创建同 From、同 To、不同 ID 的 Connection，并在 Profile 中记录证据。这种方法可以保留全部证据，但存在明显问题：

- 平行边默认重叠，看起来像一条边。
- Kumu 不会自动将它们聚合成 Bundle。
- Kumu 不直接提供重复连接折叠功能；官方提供的是 Google Sheets `KUMU_COLLAPSE` 公式作为外部处理方式。
- 大量证据会显著增加边数量和性能压力。

[重复连接折叠说明](https://docs.kumu.io/frequently-asked-questions/how-do-i-collapse-duplicate-connections)

所以本项目更推荐方案 A：在自己的数据库中保存具体事件和具体因果依据，定期聚合成 Kumu 的抽象 Elements 与 Connections。

## 十五、推荐的首次实践

用 5—10 个已核实案例做一个小型原型：

1. 创建一个公开测试 Project，选择 Systems 模板。
2. 只导入抽象原子事件和聚合后的抽象因果关系。
3. 为每个 Element 增加定义和原子性审核状态。
4. 为 Connection 增加 Evidence count、Independent source count、Confidence、Evidence URL、Review status。
5. 将 Connection 全部设为 Directed。
6. 按 Evidence count 设置边宽。
7. 按 Review status 设置边颜色。
8. 新建一个 View，只显示已审核且证据数达到阈值的关系。
9. 用 Focus 查看单个事件的上游原因和下游结果。
10. 创建 3—5 页 Presentation，逐步展开一条主要因果链和反馈回路。
11. 同时导出 XLSX 和 JSON 作为数据检查与备份。

## 十六、明确局限

- Kumu 是通用网络和系统图工具，不是因果证据编码产品。
- 没有“Source → Quote → Causal Claim”的原文标注工作流。
- 不会自动判断 Element 是否逻辑原子。
- 不会自动把多条具体因果证据聚合成抽象关系。
- 不会自动计算独立来源数或因果置信度。
- 多条同起点终点 Connection 默认重叠，证据展开体验不理想。
- Loop 的 R/B 分类、Connection 极性和因果方向主要依赖人工判断。
- Metrics 是网络结构分析，不等于因果效应或统计因果推断。
- Field 的 private 显示设置不是严格的数据保密边界。
- Google Sheets 是单向同步，并限制部分交互、装饰和回路功能。
- XLSX 不包括 Loops，JSON 不包括 Presentations，备份需要组合处理。
- 复杂或超过约万级数据点的图可能出现实际性能问题。
- 免费公开项目可被搜索引擎索引，不适合敏感证据。

## 最终判断

如果目标是快速制作一张专业、精致、可交互的抽象因果网络，并用不同视图、布局和演示讲清系统结构，Kumu 比多数通用白板工具更合适。

如果目标重点是“从真实材料建立具体事件和具体因果依据库，让重复证据自动增强抽象关系置信度”，Kumu 只能承担可视化层。证据数据库、关系聚合、独立性处理和置信度算法仍应由专用应用实现。

## 官方资料索引

- [Kumu 官方文档首页](https://docs.kumu.io/)
- [Kumu 架构](https://docs.kumu.io/overview/kumus-architecture)
- [系统图指南](https://docs.kumu.io/disciplines/system-mapping)
- [Elements、Connections、Loops](https://docs.kumu.io/guides/what-are-loops)
- [Profiles](https://docs.kumu.io/guides/profiles)
- [Fields](https://docs.kumu.io/guides/fields)
- [Views](https://docs.kumu.io/guides/views)
- [Decorations](https://docs.kumu.io/guides/decorate)
- [Focus](https://docs.kumu.io/guides/focus)
- [Layouts](https://docs.kumu.io/guides/layouts)
- [Metrics](https://docs.kumu.io/guides/metrics)
- [Import](https://docs.kumu.io/guides/import)
- [Export](https://docs.kumu.io/guides/export)
- [Share and embed](https://docs.kumu.io/guides/share-and-embed)
- [Presentations](https://docs.kumu.io/guides/presentations)
- [Pricing](https://kumu.io/pricing)
