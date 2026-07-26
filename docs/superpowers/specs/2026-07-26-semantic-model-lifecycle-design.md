# 语义模型生命周期与统一状态处理设计

**状态：** 已审核，等待实施
**日期：** 2026-07-26  
**适用阶段：** P2-02 语义增强搜索最终整改  
**关联设计：** `docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md`

## 1. 目标

统一管理语义模型从系统首次部署、下载、校验、加载、全量索引、增量同步、失败恢复、重新索引到模型切换的完整生命周期。

本设计解决以下问题：

- 模型文件、当前模型、索引、任务和 Worker 状态相互混淆；
- 前端依赖多个底层字段推断阶段、按钮和轮询行为；
- 通用“重试任务”可能选中已失效的旧失败任务；
- 单条业务记录失败可能拖垮整个全量索引；
- Worker 离线被错误地解释为模型或索引失败；
- 模型切换、重新索引和旧任务写回缺少统一不变量。

## 2. 已确认的产品决策

| 主题 | 决策 |
|---|---|
| 模型切换 | 立即切换，立即清空旧向量 |
| 切换可用性 | 下载、加载和全量索引期间增强查询不可用 |
| 索引不完整 | 增强查询继续可用，提示结果可能缺少部分记录 |
| 不完整索引处理 | 不展示失败记录，只允许重新索引或切换模型 |
| 自动重试 | 按失败类型区分；可重试失败自动恢复，确定性失败等待人工操作 |
| 自动重试次数 | 最多3次执行机会，即首次执行加两次自动重试 |
| 状态监控 | 活动状态每秒轮询；Worker 离线且有活动任务时每5秒轮询 |
| 活动高层任务 | 下载、加载或全量索引期间禁止切换模型 |
| 重新索引 | 立即删除旧向量，从文件校验和加载开始 |
| 文件校验 | Worker 启动检查当前模型；每次加载、切换和重新索引前检查 |
| 文件失效 | 删除无效目录，等待用户手工重新下载 |
| 失败操作 | 使用阶段专用按钮和 API，不保留通用重试入口 |
| 模型预下载 | 不支持；首次选择即“下载并使用” |
| 任务历史 | 不保留；成功后删除，失败只保留到问题被处理 |
| Worker 离线 | 独立系统状态，不修改模型文件和索引事实状态 |
| 系统状态页 | 检查 Worker 连接、加载状态及与当前模型的一致性 |
| 状态架构 | 使用正交状态机和统一生命周期快照 |

## 3. 统一语言

### 3.1 语义模型文件

按照固定 revision 下载并校验、可供本地语义模型离线加载的一组文件。模型文件是否完整，与该模型是否为当前模型相互独立。

### 3.2 当前语义模型

用户最近选择、负责生成当前语义索引并执行增强查询的唯一模型。模型切换事务成功后，新模型立即取代原模型。

### 3.3 语义索引

当前语义模型为原子事件、因果关系和具体案例生成的向量集合。同一时间只保留一套当前业务向量。

### 3.4 语义索引不完整

语义索引已经完成可用发布，但仍有一条或多条业务记录因语义索引最终失败而没有可查询向量。增强查询继续可用，但结果可能缺少这些记录。

### 3.5 可重试失败

由网络、数据库连接、任务租约或其他短暂运行条件引起，不修改业务数据或模型配置也可能在再次执行后恢复。

### 3.6 确定性失败

由模型不兼容、非法向量、无法处理的业务记录或其他稳定条件引起，使用相同输入直接重试不会恢复。

## 4. 状态对象与唯一事实来源

系统状态分为五层：

| 层级 | 作用范围 | 保存内容 | 唯一事实来源 |
|---|---|---|---|
| 模型文件 | 每个模型独立 | 下载、校验、文件完整性和文件错误 | 模型设置 |
| 当前模型 | 全系统唯一 | 当前模型代码和状态版本 | 全局索引状态 |
| 语义索引 | 只属于当前模型 | 进度、同步情况、失败数量和可用性 | 全局索引状态 |
| 执行任务 | 当前工作 | 下载、加载、全量和增量任务及租约 | 任务表 |
| Worker | 当前运行环境 | 连接、加载模型和一致性 | Worker 健康检查 |

Worker 状态是运行事实，不反向修改模型文件或索引状态。

## 5. 模型文件状态

```ts
type SemanticModelFileStatus =
  | 'not_downloaded'
  | 'download_queued'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'invalid'
  | 'failed';
```

| 状态 | 含义 | 稳定性 |
|---|---|---|
| `not_downloaded` | 从未下载或无效目录已清除 | 稳定 |
| `download_queued` | 下载任务等待 Worker | 活动 |
| `downloading` | 下载固定版本文件 | 活动 |
| `verifying` | 校验文件存在、大小和 SHA-256 | 活动 |
| `downloaded` | 文件完整，可离线加载 | 稳定 |
| `invalid` | 文件缺失、损坏或版本不符 | 稳定失败 |
| `failed` | 下载最终失败，没有形成有效文件 | 稳定失败 |

文件校验是下载任务或使用前检查中的执行阶段，不单独作为长期任务类型。

## 6. 模型角色

```ts
type SemanticModelRole = 'inactive' | 'current';
```

同一时间最多一个 `current` 模型。由于模型切换采用立即生效策略，不设置 `target` 角色。

## 7. 语义索引状态

```ts
type SemanticIndexStatus =
  | 'empty'
  | 'waiting_model'
  | 'loading'
  | 'index_queued'
  | 'building'
  | 'ready'
  | 'updating'
  | 'incomplete'
  | 'failed';
```

| 状态 | 增强查询 | 含义 |
|---|---:|---|
| `empty` | 不可用 | 没有当前模型和向量 |
| `waiting_model` | 不可用 | 当前模型正在下载或等待重新下载 |
| `loading` | 不可用 | 当前模型正在加载到 Worker |
| `index_queued` | 不可用 | 全量索引任务已建立但尚未执行 |
| `building` | 不可用 | 正在生成全部业务向量 |
| `ready` | 可用 | 全部业务记录具有有效向量 |
| `updating` | 可用 | 有增量任务正在排队或执行 |
| `incomplete` | 可用 | 存在没有有效向量的失败记录 |
| `failed` | 不可用 | 加载或全量索引整体失败 |

只有 `ready`、`updating` 和 `incomplete` 可以执行增强查询。

## 8. 任务状态

```ts
type SemanticTaskType = 'download' | 'load' | 'full_index' | 'incremental';
type SemanticTaskStatus = 'queued' | 'running' | 'retry_wait' | 'failed';
type SemanticTaskPhase =
  | 'waiting'
  | 'downloading'
  | 'verifying'
  | 'loading'
  | 'indexing';
```

| 状态 | 含义 |
|---|---|
| `queued` | 等待 Worker 领取 |
| `running` | Worker 持有有效租约 |
| `retry_wait` | 可重试失败，等待下次自动执行 |
| `failed` | 最终失败，等待阶段专用人工操作 |

成功任务先原子更新稳定状态，再删除任务记录。旧状态版本任务被模型切换或重新索引取代后直接删除。

## 9. 失败结构和分类

```ts
interface SemanticFailure {
  stage: 'download' | 'verify' | 'load' | 'full_index' | 'incremental';
  kind: 'retryable' | 'manual';
  code: string;
  message: string;
  attempts: number;
  occurredAt: string;
}
```

规则：

- 程序只根据稳定 `code` 判断恢复方式；
- `message` 是有限长度的用户可读摘要；
- `retryable` 允许自动重试；
- `manual` 等待阶段专用人工操作；
- 未知错误默认按 `manual` 处理；
- Worker 离线不生成 `SemanticFailure`。

### 9.1 稳定错误代码

| 阶段 | 错误代码 | 类型 | 处理 |
|---|---|---|---|
| 下载 | `DOWNLOAD_NETWORK_ERROR` | retryable | 自动重试 |
| 下载 | `DOWNLOAD_TIMEOUT` | retryable | 自动重试 |
| 下载 | `MODEL_STORAGE_FULL` | manual | 修复磁盘后重试下载 |
| 校验 | `MODEL_FILE_MISSING` | manual | 删除目录，重新下载 |
| 校验 | `MODEL_SIZE_MISMATCH` | manual | 删除目录，重新下载 |
| 校验 | `MODEL_HASH_MISMATCH` | manual | 删除目录，重新下载 |
| 加载 | `MODEL_LOAD_TRANSIENT` | retryable | 自动重试 |
| 加载 | `MODEL_RUNTIME_INCOMPATIBLE` | manual | 修复环境或切换模型 |
| 加载 | `MODEL_MEMORY_INSUFFICIENT` | manual | 调整资源后重试加载 |
| 索引 | `DATABASE_TEMPORARILY_UNAVAILABLE` | retryable | 自动重试 |
| 索引 | `WORKER_LEASE_LOST` | retryable | 自动重试 |
| 索引 | `VECTOR_DIMENSION_INVALID` | manual | 全量索引失败 |
| 索引 | `VECTOR_VALUE_INVALID` | manual | 全量索引失败 |
| 单条记录 | `SOURCE_EMBEDDING_FAILED` | manual | 索引不完整 |
| 发布 | `INDEX_VALIDATION_FAILED` | manual | 全量索引失败 |
| 系统 | `SEMANTIC_WORKER_UNAVAILABLE` | 不持久化 | 只影响查询和系统状态 |

## 10. 系统首次部署

| 对象 | 初始状态 |
|---|---|
| 所有模型文件 | `not_downloaded` |
| 当前模型 | `null` |
| 语义索引 | `empty` |
| 当前任务 | 无 |
| Worker | 在线、未加载模型 |
| 增强查询 | 不可用 |
| 操作 | 任意模型“下载并使用” |

## 11. 首次下载并使用

| 顺序 | 文件状态 | 索引状态 | 当前任务 |
|---:|---|---|---|
| 用户确认 | `download_queued` | `waiting_model` | 下载·排队 |
| Worker 领取 | `downloading` | `waiting_model` | 下载·执行 |
| 下载完成 | `verifying` | `waiting_model` | 下载·校验 |
| 校验成功 | `downloaded` | `loading` | 加载·排队 |
| 加载成功 | `downloaded` | `index_queued` | 全量索引·排队 |
| 生成向量 | `downloaded` | `building` | 全量索引·执行 |
| 全部成功 | `downloaded` | `ready` | 无 |
| 存在单条失败 | `downloaded` | `incomplete` | 无 |
| 整体失败 | `downloaded` | `failed` | 全量索引·失败 |

每个阶段成功后删除原任务并原子创建下一阶段任务。

## 12. 模型切换

### 12.1 互斥规则

| 当前情况 | 是否允许切换 |
|---|---:|
| 无活动高层任务 | 允许 |
| 下载排队、下载或校验 | 不允许 |
| 加载 | 不允许 |
| 全量索引排队或执行 | 不允许 |
| 增量同步 | 允许 |
| 最终失败 | 允许 |
| 索引不完整或就绪 | 允许 |

不提供任务取消。

### 12.2 切换事务

用户执行“下载并使用”或“使用此模型”时，API 在一个事务中：

1. 锁定全局语义索引状态；
2. 拒绝活动高层任务期间的切换；
3. 如果目标已经是当前模型，返回当前快照；
4. 立即把目标设为当前模型；
5. `stateVersion + 1`；
6. 删除全部当前业务向量；
7. 删除旧状态版本任务；
8. 清空索引进度、失败数和错误；
9. 根据目标文件状态建立下载或加载任务；
10. 提交事务。

切换成功后不能再使用旧模型增强查询。旧模型文件继续保留。

## 13. 重新索引

重新索引事务：

1. 锁定全局状态；
2. 拒绝活动高层任务期间的操作；
3. 确认存在当前模型；
4. `stateVersion + 1`；
5. 删除全部向量；
6. 删除旧版本任务和失败记录；
7. 清除进度、失败数和错误；
8. 校验当前模型文件；
9. 创建加载任务；
10. 加载成功后创建全量索引任务。

即使 Worker 当前加载了同一模型，也不能跳过文件校验和加载。

## 14. 增量同步

| 写入前状态 | 写入后状态 | 处理 |
|---|---|---|
| `ready` | `updating` | 失效旧向量并建立增量任务 |
| `updating` | `updating` | 合并同一记录的排队任务 |
| `incomplete` | `incomplete` | 建立任务并保留不完整状态 |
| 下载、加载或失败 | 不变 | 下一次全量索引读取最终业务数据 |
| `building` | `building` | 建立增量任务，发布前排空 |

增量结束：

| 条件 | 状态 |
|---|---|
| 无待处理、无失败 | `ready` |
| 有待处理、无失败 | `updating` |
| 有最终失败 | `incomplete` |

删除不存在的业务记录只删除对应向量，不记为失败。

## 15. 自动重试

最多3次执行机会：

| 执行 | 含义 | 等待 |
|---:|---|---:|
| 1 | 首次执行 | 无 |
| 2 | 第一次自动重试 | 5秒 |
| 3 | 第二次自动重试 | 30秒 |

只有 `retryable` 失败进入 `retry_wait`。第3次仍失败或错误为 `manual` 时进入最终失败。租约过期后被重新领取也计入一次执行机会。

## 16. 阶段专用操作

```ts
type SemanticAction =
  | 'download_and_use'
  | 'use'
  | 'retry_download'
  | 'redownload_and_use'
  | 'retry_load'
  | 'retry_full_index'
  | 'reindex';
```

| 当前阶段 | 操作 |
|---|---|
| 非当前且未下载 | 下载并使用 |
| 非当前且下载失败 | 下载并使用；切换后清除旧下载错误并建立新下载任务 |
| 非当前且文件失效 | 重新下载并使用；切换后删除无效目录并建立新下载任务 |
| 非当前且已下载 | 使用此模型 |
| 当前模型下载最终失败 | 重试下载、切换模型 |
| 当前模型文件失效 | 重新下载并使用、切换模型 |
| 加载可恢复失败 | 重试加载、切换模型 |
| 加载确定性失败 | 修复环境后重试加载、切换模型 |
| 全量索引可恢复失败 | 重试全量索引、切换模型 |
| 全量确定性失败 | 重新索引、切换模型 |
| 索引不完整 | 重新索引、切换模型 |
| 索引就绪 | 重新索引、切换模型 |

不保留通用“重试任务”操作。

## 17. 模型文件失效

检查时机：

- Worker 启动时检查当前模型；
- 切换到已下载模型时检查；
- 重新索引时检查；
- 失败后重试加载时检查；
- 下载完成时检查全部固定文件。

文件失效处理：

1. 删除整个无效版本目录和临时目录；
2. 文件状态改为 `invalid`；
3. 当前索引不可用；
4. 卸载 Worker 中的当前模型；
5. 停止加载或索引任务；
6. 等待用户“重新下载并使用”；
7. 不自动访问网络。

不主动周期校验非当前模型。

## 18. 高层任务与增量任务

| 高层阶段 | 新业务写入 |
|---|---|
| 下载、校验、加载 | 不创建增量任务 |
| 全量索引 | 建立或合并增量任务，发布前排空 |
| 就绪 | 建立增量任务并进入 `updating` |
| 不完整 | 建立增量任务并保持 `incomplete` |
| 索引失败 | 不创建增量任务 |

全量发布前必须：

1. 完成主批次；
2. 排空构建期间产生的增量任务；
3. 核对业务记录、向量和失败记录数；
4. 确认所有缺失都能被当前失败记录解释；
5. 发布为 `ready` 或 `incomplete`。

## 19. 一致性约束

### 19.1 任务领取

Worker 领取任务时必须确认：

- 状态可领取且达到 `nextAttemptAt`；
- 租约为空或过期；
- 任务模型等于当前模型；
- 任务版本等于当前状态版本；
- 当前索引阶段允许该任务；
- 没有其他活动高层任务。

旧模型或旧版本任务直接删除。

### 19.2 向量写入

写入前再次确认：

- 当前模型和状态版本未变化；
- 业务记录仍存在；
- 业务内容 hash 未变化；
- 向量维度正确；
- 所有向量数值有限。

不满足时不得覆盖最新业务内容。

### 19.3 索引状态不变量

| 状态 | 必须满足 |
|---|---|
| `empty` | 没有当前模型、向量和任务 |
| `waiting_model` | 有当前模型，但文件不可加载 |
| `loading` | 文件为 `downloaded`，存在加载任务 |
| `index_queued` | 模型已加载，存在排队全量任务 |
| `building` | 存在运行中的全量任务 |
| `ready` | `pendingItems=0`、`failedItems=0` |
| `updating` | `pendingItems>0`、`failedItems=0` |
| `incomplete` | `failedItems>0`，`pendingItems` 可大于0 |
| `failed` | 存在当前加载或全量失败 |

所有业务向量的模型代码必须等于当前模型。页面错误必须属于当前模型和当前状态版本。

## 20. Worker 状态

```ts
interface SemanticWorkerStatus {
  status: 'online' | 'unreachable';
  modelState: 'idle' | 'preparing' | 'loaded' | 'missing' | 'mismatch';
  loadedModelCode: SemanticModelCode | null;
  checkedAt: string;
}
```

| 数据库与 Worker | 组合状态 |
|---|---|
| 没有当前模型，Worker 未加载 | `online + idle` |
| 当前模型处于准备阶段 | `online + preparing` |
| Worker 正确加载当前模型 | `online + loaded` |
| 可用索引对应模型未加载 | `online + missing` |
| Worker 加载模型与当前模型不同 | `online + mismatch` |
| Worker 无法连接 | `unreachable` |

Worker 离线不修改文件或索引状态。增强查询返回语义服务不可用，普通搜索保持可用。

## 21. 生命周期快照

```ts
interface SemanticLifecycleSnapshot {
  currentModelCode: SemanticModelCode | null;
  models: SemanticModelLifecycle[];
  index: SemanticIndexLifecycle;
  operation: SemanticOperation | null;
  worker: SemanticWorkerStatus;
  pollAfterMs: 1000 | 5000 | null;
  updatedAt: string;
}
```

每个模型：

```ts
interface SemanticModelLifecycle {
  modelCode: SemanticModelCode;
  fileState: SemanticModelFileStatus;
  role: SemanticModelRole;
  stage:
    | 'not_downloaded'
    | 'download_queued'
    | 'downloading'
    | 'verifying'
    | 'loading'
    | 'index_queued'
    | 'building'
    | 'ready'
    | 'updating'
    | 'incomplete'
    | 'failed';
  availableForEnhancedSearch: boolean;
  allowedActions: SemanticAction[];
  failure: SemanticFailure | null;
}
```

当前高层操作：

```ts
interface SemanticOperation {
  type: 'download' | 'load' | 'full_index';
  phase: SemanticTaskPhase;
  status: SemanticTaskStatus;
  modelCode: SemanticModelCode;
  attempt: number;
  maxAttempts: 3;
  progress:
    | { unit: 'bytes'; completed: number; total: number }
    | { unit: 'items'; completed: number; total: number }
    | null;
  nextRetryAt: string | null;
  failure: SemanticFailure | null;
}
```

增量任务不逐条返回，只提供 `pendingItems`、`failedItems` 和最近错误。

## 22. 轮询规范

| 情况 | `pollAfterMs` |
|---|---:|
| 高层任务排队、执行或等待重试 | `1000` |
| 有增量任务排队或执行 | `1000` |
| Worker 离线且仍有活动任务 | `5000` |
| 没有当前模型 | `null` |
| 文件稳定状态 | `null` |
| 索引就绪或不完整 | `null` |
| 最终失败 | `null` |

参数配置页重新获得焦点时立即刷新一次。前端不自行推导轮询条件。

## 23. 系统状态页

系统状态页在 API 和 PostgreSQL 后增加 Semantic Worker：

| Worker 结果 | 显示 |
|---|---|
| 在线且没有当前模型 | 正常·未加载模型 |
| 在线且正确加载当前模型 | 正常·已加载当前模型 |
| 在线且当前模型正在准备 | 正常·模型准备中 |
| 应加载但未加载 | 模型未加载 |
| 加载模型与当前模型不同 | 模型状态不一致 |
| 无法连接 | 无法连接 |

进入页面时检查一次；“重新检查”同时刷新 API、PostgreSQL 和 Worker。不持续轮询，不触发任何语义任务。浏览器通过 API 代理检查，不直接暴露 Worker 内部端口。

## 24. 参数配置页

每个模型卡显示：

| 区域 | 内容 |
|---|---|
| 文件 | 未下载、下载中、校验中、已下载、文件失效、下载失败 |
| 角色 | 当前模型或非当前模型 |
| 索引 | 无当前索引、加载中、生成中、就绪、更新中、不完整、失败 |

当前操作进度只在页面顶部显示一次。

错误优先级：

1. 当前高层操作失败；
2. 当前模型文件失效或下载失败；
3. 当前索引加载或全量失败；
4. 当前索引不完整；
5. Worker 运行异常。

前端只根据生命周期快照渲染，不自行组合底层状态。

## 25. 阶段专用 API

```http
GET  /api/semantic/lifecycle
POST /api/semantic/models/:modelCode/use
POST /api/semantic/models/:modelCode/retry-download
POST /api/semantic/models/:modelCode/redownload
POST /api/semantic/models/:modelCode/retry-load
POST /api/semantic/models/:modelCode/retry-full-index
POST /api/semantic/reindex
```

规则：

- 每个操作只接受对应生命周期状态；
- 非法状态返回稳定冲突代码；
- 不保留通用 `/api/semantic/retry`；
- 操作在事务中锁定生命周期状态；
- 重复提交同一合法操作返回现有任务，不建立重复任务。

### 25.1 增强查询同步提示

三个列表的增强查询响应使用：

```ts
type SemanticIndexNotice = 'updating' | 'incomplete' | null;
```

替换只能表达“正在更新”的 `semanticIndexUpdating: boolean`：

| 当前索引 | `semanticIndexNotice` | 页面提示 |
|---|---|---|
| `ready` | `null` | 不显示提示 |
| `updating` | `updating` | 语义索引尚在同步，结果可能暂不包含最新修改 |
| `incomplete` | `incomplete` | 语义索引不完整，结果可能缺少部分记录 |

普通搜索响应始终返回 `null`。该字段只表达索引同步完整性，不返回失败记录、匹配原因或相似度。

## 26. 数据结构调整

### 26.1 模型设置

模型设置保存：

- `file_status`；
- `failure_kind`；
- `failure_code`；
- `error`；
- 原有 revision、threshold 和 downloaded_at。

### 26.2 索引状态

索引状态增加：

- `failed_items`；
- `failure_stage`；
- `failure_kind`；
- `failure_code`。

### 26.3 任务

任务增加：

- `load` 类型；
- `retry_wait` 状态；
- `phase`；
- `next_attempt_at`；
- `failure_kind`；
- `failure_code`。

新逻辑不保留成功任务。

## 27. 失败记录边界

为保证索引完整性，数据库可以保留当前版本失败增量任务，但：

- API 只返回失败总数和最近错误；
- 页面不返回失败实体 ID、名称或列表；
- 不提供单条或批量失败重试；
- 重新索引删除全部失败增量任务并重建；
- 模型切换删除旧版本失败任务。

这些记录是当前索引内部状态，不是任务历史。

## 28. 数据迁移

新增迁移，不修改已执行迁移。升级前停止 API 和 Worker。

迁移规则：

| 旧数据 | 新数据 |
|---|---|
| 旧下载状态 | 映射到对应文件状态 |
| `ready` 且存在当前失败增量任务 | `incomplete` |
| `updating` 且存在失败任务 | `incomplete` |
| 成功任务 | 删除 |
| 运行任务 | 清除租约并恢复为排队 |
| 旧版本任务 | 删除 |
| 多条高层失败任务 | 只保留与当前阶段匹配的最新一条 |

迁移不删除业务记录、已下载模型文件或符合不变量的当前向量。无法证明有效的索引设为 `failed`，提示重新索引，不能静默标记就绪。

## 29. 状态解析器

API 使用纯函数：

```ts
function resolveSemanticLifecycle(input: {
  models: SemanticModelState[];
  index: SemanticIndexState;
  jobs: SemanticJobState[];
  worker: SemanticWorkerStatus;
}): SemanticLifecycleSnapshot;
```

它统一计算阶段、允许操作、查询可用性、当前错误和轮询间隔。Repository 只读写事实状态，不生成页面逻辑。

## 30. 测试要求

### 30.1 状态解析

覆盖初始、下载、校验、文件失效、加载、全量索引、就绪、更新、不完整、全部失败、Worker 离线、模型不一致、旧任务隔离、阶段操作和轮询停止。

### 30.2 API 集成

覆盖立即切换、旧向量清理、高层任务互斥、阶段重试复用、成功任务删除、文件失效、重新索引、版本隔离、索引不变量和 Worker 状态代理。

### 30.3 Worker 集成

覆盖任务串联、自动重试、确定性失败、租约恢复、单条失败隔离、`ready/incomplete` 发布、增量合并和文件失效。

### 30.4 Web

覆盖模型卡、阶段按钮、切换禁用、十进制 MB、1秒/5秒/停止轮询、不完整提示和系统状态页 Worker 检查。

### 30.5 真实模型

最终使用中文轻量模型：

```bash
pnpm semantic:model-smoke -- bge-small-zh-v1.5
```

不使用质量优先模型完成本次状态机整改验证。

## 31. 范围外

本次不加入：

- 模型预下载；
- 任务历史；
- 任务取消；
- 双索引或无中断切换；
- 单条失败记录列表；
- 单条或批量失败重试；
- 自动重新下载失效模型；
- WebSocket 或 SSE；
- 多 Worker 调度界面；
- 自动选择模型。

## 32. 后续工作

本设计书面审核通过后：

1. 以本设计替换现有 P2-02 修复计划中的旧状态推断方案；
2. 使用实施计划规范重写 `2026-07-26-p2-02-final-remediation.md`；
3. 按任务顺序实施并逐项自动化测试；
4. 每个 Web 变化继续进行人工复核；
5. P2 全部完成前只保留本地提交，不推送 GitHub。
