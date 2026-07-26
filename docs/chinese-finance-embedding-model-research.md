# 中文金融语义检索模型选型研究

更新时间：2026-07-24

## 1. 结论

如果产品只要求中文语义检索，不再把跨语言能力作为模型选择条件，当前最合理的做法不是
直接寻找一个更大的模型，而是先用项目自己的中文金融事件数据定义能力上限，再在以下四个
模型中盲测：

1. [`BAAI/bge-small-zh-v1.5`](https://huggingface.co/BAAI/bge-small-zh-v1.5)：
   24M 参数、512 维，INT8 ONNX 约 24 MB，接入风险最低，作为轻量基线。
2. [`thenlper/gte-small-zh`](https://huggingface.co/thenlper/gte-small-zh)：
   约 30M 参数、512 维；同体量公开中文检索成绩优于 BGE Small，作为首选性价比挑战者。
3. [`BAAI/bge-base-zh-v1.5`](https://huggingface.co/BAAI/bge-base-zh-v1.5)：
   约 102M 参数、768 维，INT8 ONNX 约 103 MB，作为通用中文质量上限。
4. [`valuesimplex-ai-lab/Fin-Retriever-base`](https://huggingface.co/valuesimplex-ai-lab/Fin-Retriever-base)：
   BERT-base 级、768 维、512 token，是真正经过中文金融检索对比学习的 embedding 模型，
   作为领域模型挑战者。

初步优先级是：

`GTE Small Zh` → `BGE Small Zh v1.5` → `Fin-Retriever-base` → `BGE Base Zh v1.5`。

这里的顺序表示测试顺序，不代表提前认定质量高低：

- 如果 GTE Small 已达到项目的质量上限，就不需要选择更大的模型。
- 如果 GTE Small 在因果方向、金融反义词或同义归一上失败，再测试 BGE Small 和两个
  base 级模型。
- Fin-Retriever-base 是目前找到的最可信中文金融专用候选，但其优势来自金融问答、
  研报、公告和指标检索，尚未证明适用于本项目的短原子事件与因果关系。
- Fin-Retriever-base 当前只有 452 MB PyTorch 权重，没有官方 ONNX，而且 Hugging Face
  权重仓库没有标注许可证。即使质量胜出，也必须先完成权重许可确认和 ONNX 转换验证，
  才能作为正式产品模型。

不建议继续以 BGE-M3 或 Qwen3-Embedding-0.6B 作为这轮选型目标。它们有更长上下文、
多语言或指令能力，但本项目主要索引 50–100 字的中文短文本，这些能力不能抵消更高的
CPU、内存、下载和索引成本。

## 2. 先定义增强语义搜索的能力上限

### 2.1 产品需要它做到什么

增强语义搜索是“候选召回工具”，不是判断事实是否相同的自动审核器。第一版能力上限应为：

- 从原子事件、因果关系、具体案例各自的列表中，根据中文近义表达召回相关记录；
- 识别常见金融同义表达、简称、全称、口语和书面语改写；
- 对词序不同但语义相同的短文本保持较高召回；
- 对明确的反义、否定、方向相反、主体不同、时间或数值不同的记录保持区分；
- 与现有普通搜索合并，普通搜索继续负责精确名称、股票代码、数字和关键词；
- 返回候选结果供用户判断，不自动合并记录，不自动认定重复，不修改因果关系和置信度。

增强搜索不承担：

- 根据新事件推理未来股价或利好、利空；
- 判断两个事件在事实层面必然相同；
- 验证因果关系是否真实；
- 替代图查询、上下游遍历或置信度计算；
- 对关键数字、日期、公司主体和否定词提供百分之百可靠的逻辑推理。

这一边界很重要。向量模型擅长“意思相近”，但并不天然擅长区分
“上调/下调”“增持/减持”“收入增长 10%/下降 10%”以及因果方向倒置。

### 2.2 本项目的输入上限

当前语义文档由以下字段拼接：

- 原子事件：名称、别名、关键词、说明；
- 因果关系：原因事件、结果事件、关系说明；
- 具体案例：案例内容。

名称和案例主体很短，测试中把语义文档限制在 512 token 已经足够。即使以后增加少量别名和
关键词，也没有必要为了当前功能选择 8K 或 32K 上下文模型。

虽然界面和主要内容是中文，金融数据中仍会自然出现 `AAPL`、`ETF`、`EPS`、`PMI`、
股票代码、百分比和中英文公司名称。所谓“只支持中文”应理解为不要求跨语言检索，
不能把这些真实金融标识从测试集删除。

### 2.3 质量门禁

建议先构造 240 条模拟记录和 120 条人工查询，每种实体各 80 条记录、40 条查询。
每条查询标注：

- 1–3 条相关记录；
- 3–8 条高难度混淆记录；
- 是否允许返回相同主题但不同事实的记录；
- 关键区分字段：方向、极性、主体、时间、数值或因果顺序。

模型达到以下门禁即可视为达到第一版能力上限：

| 指标 | 门禁 |
| --- | ---: |
| 相关记录 Recall@10 | ≥ 95% |
| MRR@10 | ≥ 0.85 |
| 同义/改写查询 Recall@5 | ≥ 95% |
| 因果方向与极性 hard-negative 通过率 | ≥ 95% |
| 主体、时间、数值 hard-negative 通过率 | ≥ 90% |
| 无匹配查询的阈值误召率 | ≤ 5% |
| 相比普通搜索在“无共同关键词的近义查询”上的 Recall@10 提升 | ≥ 15 个百分点 |

不能只比较平均分。若模型平均 Recall 很高，却把“公司增持”排在“公司减持”前面，
它仍然不能通过项目门禁。

### 2.4 资源门禁

针对 Colima 8 GiB、2 CPU、约 5.6 万条记录和手动点击增强查询的环境：

| 指标 | 建议上限 |
| --- | ---: |
| INT8 模型及 tokenizer 下载量 | ≤ 200 MB |
| 向量维度 | ≤ 768 |
| Worker 稳态 RSS | ≤ 1.2 GiB |
| 单次短查询 embedding P95 | ≤ 500 ms |
| API 增强查询总耗时 P95 | ≤ 800 ms |
| 5.6 万条全量索引时间 | ≤ 30 分钟 |
| 索引期间 Worker 峰值 RSS | ≤ 1.5 GiB |

这些是待实测门禁，不是由模型卡推算出来的既成事实。只要小模型达到质量门禁，
更大的模型即使 C-MTEB 分数更高也不应入选。

按 pgvector 普通 `vector` 的 `4 × 维度 + 8` 字节估算，5.6 万条记录的原始向量内容约为：

| 维度 | 原始向量内容 |
| ---: | ---: |
| 384 | 约 83 MiB |
| 512 | 约 110 MiB |
| 768 | 约 165 MiB |
| 1024 | 约 220 MiB |

实际数据库还会增加行、主键、TOAST 和 HNSW 索引空间，因此 512 或 768 维对本项目更经济。

## 3. 模拟数据应覆盖的真实问题

测试数据不应只是随机金融句子。应围绕原子事件、因果关系和具体案例，系统构造以下类别：

| 类别 | 查询示例 | 正例示例 | 高难度负例 |
| --- | --- | --- | --- |
| 中文近义 | 央行收紧货币政策 | 政策利率上调 | 央行下调存款准备金率 |
| 简称/全称 | 央妈降准 | 中国人民银行降低存款准备金率 | 美联储降低联邦基金利率 |
| 金融术语 | 鹰派表态 | 央行释放加息信号 | 央行维持利率不变 |
| 极性相反 | 大股东减持 | 控股股东出售所持股份 | 控股股东增持股份 |
| 否定 | 未达到业绩预期 | 净利润低于市场预期 | 净利润超过市场预期 |
| 因果方向 | 油价上涨推高航空成本 | 原油价格上涨 → 航空燃油成本增加 | 航空需求增长 → 原油价格上涨 |
| 主体不同 | 苹果下调出货量 | Apple 下修 iPhone 出货预期 | 华为上调手机出货目标 |
| 时间不同 | 美联储 2024 年降息 | 2024 年 9 月美联储降息 | 2020 年 3 月美联储紧急降息 |
| 数值不同 | 利率上调 25 个基点 | 政策利率提高 0.25 个百分点 | 政策利率提高 50 个基点 |
| 股票代码 | 宁德时代扩产 | 300750 新建动力电池产能 | 比亚迪新建整车工厂 |
| 链式关系 | 加息导致成长股估值下降 | 无风险利率上升 → 高估值股票承压 | 成长股下跌 → 央行决定加息 |
| 具体案例归一 | 英伟达季度收入超预期 | NVIDIA 财报营收高于分析师预测 | NVIDIA 指引低于市场预期 |
| 无匹配 | 某公司董事长个人爱好 | 无 | 不应因出现“公司”而召回大量事件 |

每种模式至少包含 8–10 组，并交叉加入同一关键词、不同主体与不同方向的记录。
测试集需要冻结，模型阈值只能在开发集上调整，不能根据测试结果反复修改标注。

可以用
[`FinCPRG`](https://huggingface.co/datasets/valuesimplex-ai-lab/FinCPRG)
作为中文研报检索补充数据。它包含约 19 万条来自约 1,300 份金融研报的句子、段落、
主题级查询与 qrels，但它不能替代本项目自己的短事件 hard-negative 测试集。

## 4. 中文通用模型筛选

不同模型卡使用了不同版本和数据集数量的 C-MTEB，分数不能跨版本直接排序。
下表优先引用同一模型卡中的 35 数据集 C-MTEB Retrieval 指标，用于初筛，不作为最终结论。

| 模型 | 参数 | 维度 | 最大长度 | 中文 Retrieval | 可商用许可 | ONNX / Transformers.js | 判断 |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| BGE Small Zh v1.5 | 24M | 512 | 512 | 61.77 | MIT | HF Staff INT8，约 24 MB | **实测候选；最低接入风险** |
| GTE Small Zh | 约 30M | 512 | 512 | 65.50 | MIT | 无官方转换；标准 BERT 可自行导出 | **实测候选；性价比最高预期** |
| BGE Base Zh v1.5 | 约 102M | 768 | 512 | 69.49 | MIT | HF Staff INT8，约 103 MB | **实测候选；通用质量上限** |
| GTE Base Zh | 约 102M | 768 | 512 | 71.71 | MIT | 无官方 HF Staff 中文 ONNX | 有竞争力，但与 BGE Base 体量重复 |
| Piccolo Base Zh | 约 102M | 768 | 512 | 71.20 | MIT | 非官方 ONNX | 有竞争力，接入证据弱于 BGE |
| Stella Base Zh v2 | 约 102M | 768 | 1024 | 70.08 | 未在卡片明确标注 | 非官方 ONNX | 许可和接入信息不足 |
| M3E Small | 24M | 512 | 512 | 无统一同口径高分 | **仅研究/非商用** | 无官方 ONNX | 因许可排除正式版本 |
| M3E Base | 约 110M | 768 | 512 | 56.91 | **仅研究/非商用** | 无官方 ONNX | 质量与许可均无优势 |
| BCE Embedding Base v1 | 279M | 768 | 512 | 官方使用自建双语评测 | Apache-2.0 | 无官方 ONNX | 体量过大，短中文场景收益不明确 |
| Jina Embeddings v2 Base Zh | 161M | 768 | 8192 | 非同口径 | Apache-2.0 | 官方 INT8 约 162 MB，支持 Transformers.js | 长上下文在本项目无价值 |
| ritrieve_zh_v1 | 326M | 1024 | 512 | 76.97 | MIT | 无官方 ONNX | 高分但超过资源上限 |
| Qwen3 Embedding 0.6B | 600M | 32–1024 | 32K | 71.03（新版口径） | Apache-2.0 | ONNX Community INT8 约 614 MB | 与 BGE-M3 同属过重档位 |
| Youtu Embedding | 2B | 2048 | 8K | 80.21（新版口径） | 自定义许可 | 无轻量官方 ONNX | 明显超出本机上限 |

### 4.1 BGE Small / Base Zh v1.5

BGE 官方模型卡说明：

- BGE Small Zh v1.5 为 24M 参数、512 维；
- BGE Base Zh v1.5 为 768 维、512 token；
- v1.5 改善了相似度分布，不使用查询指令时检索退化较小；
- 模型和 FlagEmbedding 采用 MIT 许可，可免费商用。

同一官方表中的 C-MTEB Retrieval 分别为 61.77 和 69.49。
[BGE 官方模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)

Hugging Face Staff 转换仓库提供可直接用于 Transformers.js 的 ONNX：

- [BGE Small Zh v1.5 ONNX](https://huggingface.co/Xenova/bge-small-zh-v1.5)：
  INT8 主模型约 24 MB；
- [BGE Base Zh v1.5 ONNX](https://huggingface.co/Xenova/bge-base-zh-v1.5)：
  INT8 主模型约 103 MB。

两者都是标准 BERT，当前 Linux ARM64 + ONNX Runtime 的落地风险低。BGE Small 应作为
轻量基线，BGE Base 用来判断 100M 级模型是否对项目数据产生足够大的实际提升。

### 4.2 GTE Small / Base Zh

阿里达摩院发布的 GTE 中文模型使用标准 BERT 架构，最大 512 token：

- GTE Small Zh：约 0.1 GB、512 维，C-MTEB Retrieval 65.50；
- GTE Base Zh：约 0.2 GB、768 维，C-MTEB Retrieval 71.71。

[GTE 官方模型卡](https://huggingface.co/thenlper/gte-small-zh)

GTE Small 只有约 30M 参数，却在发布方同表中明显高于 BGE Small，因此它是最值得优先
实测的小模型。风险在于官方仓库未提供 Transformers.js 转换；社区有 ONNX 文件，但正式
产品不应直接依赖未经项目固定和验证的第三方转换。它是标准 BERT，技术上可由项目自行
固定 revision、导出 ONNX、量化、计算 SHA-256，再在 ARM64 容器中验证。

### 4.3 M3E

M3E Small 为 24M 参数、512 维，M3E Base 为约 110M 参数、768 维。发布方说明训练数据
包含大量非商用数据，因此 M3E 模型仅供研究使用。
[M3E 官方模型卡](https://huggingface.co/moka-ai/m3e-small)

即使 M3E Small 资源很低，也不能作为公开产品的默认模型。它可以在离线研究中作为历史
对照，但不应进入正式候选集。

### 4.4 BCE、Jina 和 Qwen3

[`bce-embedding-base_v1`](https://huggingface.co/maidalun1020/bce-embedding-base_v1)
是网易有道发布的 279M 参数中英双语 embedding，768 维、512 token、Apache-2.0，
并经过实际 RAG 产品验证。但原始 fp32 权重约 1.1 GB，缺少官方 ONNX；对本项目只做中文
短文本检索而言，体量与集成成本不具优势。

[`jina-embeddings-v2-base-zh`](https://huggingface.co/jinaai/jina-embeddings-v2-base-zh)
为 161M 参数、768 维、8,192 token，Apache-2.0，官方提供约 162 MB INT8 ONNX 和
Transformers.js 用法。它适合中英混排长文档，而当前 50–100 字短文本无法利用长上下文，
因此不进入四模型实测集。

[`Qwen3-Embedding-0.6B`](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
为 600M 参数、32K 上下文，支持把输出截断到 32–1024 维。它的新版 C-MTEB Retrieval
为 71.03，但官方 ONNX Community 的 INT8 模型约 614 MB，decoder 架构在 2 CPU 上的
延迟和内存风险高。它没有解决当前 BGE-M3 过重的根本问题。

## 5. 中文金融专用模型调查

### 5.1 Fin-Retriever-base：真正可用于向量检索

Fin-Retriever-base 不是普通 FinBERT hidden state，而是 FinBERT2-base 经过对比学习微调
得到的 SentenceTransformer：

- 768 维；
- 512 token；
- mean pooling + normalize；
- 支持 cosine similarity、semantic search 和 clustering；
- 输入查询建议保留中文检索指令。

[模型卡](https://huggingface.co/valuesimplex-ai-lab/Fin-Retriever-base)；
[官方仓库](https://github.com/valuesimplex/FinBERT)。

FinBERT2 论文说明底座使用 320 亿 token 中文金融语料预训练，金融语料包括研报、新闻、
公告等；Fin-Retriever 在五类金融检索任务上平均优于 BGE-base-zh 约 6.8%。
[FinBERT2 论文](https://arxiv.org/abs/2506.06335)

但论文也给出了重要限制：

- Fin-Retriever 的优势集中在金融域；
- 通用检索中，Fin-Retriever-base 的平均 NDCG@10 约 0.751，低于 BGE-base-zh 的 0.774；
- 论文基准偏向“问题 → 研报、公告、指标证据”，不等于“短事件名称 → 同义原子事件”；
- 金融领域领先不能证明它能可靠区分因果方向和极性反义。

部署风险：

- 当前只有约 452 MB fp32 `pytorch_model.bin`；
- 没有官方 ONNX 或 safetensors；
- 模型仓库自身没有标注权重许可证。官方代码仓库为 MIT、FinBERT2-base 卡片为
  Apache-2.0，都不能自动替代 Fin-Retriever 权重的明确授权；
- 标准 BERT 架构意味着可以尝试导出 INT8 ONNX，但必须自行验证 pooling、归一化、
  tokenizer 新增词、ARM64 推理一致性和量化后的质量下降。

因此它应进入盲测，但在许可证和 ONNX 门禁完成前不能成为正式默认模型。

### 5.2 FinE5：真实金融 embedding，但不适合本项目

[`FinanceMTEB/FinE5`](https://huggingface.co/FinanceMTEB/FinE5)
是基于 `e5-mistral-7b-instruct` 微调的 7B 金融 embedding，在 FinMTEB 排名领先。
但模型需要申请访问，许可证为 CC-BY-NC-ND-4.0，禁止商业使用和演绎，并且 7B 体量远超
当前 8 GiB / 2 CPU 环境，因此直接排除。

FinMTEB 覆盖中英文 64 个金融数据集和 7 类任务。论文的三个发现对本项目很重要：

1. 金融域适配模型通常优于通用模型；
2. 通用 benchmark 不能可靠预测金融任务表现；
3. 在金融 STS 上，传统词袋方法甚至可能超过 dense embedding。

[FinMTEB 论文（ACL Anthology）](https://aclanthology.org/2025.emnlp-main.179/)

这反而支持当前“普通搜索默认、用户主动点击增强查询、两类结果合并”的设计，而不是用
向量搜索完全替换普通搜索。

### 5.3 DMetaSoul 金融 SBERT：任务方向不匹配

[`sbert-chinese-qmc-finance-v1-distill`](https://huggingface.co/DMetaSoul/sbert-chinese-qmc-finance-v1-distill)
是 45M 参数、4 层 BERT 的轻量中文 sentence embedding。发布方报告相对 102M teacher：

- latency 从 38 ms 降至 20 ms；
- throughput 从 418 提高到 791 sentence/s；
- 平均匹配指标下降约 4.81 个百分点。

但它的“金融”主要指银行借款、还款和利息问题匹配，训练目标不是股票事件、财经新闻或
因果关系检索，而且没有官方 ONNX 和明确权重许可证。它可以作为极轻量研究对照，不应作为
本项目主候选。

### 5.4 不能直接替代 embedding 的金融模型

以下模型即使名称包含 FinBERT、Finance 或 Stock，也不能直接作为 pgvector 检索模型：

- FinBERT2-base / large：金融领域预训练 encoder 底座，没有经过句向量对比学习；
- FinBERT sentiment、FinBERT tone：情感分类模型；
- 金融主题分类、NER、事件抽取模型：输出标签或实体，不输出经过检索训练的句向量；
- FinGPT、DISC-FinLLM、金融问答 LLM：生成模型，不是 dense bi-encoder；
- 股票涨跌预测模型：预测目标与语义相似度不同。

`AutoModel` 能返回 hidden state，不等于这些 hidden state 已经适合 cosine similarity 和
HNSW 检索。要使用 FinBERT2，应选择其经过对比学习的 Fin-Retriever。

## 6. 实测决策规则

正式实测按以下顺序进行，每个模型使用完全相同的文档、查询、相关性标注和硬负例：

1. 跑现有 `multilingual-e5-small`，记录当前基线；
2. 跑 GTE Small Zh；
3. 跑 BGE Small Zh v1.5；
4. 如果小模型未达到质量门禁，再跑 Fin-Retriever-base 和 BGE Base Zh v1.5；
5. 对通过质量门禁的模型，再执行 5.6 万条全量索引、查询 P50/P95、峰值 RSS、
   模型下载量、向量表与 HNSW 占用测试；
6. 选择满足质量门禁的最小、最快、许可最清晰的模型，而不是选择平均分最高的模型。

建议的淘汰顺序：

- 许可证不允许公开产品使用：立即淘汰；
- ARM64 ONNX 无法稳定加载或量化结果不一致：淘汰；
- 极性/方向 hard-negative 未达 95%：淘汰；
- Recall 达标但超过资源上限：淘汰；
- 多个模型均通过：依次比较增强查询 P95、全量索引时间、Worker RSS 和向量维度。

基于公开信息的当前预判：

- **最可能的最终默认模型：GTE Small Zh 或 BGE Small Zh v1.5。**
- **最值得验证的金融专用模型：Fin-Retriever-base。**
- **最稳妥的中型通用上限：BGE Base Zh v1.5。**
- **暂不值得继续投入：BGE-M3、Qwen3 0.6B、BCE、Jina v2、Youtu。**

## 7. 主要资料来源

- BGE 中文模型：
  https://huggingface.co/BAAI/bge-small-zh-v1.5
- BGE Small Transformers.js/ONNX：
  https://huggingface.co/Xenova/bge-small-zh-v1.5
- BGE Base Transformers.js/ONNX：
  https://huggingface.co/Xenova/bge-base-zh-v1.5
- GTE 中文模型：
  https://huggingface.co/thenlper/gte-small-zh
- M3E：
  https://huggingface.co/moka-ai/m3e-small
- BCE Embedding：
  https://huggingface.co/maidalun1020/bce-embedding-base_v1
- Jina Embeddings v2 Base Zh：
  https://huggingface.co/jinaai/jina-embeddings-v2-base-zh
- Qwen3 Embedding 0.6B：
  https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- Piccolo Base Zh：
  https://huggingface.co/sensenova/piccolo-base-zh
- Stella Base Zh v2：
  https://huggingface.co/infgrad/stella-base-zh-v2
- ritrieve_zh_v1：
  https://huggingface.co/richinfoai/ritrieve_zh_v1
- Youtu Embedding：
  https://huggingface.co/tencent/Youtu-Embedding
- Fin-Retriever-base：
  https://huggingface.co/valuesimplex-ai-lab/Fin-Retriever-base
- FinBERT2 官方仓库：
  https://github.com/valuesimplex/FinBERT
- FinBERT2 论文：
  https://arxiv.org/abs/2506.06335
- FinE5：
  https://huggingface.co/FinanceMTEB/FinE5
- FinMTEB：
  https://aclanthology.org/2025.emnlp-main.179/
- FinCPRG：
  https://huggingface.co/datasets/valuesimplex-ai-lab/FinCPRG
- DMetaSoul 金融 SBERT 蒸馏版：
  https://huggingface.co/DMetaSoul/sbert-chinese-qmc-finance-v1-distill
