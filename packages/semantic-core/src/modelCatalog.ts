export const semanticModelCodes = [
  'bge-small-zh-v1.5',
  'multilingual-e5-small',
  'granite-embedding-97m-multilingual-r2',
  'bge-m3',
] as const;

export type SemanticModelCode = (typeof semanticModelCodes)[number];
export type SemanticVectorDimensions = 384 | 512 | 1024;

export interface SemanticModelFile {
  remotePath: string;
  localPath: string;
  bytes: number;
  sha256: string;
}

export interface SemanticModelDefinition {
  code: SemanticModelCode;
  label: '中文轻量' | '轻量快速' | '均衡多语言' | '质量优先';
  description: string;
  languageLabel: string;
  repository: string;
  revision: string;
  dimensions: SemanticVectorDimensions;
  dtype: 'q8';
  pooling: 'mean' | 'cls';
  queryPrefix: string;
  documentPrefix: string;
  maxTokens: number;
  defaultThreshold: number;
  files: readonly SemanticModelFile[];
  expectedDownloadBytes: number;
}

type FileManifestEntry = readonly [path: string, bytes: number, sha256: string];

function createFileManifest(entries: readonly FileManifestEntry[]): readonly SemanticModelFile[] {
  return entries.map(([path, bytes, sha256]) => ({
    remotePath: path,
    localPath: path,
    bytes,
    sha256,
  }));
}

function totalBytes(files: readonly SemanticModelFile[]): number {
  return files.reduce((total, file) => total + file.bytes, 0);
}

const e5Files = createFileManifest([
  ['config.json', 658, 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'],
  [
    'tokenizer.json',
    17_082_730,
    '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  ],
  [
    'tokenizer_config.json',
    443,
    'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  ],
  [
    'special_tokens_map.json',
    167,
    'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7',
  ],
  ['quant_config.json', 674, '59d175f15264115f18c698d76e443b5d49fc6c8c599911c421405ef4f236e87d'],
  [
    'onnx/model_quantized.onnx',
    118_308_185,
    'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  ],
] as const);

const bgeFiles = createFileManifest([
  ['config.json', 658, '70dae5884ced999af00244f776ac9eaa71538d68497d3d6a6091e0318cd32905'],
  [
    'tokenizer.json',
    17_082_799,
    '249df0778f236f6ece390de0de746838ef25b9d6954b68c2ee71249e0a9d8fd4',
  ],
  [
    'tokenizer_config.json',
    1_203,
    'b87c8703482b0300d3da30e201519aa641f6a450f5eb5bf1e624afbf70c74d80',
  ],
  [
    'special_tokens_map.json',
    964,
    '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
  ],
  [
    'onnx/model_quantized.onnx',
    568_479_395,
    '2237f770aad5c71bbc1fc2d361a57f9a37400574cc9eff32626f0cdb49234730',
  ],
] as const);

const bgeSmallZhFiles = createFileManifest([
  ['config.json', 716, 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f'],
  ['tokenizer.json', 439_125, '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26'],
  [
    'tokenizer_config.json',
    367,
    'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
  ],
  [
    'special_tokens_map.json',
    125,
    'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  ],
  [
    'onnx/model_quantized.onnx',
    24_010_842,
    '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
  ],
] as const);

const graniteFiles = createFileManifest([
  ['config.json', 1_215, 'ae74d55a56f779774cb9a8e63d3c2da9ae1af83c00229ffdff43d0b38407a0ee'],
  [
    'tokenizer.json',
    25_301_671,
    '51947676cae1f991fa51c6b9a24e14ee5460e5f0b9f692f13bb3159829d1592a',
  ],
  [
    'tokenizer_config.json',
    12_860,
    '6ed69389e30a8ecabfce2f9ebcdf0c908b34056f24d994340f2f216521c057d5',
  ],
  [
    'special_tokens_map.json',
    871,
    '013787ee251ff611722479197c00853b62113ad303cb0a36524231783c676c69',
  ],
  [
    'onnx/model_quantized.onnx',
    97_858_099,
    '704c1ebca5fbb7cd83ced41827658ac4c9990c64f7f2874d22b78044e5022e22',
  ],
] as const);

export const MODEL_CATALOG = {
  'bge-small-zh-v1.5': {
    code: 'bge-small-zh-v1.5',
    label: '中文轻量',
    description: '体积小、索引快，适合以中文内容为主的数据',
    languageLabel: '中文',
    repository: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781',
    dimensions: 512,
    dtype: 'q8',
    pooling: 'cls',
    queryPrefix: '',
    documentPrefix: '',
    maxTokens: 512,
    defaultThreshold: 62,
    files: bgeSmallZhFiles,
    expectedDownloadBytes: totalBytes(bgeSmallZhFiles),
  },
  'multilingual-e5-small': {
    code: 'multilingual-e5-small',
    label: '轻量快速',
    description: '适合普通 CPU 的快速中英文语义查询',
    languageLabel: '中文、英文及中英混排',
    repository: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dimensions: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxTokens: 512,
    defaultThreshold: 90,
    files: e5Files,
    expectedDownloadBytes: totalBytes(e5Files),
  },
  'granite-embedding-97m-multilingual-r2': {
    code: 'granite-embedding-97m-multilingual-r2',
    label: '均衡多语言',
    description: '在模型体积、跨语言能力和检索质量之间保持平衡',
    languageLabel: '中文、英文及多语言',
    repository: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    revision: '536a9f241cb3f02a9c5995a1e708c784bd274859',
    dimensions: 384,
    dtype: 'q8',
    pooling: 'cls',
    queryPrefix: '',
    documentPrefix: '',
    maxTokens: 512,
    defaultThreshold: 80,
    files: graniteFiles,
    expectedDownloadBytes: totalBytes(graniteFiles),
  },
  'bge-m3': {
    code: 'bge-m3',
    label: '质量优先',
    description: '适合更高质量的中英文语义查询',
    languageLabel: '中文、英文及中英混排',
    repository: 'onnx-community/bge-m3-ONNX',
    revision: '25b9af8e87a38eb120cfe87125383677b9cd309e',
    dimensions: 1024,
    dtype: 'q8',
    pooling: 'cls',
    queryPrefix: '',
    documentPrefix: '',
    maxTokens: 1024,
    defaultThreshold: 55,
    files: bgeFiles,
    expectedDownloadBytes: totalBytes(bgeFiles),
  },
} as const satisfies Record<SemanticModelCode, SemanticModelDefinition>;
