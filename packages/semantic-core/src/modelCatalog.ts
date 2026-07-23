export const semanticModelCodes = ['multilingual-e5-small', 'bge-m3'] as const;

export type SemanticModelCode = (typeof semanticModelCodes)[number];

export interface SemanticModelFile {
  remotePath: string;
  localPath: string;
  bytes: number;
  sha256: string;
}

export interface SemanticModelDefinition {
  code: SemanticModelCode;
  label: '轻量快速' | '质量优先';
  description: string;
  languageLabel: string;
  repository: string;
  revision: string;
  dimensions: 384 | 1024;
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

export const MODEL_CATALOG = {
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
    defaultThreshold: 70,
    files: e5Files,
    expectedDownloadBytes: totalBytes(e5Files),
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
