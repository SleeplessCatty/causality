# Causal Map 功能与用法指南

## 结论

Causal Map 是一个“定性因果证据编码与网络分析”工具：用户从访谈、报告、调查等来源中标出因果陈述，将其编码为“原因因素 → 结果因素”，再按相同起点与终点聚合为网络边。它适合验证因果知识库的录入、证据回溯和网络呈现流程，但不是统计因果推断引擎，也不能仅凭引用次数证明因果关系成立。

## 核心数据模型

| 对象    | 含义                                       | 对应本项目概念              |
| ------- | ------------------------------------------ | --------------------------- |
| Project | 一个研究项目及其全部数据                   | 因果知识库                  |
| Source  | 一份访谈、文档或案例文本                   | 具体案例/具体事件的证据载体 |
| Factor  | 只有名称的原因或结果概念                   | 抽象原子事件                |
| Link    | 从一段原文编码出的一条 Cause → Effect 陈述 | 一次具体因果关系证据        |
| Bundle  | 起点与终点相同的 Links 的集合              | 抽象因果关系                |

Citation Count 是一个 Bundle 中 Link 的数量；Source Count 是支持该 Bundle 的不同 Source 数量。后者较不容易被一份重复叙述很多次的材料放大，但两者都只是证据数量指标，不是严格的因果置信度。

## 标准工作流

1. 创建 Project。
2. 上传 PDF、DOCX、TXT、Markdown、RTF 或按规定列组织的 XLSX；也可以粘贴文本。
3. 在 Sources 中打开一份材料，选中包含因果含义的原文。
4. 在 Create Links 中填写 Cause 和 Effect，复用已有 Factor 名称，必要时添加标签和自定义字段。
5. 保存后形成一条 Link；相同 Cause → Effect 的多条 Link 自动组成 Bundle，并在 Map 上显示为一条聚合边。
6. 用 Filter Links 控制纳入分析的数据，用 Map Formatting 控制节点、边、方向和计数的视觉编码。
7. 从 Map 点击节点或边查看关系，再到 Links/Evidence 回看原文、来源和上下文。
8. 用 Factors 表清理名称，用 Pivot Tables 按人群、时间、地区、来源类型等维度比较。

## 主要功能

### 来源管理

- 支持常见文档与结构化 XLSX 导入。
- Source 可增加日期、地区、访谈对象、案例编号等自定义列。
- 大文档可以按规则拆成多个 Source；也可以使用分节标记生成可筛选的 section 字段。
- Source 元数据可用于筛选和透视分析。

### 人工因果编码

- 选中原文后，系统将其写入 Link 的 Quote，确保关系可追溯。
- Cause 与 Effect 可输入新 Factor，也可复用现有名称。
- Chain 模式会把上一条关系的 Effect 自动带入下一条的 Cause，适合连续因果链。
- 标签可表达 `verified`、`doubtful`、`hypothetical`、`review` 等审核状态。
- Plain coding 用自环表示“主题出现但没有因果陈述”；若目标是纯因果网络，通常应关闭或在分析时排除。
- 一次填写多个原因和结果会产生笛卡尔积关系，不能用它表达“多个条件必须同时成立”的联合原因。

### 网络图

- 显示有方向的 Factor 网络，支持拖动、缩放、搜索、跳转和多种布局方向。
- 相同起点和终点的 Link 在图上合并为一个 Bundle。
- 节点大小/颜色和边宽/标签可映射 Citation Count、Source Count、影响度、结果性等指标。
- 可高亮反馈回路。
- Evidence/Print View 可按 Bundle 和 Source 展开证据，显示引文以及前后文。
- 可复制高质量网络图和图例。

### 筛选与分析

- 筛选器按从上到下的顺序组成处理流水线，可启用、停用和调整顺序。
- 可以按 Source、标签、Factor、上游/下游层级、最少引用数、最少来源数、路径等筛选。
- 可以临时合并近义 Factor、进行层级缩放或聚类，而不立即改写原始编码。
- Pivot Tables 可对 Links、Factors、Sources 做行列聚合、热力图和图表，并导出数据。

### 数据治理与协作

- Factors 面板用于查找、批量重命名和合并 Factor；批量替换会改变原始编码，操作前应预览或保留版本。
- Project 可导出为 XLSX，也可通过 XLSX 更新来源和导入完整项目。
- 付费功能包括私有项目、版本、书签、报告、统计和团队协作，具体范围取决于套餐。

## 面向本项目的推荐配置

### 1. 把一个独立案例作为一个 Source

如果一份报告包含多个互不相同的事件案例，上传时应拆成多个 Source，而不是把整份报告只算一个 Source。建议 Source 自定义字段至少包含：

- `case_id`
- `occurred_at`
- `location`
- `actor`
- `source_url`
- `evidence_status`
- `independence_group`

这样 Source Count 才较接近“有多少独立发生的案例支持这条关系”。

### 2. 把 Factor 当作抽象原子事件

Factor 名称建议使用“主体 + 单一状态变化”，例如“订阅价格上涨”“用户取消订阅”。名称中出现“并且”“然后”“导致”等连接词，通常说明它还不是原子事件。Causal Map 的 Factor 本身只有名称，没有定义、边界和判定规则，因此应另建事件词典，记录每个 Factor 的定义、纳入条件、排除条件和示例。

### 3. 把 Link 当作一次具体证据

例如来源 S-001 中出现：“价格上涨后，该客户取消了订阅。”可编码为：

- Cause：订阅价格上涨
- Effect：用户取消订阅
- Quote：保留上述原文
- Tag：`verified`
- Source metadata：案例时间、主体和材料出处

若同一方向关系在 4 个 Link 中出现，但只来自 2 个 Source，则 Citation Count = 4，Source Count = 2。

### 4. 用 Source Count 做初步证据强度，而非最终置信度

网络图可将边宽和边标签都映射到 Source Count，并设置最小 Source Count 筛选。正式的置信度还应另外考虑：来源是否独立、证据质量、反例数量、时间顺序、混杂因素以及人工审核结果。Causal Map 不会自动完成这些判断。

## 建议的首次练习

用 5—10 个真实案例建立一个小项目：每个案例一个 Source，每个案例只编码有明确原文依据的 Cause → Effect；统一 Factor 名称；把边宽设置为 Source Count；先筛选 Source Count ≥ 2；最后逐条打开 Evidence 检查所有聚合关系是否都能回到原文。这个练习足以验证录入、聚合、可视化和证据追溯四个核心流程。

## 明确限制

- 它分析的是材料中的因果陈述或认知，不会自动证明客观因果性。
- 没有独立的具体事件实体、事件时间线和原子性校验。
- Factor 主要是标签，不适合直接承载复杂事件定义和结构化属性。
- Citation Count 与 Source Count 不处理证据独立性、质量、反例和混杂因素。
- 不能自然表达必须共同出现的联合原因。
- 免费项目为公开项目；敏感数据需要私有套餐。
- 当需要严格的事件实体、自动置信度算法、权限流程或深度系统集成时，应开发专用应用。

## 官方资料

- 产品主页：https://causalmap.app/
- 工作原理：https://garden.causalmap.app/how-causalmap-works/
- 手工编码：https://garden.causalmap.app/howto-manual-code/
- Map 面板：https://garden.causalmap.app/map-panel/
- Sources 面板：https://garden.causalmap.app/sources-panel/
- Pivot Tables：https://garden.causalmap.app/999%20Causal%20Map%20App/160%20Pivot%20Tables%20%20%28%28pivot-panel%29%29.html
- 价格：https://causalmap.app/pricing/
