# 现成因果网络工具选型研究

> 调研日期：2026-07-19  
> 资料范围：产品官方站点与官方文档。

## 结论

**主选：Causal Map。**

如果目标是“不开发应用，立即用现成工具验证工作流”，Causal Map 最接近本项目的核心价值：每条具体因果主张可以保留来源原文，相同 `cause → effect` 会聚合成网络中的抽象关系，并能用 citation count 和 source count 表达证据数量与来源广度。

它并不能完整实现设计规范：没有独立的“抽象事件 / 时间轴具体事件”双层实体，不会判断事件是否原子，也没有本项目定义的正式置信度公式。因此它适合做验证工具，不适合作为最终业务系统。

## 需求映射

| 本项目概念   | Causal Map 中的映射                               | 完整度                             |
| ------------ | ------------------------------------------------- | ---------------------------------- |
| 抽象原子事件 | Factor（cause/effect 标签）                       | 中；不校验原子性                   |
| 具体事件     | Source 中的真实叙述，并用自定义字段记录时间、地点 | 中低；不是独立事件实体             |
| 抽象因果关系 | 相同 `cause → effect` 的 Link Bundle              | 高                                 |
| 具体因果依据 | 一条带 Source Quote 的 Causal Link                | 高                                 |
| 置信度       | Source Count、Citation Count、边宽和筛选阈值      | 中；是证据数量代理，不是统计置信度 |
| 依据库       | Sources、Links 与 Evidence View                   | 高                                 |
| 网络图       | 交互式有向因果网络                                | 高                                 |

## 选择理由

1. 官方产品定位就是从访谈、报告、调查等材料中标记因果主张，并把每项结论回链到来源文本。[Causal Map 产品页](https://causalmap.app/)
2. 相同原因和结果会形成聚合关系，可显示 citation count 与 source count，直接对应“多次具体证据增强抽象关系”的需求。
3. Map Panel 支持交互式有向网络、搜索、过滤、多种布局、反馈环高亮，并能用 Citation Count 或 Source Count 控制节点大小、连线宽度和标签。[Map Panel](https://garden.causalmap.app/map-panel/)
4. Evidence 操作会从当前网络筛选结果进入对应依据视图，能从抽象边追溯到具体来源与引用文本。[Map Panel - Evidence](https://garden.causalmap.app/map-panel/)
5. 免费版已包含无限项目和无限编码，但项目公开；私有项目当前从 £18/月开始。[官方价格](https://causalmap.app/pricing/)

## 关键缺口

- 具体事件不是可以复用和查询的独立实体，时间轴能力不足。
- Citation Count 可能包含同一来源的重复表达；Source Count 更稳妥，但不同来源也未必相互独立。
- 计数不能解释为统计学因果强度，也没有处理反例、来源质量或证据权重。
- 不校验事件是否为逻辑原子事件。
- 无法完整执行当前规范中的唯一约束、跨实体校验和自动置信度公式。

## 与 Kumu 的取舍

Kumu 是第二选择。它支持有向连接、因果环、任意自定义字段、来源脚注、多视图和过滤，因而更容易人工搭建“抽象事件、具体事件、抽象关系、具体依据”四类对象。[Kumu 系统图](https://docs.kumu.io/disciplines/system-mapping)；[Kumu Fields](https://docs.kumu.io/guides/fields)

但 Kumu 不会把多条具体依据原生聚合成一条抽象因果边，也不会自动计算置信度；需要借助 Google Sheets 或外部脚本维护。官方也明确说明 Kumu 没有常规公共 API，远程 JSON 只是最接近公共 API 的方式。[Kumu API 说明](https://docs.kumu.io/frequently-asked-questions/does-kumu-have-a-public-api)

因此：

- 优先验证“证据如何支持因果关系”：选 Causal Map。
- 优先验证“四层实体如何人工组织”：选 Kumu。
- 要严格满足全部规范：仍需自研。

## 最小试用方案

1. 准备 10–20 条真实“具体事件 A 促成具体事件 B”的材料，每条附时间、来源和原文。
2. 在 Causal Map 中把 A、B 编码为稳定、原子的 Factor 标签。
3. 检查相同 `A → B` 是否正确聚合，并比较 Citation Count 与 Source Count。
4. 使用 Source Count 控制边宽和最低证据筛选，从网络进入 Evidence View 核对原文。
5. 如果不能接受“具体事件只是 Source 中的叙述而不是独立实体”，停止迁就现成工具，按应用设计规范自研。
