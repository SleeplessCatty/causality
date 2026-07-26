# 本地语义嵌入模型选型研究

更新时间：2026-07-26

> 本文保留模型扩展前的选型过程。当前应用已固定集成中文轻量、轻量快速、均衡多语言和质量优先四个模型；下文的候选判断是研究记录，不表示当前只支持两个模型。

## 1. 结论

本轮研究中最值得优先验证的替代模型是
[`granite-embedding-97m-multilingual-r2`](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2)：

- 97M 参数、384 维，中文和英文都在 52 个重点增强语言中；
- 官方模型卡给出的最大上下文为 32,768 token，但本项目的事件、关系和案例文本很短，
  实际应继续限制在 512 或 1,024 token，避免为无用的长上下文付出内存和延迟成本；
- Hugging Face ONNX Community 已发布
  [Transformers.js 兼容版本](https://huggingface.co/onnx-community/granite-embedding-97m-multilingual-r2-ONNX)，
  INT8 ONNX 文件约 97.9 MB，连同约 25.3 MB 的 tokenizer，下载量约 123 MB；
- 向量仍为 384 维，因此向量存储成本与当前 `multilingual-e5-small` 基本一致；
- IBM 在统一的 Multilingual MTEB Retrieval 18 项测试中报告 60.3 分，
  同表中的 `multilingual-e5-small` 为 50.9 分。该结果是模型发布方自报的通用基准，
  不能代替本项目的金融事件语义测试，但足以支持把它列为首选试验对象。

如果 ModernBERT ONNX 在当前 `@huggingface/transformers@4.2.0` 运行时中出现兼容问题，
低风险备选是
[`multilingual-e5-base`](https://huggingface.co/intfloat/multilingual-e5-base)。
它与现有 E5 Small 使用相同的 query/passage 前缀、mean pooling 和 512-token 使用方式，
接入最直接；代价是 INT8 ONNX 约 279 MB、768 维向量，资源和存储约为 E5 Small 的两倍，
而官方 Mr. TyDi 平均 MRR@10 只从 64.4 提升到 65.9。

不建议把 `paraphrase-multilingual-MiniLM-L12-v2` 当作升级模型。它很轻且容易部署，
但官方模型卡只提供 128-token 的 Sentence Transformers 配置，也没有证明它在多语言检索上
优于当前 E5 Small。`gte-multilingual-base` 质量较强，但其 INT8 ONNX 约 340 MB、
向量为 768 维，而且官方原模型依赖自定义实现；在本项目短文本场景下，
它的 8K 长上下文优势用不上，性价比低于 Granite 97M。

## 2. 当前项目约束

项目当前的
[`MODEL_CATALOG`](../packages/semantic-core/src/modelCatalog.ts)
内置四个模型：

| 模型 | 项目固定格式 | 项目实际下载量 | 维度 | 项目最大 token | pooling / 前缀 |
| --- | --- | ---: | ---: | ---: | --- |
| `bge-small-zh-v1.5` | ONNX INT8 | 24,451,175 B（约 24 MB） | 512 | 512 | CLS；无前缀 |
| `multilingual-e5-small` | ONNX INT8 | 135,392,857 B（约 135 MB） | 384 | 512 | mean；`query:` / `passage:` |
| `granite-embedding-97m-multilingual-r2` | ONNX INT8 | 123,174,716 B（约 123 MB） | 384 | 512 | CLS；无前缀 |
| `bge-m3` | ONNX INT8 | 585,565,019 B（约 586 MB） | 1024 | 1,024 | CLS；无前缀 |

运行时只从固定目录加载固定文件，使用 CPU ONNX Runtime、顺序执行、2 个 intra-op 线程，
并在每次推理后释放输出 tensor。数据库目前允许 384、512 或 1024 维，并为四个模型、
三种实体分别建立了 HNSW 部分索引。因此继续增加任何新模型都不只是改 UI：
必须扩展模型代码枚举、下载清单和校验和、数据库约束及部分索引、Worker/API 协议与测试。

Granite 97M 虽然同为 384 维并复用相同的 pgvector 物理规格，
仍使用独立 `model_code`，没有伪装成 E5 Small。

## 3. 候选对比

下表的文件大小指可用于当前 CPU 部署方向的 INT8/QInt8 ONNX 主模型文件，
不包含 tokenizer 和少量配置文件。不同发布仓库的量化方法不同，数字适合做容量级别比较，
不等价于严格的同精度性能比较。

| 模型 | 参数量 | 向量维度 | 最大长度 | 语言 | INT8 ONNX | 许可证 | 当前项目适配判断 |
| --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| `bge-small-zh-v1.5`（当前） | 24M | 512 | 512 | 中文 | 24 MB | MIT | 中文轻量默认候选 |
| `multilingual-e5-small`（当前） | 约 0.1B | 384 | 512 | 100 种，含中英文 | 118 MB | MIT | 已验证；轻量基线 |
| `bge-m3`（当前） | 568M | 1024 | 官方 8,192；项目限制 1,024 | 100+ | 568 MB | MIT | 质量强，但当前 CPU/内存代价过高 |
| `granite-embedding-97m-multilingual-r2`（当前） | 97M | 384 | 32,768；项目限制 512 | 200+；52 种重点增强含中英文 | 97.9 MB | Apache-2.0 | 已完成固定版本集成 |
| `multilingual-e5-base` | 约 278M | 768 | 512 | 100 种，含中英文 | 279 MB | MIT | 最稳妥的中档备选；质量提升偏温和 |
| `gte-multilingual-base` | 305M | 768（可截断到 128–768） | 8,192 | 70+/75 | 340 MB | Apache-2.0 | 强检索模型，但对本项目偏重，适配风险高于 E5 |
| `paraphrase-multilingual-MiniLM-L12-v2` | 约 0.1B | 384 | Sentence Transformers 配置 128 | 50 种 | ARM64 QInt8 118 MB | Apache-2.0 | 适合作轻量相似度，不足以证明是 E5 Small 的升级 |

### 3.1 Granite Embedding 97M Multilingual R2

IBM 官方模型卡说明该模型为 97M 参数、384 维、ModernBERT 架构，支持 200+ 语言，
其中中文和英文都属于有专门检索对与跨语言训练的 52 种增强语言；
许可证为 Apache-2.0。模型使用 CLS pooling，不要求 E5 的 `query:` / `passage:` 前缀。
[官方模型卡](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2)

同一模型卡报告以下统一评测结果：

| 模型 | 参数量 | Multilingual MTEB Retrieval (18) | English Retrieval (10) | 吞吐量（H100，docs/s） |
| --- | ---: | ---: | ---: | ---: |
| `multilingual-e5-small` | 96M | 50.9 | 46.5 | 2,290 |
| `granite-embedding-97m-multilingual-r2` | 97M | 60.3 | 50.1 | 2,534 |
| `multilingual-e5-base` | 278M | 52.7 | 49.0 | 1,800 |
| `gte-multilingual-base` | 305M | 57.2 | 50.8 | 1,609 |

这些吞吐量来自 H100，不能直接推导 Apple Silicon + Colima CPU 的绝对速度；
它们只能说明模型发布方在相同测试条件下观察到的相对位置。

Hugging Face ONNX Community 的转换仓库明确标注支持 Transformers.js，
提供 97.9 MB 的 `model_quantized.onnx` / `model_int8.onnx`。
[ONNX 模型卡](https://huggingface.co/onnx-community/granite-embedding-97m-multilingual-r2-ONNX)
和
[ONNX 文件列表](https://huggingface.co/onnx-community/granite-embedding-97m-multilingual-r2-ONNX/tree/main/onnx)。

接入前仍需通过三个本地门禁：

1. 在 Linux ARM64 容器中用项目固定的 Transformers.js 版本完成加载、384 维输出和释放测试；
2. 使用现有中英文、同义/反义和金融因果事件测试集重新校准阈值；
3. 用 5.6 万条当前数据做全量索引，实测峰值 RSS、吞吐量和增强查询 P50/P95。

### 3.2 Multilingual E5 Base

E5 Base 为 12 层、768 维、约 0.3B 参数，支持 100 种语言，最大输入 512 token，
检索时必须保留 `query:` 和 `passage:` 前缀。官方模型卡的 Mr. TyDi 平均 MRR@10
为 65.9，E5 Small 为 64.4。
[E5 Base 官方模型卡](https://huggingface.co/intfloat/multilingual-e5-base)

Transformers.js 转换仓库提供约 279 MB 的量化 ONNX 文件。
[Xenova ONNX 仓库](https://huggingface.co/Xenova/multilingual-e5-base/tree/main/onnx)

它的主要价值是低软件适配风险，而不是最佳资源/质量比。项目可沿用 E5 Small 的
mean pooling、归一化和前缀规则，只需增加 768 维数据库约束和 HNSW 索引。

### 3.3 GTE Multilingual Base

Alibaba-NLP 官方模型卡给出 305M 参数、768 维、8,192 token、70+ 语言，
并支持把 dense embedding 截断到 128–768 维；许可证为 Apache-2.0。
[GTE 官方模型卡](https://huggingface.co/Alibaba-NLP/gte-multilingual-base)

其论文在统一的 33-language retrieval 汇总中报告：

| Dense 模型 | 汇总平均 | MLDR | MIRACL | MKQA | BEIR | LoCo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mE5 Base | 53.5 | 30.5 | 62.3 | 53.7 | 48.9 | 72.2 |
| BGE-M3 Dense | 64.3 | 52.5 | 67.7 | 67.8 | 48.7 | 84.9 |
| mGTE Dense | 66.7 | 56.6 | 62.1 | 65.8 | 51.1 | 88.9 |

来源：
[`mGTE: Generalized Long-Context Text Representation and Reranking Models for Multilingual Text Retrieval`,
Table 4](https://aclanthology.org/2024.emnlp-industry.103.pdf)。

这说明 GTE 的总体检索能力很强，但优势很大一部分来自长文档场景；
它在 MIRACL 和 MKQA 上仍低于 BGE-M3 Dense。当前项目的事件名、关系说明和案例都是短文本，
并不需要 8K 输入。ONNX Community 虽提供 Transformers.js 兼容仓库，
但 INT8 文件约 340 MB，且原模型使用自定义实现，因此它不是当前最经济的替换项。
[GTE ONNX 仓库](https://huggingface.co/onnx-community/gte-multilingual-base)
和
[文件列表](https://huggingface.co/onnx-community/gte-multilingual-base/tree/main/onnx)。

### 3.4 Paraphrase Multilingual MiniLM L12 v2

Sentence Transformers 官方模型卡说明该模型约 0.1B 参数、384 维、支持 50 种语言，
可用于聚类和语义搜索，但其 Sentence Transformers 配置最大长度只有 128 token。
许可证为 Apache-2.0。
[官方模型卡](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)

官方仓库提供 Apple ARM64 的约 118 MB QInt8 ONNX 文件。
[ONNX 文件列表](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/main/onnx)

它和 E5 Small 体积、参数量、维度接近，却缺少同口径证据证明检索质量更高，
最大输入还更短。因此可作为通用句子相似度备选，不应作为这次“质量更高且更轻”的升级方案。

## 4. 推荐实施顺序

1. 不立即删除现有四个模型定义，也不把官方通用分数直接当作产品结论。
2. 为 Granite 97M 做一次独立技术验证，不先改生产数据库：
   固定 revision 和文件 SHA-256，在临时目录下载 INT8 ONNX，跑真实模型 smoke 和项目语义质量集。
3. 如果 Linux ARM64、Transformers.js、领域质量和峰值内存全部通过，
   再把它加入模型目录，并优先作为“均衡/推荐”模型。
4. 使用 384 维 HNSW，索引存储规模保持在 E5 Small 档位；项目最大输入先设 512，
   只有以后真正引入长文档切片时再提高。
5. 如果 ModernBERT ONNX 兼容性不通过，再验证 E5 Base；不优先投入 GTE 和 MiniLM。
6. 模型切换前后使用同一批人工标注的中文、英文、中英混排金融事件查询做 A/B，
   以 Recall@K、误匹配率、查询 P95、全量索引耗时和 Worker 峰值 RSS 决定最终默认值。

## 5. 资料来源

- IBM Granite 97M 官方模型卡：
  https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2
- IBM Granite Embedding 官方仓库：
  https://github.com/ibm-granite/granite-embedding-models
- Granite 97M Transformers.js/ONNX 转换：
  https://huggingface.co/onnx-community/granite-embedding-97m-multilingual-r2-ONNX
- Multilingual E5 Base 官方模型卡：
  https://huggingface.co/intfloat/multilingual-e5-base
- Multilingual E5 Small 官方模型卡：
  https://huggingface.co/intfloat/multilingual-e5-small
- E5 Base Transformers.js/ONNX 转换：
  https://huggingface.co/Xenova/multilingual-e5-base
- BGE-M3 官方模型卡：
  https://huggingface.co/BAAI/bge-m3
- GTE Multilingual Base 官方模型卡：
  https://huggingface.co/Alibaba-NLP/gte-multilingual-base
- GTE Transformers.js/ONNX 转换：
  https://huggingface.co/onnx-community/gte-multilingual-base
- mGTE 论文：
  https://aclanthology.org/2024.emnlp-industry.103.pdf
- Paraphrase Multilingual MiniLM 官方模型卡：
  https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
