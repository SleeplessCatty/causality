import type {
  SemanticAction,
  SemanticModelFileStatus,
  SemanticModelLifecycle,
  SemanticModelStage,
} from '@causality/contracts';

export interface SemanticBadge {
  label: string;
  tone: 'neutral' | 'positive' | 'negative' | 'working';
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const megabyteFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
});
const BYTES_PER_MEGABYTE = 1_000_000;

const actionLabels: Record<SemanticAction, string> = {
  download_and_use: '下载并使用',
  use: '使用此模型',
  retry_download: '重试下载',
  redownload_and_use: '重新下载并使用',
  retry_load: '重试加载',
  retry_full_index: '重试全量索引',
  reindex: '重新索引',
};

const stageLabels: Record<SemanticModelStage, SemanticBadge> = {
  not_downloaded: { label: '索引未建', tone: 'neutral' },
  download_queued: { label: '索引未建', tone: 'neutral' },
  downloading: { label: '索引未建', tone: 'neutral' },
  verifying: { label: '索引未建', tone: 'neutral' },
  downloaded: { label: '索引未建', tone: 'neutral' },
  invalid: { label: '索引不可用', tone: 'negative' },
  loading: { label: '索引准备中', tone: 'working' },
  index_queued: { label: '索引等待中', tone: 'working' },
  building: { label: '索引生成中', tone: 'working' },
  ready: { label: '索引就绪', tone: 'positive' },
  updating: { label: '索引同步中', tone: 'working' },
  incomplete: { label: '索引不完整', tone: 'negative' },
  failed: { label: '索引不可用', tone: 'negative' },
};

const fileLabels: Record<SemanticModelFileStatus, SemanticBadge> = {
  not_downloaded: { label: '文件未下载', tone: 'neutral' },
  download_queued: { label: '文件待下载', tone: 'working' },
  downloading: { label: '文件下载中', tone: 'working' },
  verifying: { label: '文件校验中', tone: 'working' },
  downloaded: { label: '文件已下载', tone: 'positive' },
  invalid: { label: '文件失效', tone: 'negative' },
  failed: { label: '文件下载失败', tone: 'negative' },
};

function toMegabytes(bytes: number): number {
  return bytes / BYTES_PER_MEGABYTE;
}

export function formatMegabytesWithUpToOneDecimal(bytes: number): string {
  return `${megabyteFormatter.format(toMegabytes(bytes))} MB`;
}

export function formatApproximateMegabytes(bytes: number): string {
  return `约 ${Math.round(toMegabytes(bytes))} MB`;
}

export function formatSemanticDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

export function semanticActionLabel(action: SemanticAction): string {
  return actionLabels[action];
}

export function semanticFileBadge(model: SemanticModelLifecycle): SemanticBadge {
  return fileLabels[model.fileState];
}

export function semanticRoleBadge(model: SemanticModelLifecycle): SemanticBadge {
  return model.role === 'current'
    ? { label: '当前模型', tone: 'positive' }
    : { label: '候选模型', tone: 'neutral' };
}

export function semanticStageBadge(model: SemanticModelLifecycle): SemanticBadge {
  return stageLabels[model.stage];
}
