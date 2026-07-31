# MCP 五条业务工作流

以下流程只依据 Causality 数据库。普通语言由外部 AI 组织；数据库事实、具体案例证据、模型推测和写入动作必须明确分开。

## 1. 采集并确认入库

- 普通请求：“整理这段关于供应链中断、交付周期延长和生产成本上升的讨论，生成入库方案。”
- Prompt：`causality_capture`
- Skill：`causality-capture`
- Tool 序列：`search_atomic_events` / `search_concrete_cases` / `search_causal_relations` → `compare_knowledge_candidates` → `prepare_knowledge_changes` → `get_import_plan_status` → 用户确认后 `commit_knowledge_changes`；响应不明确时 `get_import_result`。
- 确认边界：生成方案不写库；只有用户明确确认最新完整方案后才能提交。
- 可读输出：新增、复用、补充属性、跳过项、案例关联和质量问题，最后给出方案 ID 与失效时间。
- 恢复：候选质量阻断时修正完整候选重新对比；方案过期或被替换时生成新方案；系统失败时保留当前决定并等待服务恢复。
- 边界：对比结果是数据库候选；案例是证据；AI 的归类是判断；commit 才是事务写入。

## 2. 分析事件的直接原因与结果

- 普通请求：“分析供应链中断最直接的原因和结果，只使用库内证据。”
- Prompt：`causality_analyze_event`
- Skill：`causality-analyze-event`
- Tool 序列：`search_atomic_events` → `get_atomic_event` → `get_causal_relation` → `get_relation_cases`，需要补充邻接面时使用 `query_local_causal_graph`。
- 确认边界：全程只读；若随后要保存新知识，另行启动采集流程。
- 可读输出：目标事件、直接上游、直接下游、关系置信度、案例数和有限案例摘要。
- 恢复：名称不唯一时列候选让用户选；无直接关系时明确“库内未记录”；案例被截断时按游标继续读取。
- 边界：关系方向和置信度是事实；具体案例是证据；“最可能”排序是基于有限库内指标的解释，不是概率结论。

## 3. 追踪有向路径

- 普通请求：“查找供应链中断到生产成本上升之间是否存在有向因果路径。”
- Prompt：`causality_trace_path`
- Skill：`causality-trace-path`
- Tool 序列：两次 `search_atomic_events` → `find_causal_paths` → 对选中路径调用 `get_causal_evidence_bundle`，必要时用 `get_causal_relation` 和 `get_relation_cases` 续查。
- 确认边界：用户确认起点、终点或候选路径即可继续分析；不涉及写库确认。
- 可读输出：`供应链中断 → 交付周期延长 → 生产成本上升`，逐段列置信度、案例数、无案例段和截断状态。
- 恢复：没有路径时说明当前深度和过滤条件；达到扩展上限时缩小范围或选择中间事件；事件方向相反时重新确认起终点。
- 边界：路径段是数据库事实；案例是逐段证据；整条链的解释是组合推断，不能把间接路径伪装成一条直接关系。

## 4. 审查用户提出的因果链

- 普通请求：“审查‘供应链中断 → 交付周期延长 → 生产成本上升’每一段是否有库内支持。”
- Prompt：`causality_review_chain`
- Skill：`causality-review-chain`
- Tool 序列：逐个 `search_atomic_events` → 每段 `search_causal_relations` / `get_causal_relation` → `get_causal_evidence_bundle`。
- 确认边界：用户确认待审查链条文本；审查不会修改原链或写库。
- 可读输出：按段标记已记录、反向记录、缺失、无案例、案例被截断，并给出整体结论。
- 恢复：某段只找到反向关系时明确方向冲突；某段缺失时不臆造中间关系，可调用 `find_causal_paths` 查找间接路径；ID 失效时重新搜索。
- 边界：已存在关系是事实；案例是证据；链条整体是否可信是审查判断；新增缺失关系必须进入采集确认流程。

## 5. 推测下游结果

- 普通请求：“基于知识库推测供应链中断可能带来的后续结果，最多三层。”
- Prompt：`causality_infer_outcomes`
- Skill：`causality-infer-outcomes`
- Tool 序列：`search_atomic_events` → `query_local_causal_graph` → 对候选结果调用 `find_causal_paths` → `get_causal_evidence_bundle`。
- 确认边界：用户确认中心事件和查询范围；推测本身永不自动写库。
- 可读输出：最多五个候选结果，每个列一至三条路径、逐段置信度、案例依据、截断和不确定性。
- 恢复：局部图达到 20/50/100 上限时提示缩小过滤条件；语义增强不可用时改用普通搜索；只有间接路径时明确中间原子事件，不把它写成直接因果。
- 边界：节点、关系和案例是库内事实；候选排序及“可能结果”属于推测；需要保存新的关系或案例时重新启动采集并等待用户确认。
