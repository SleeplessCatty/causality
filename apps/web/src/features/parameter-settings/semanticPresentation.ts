import type { SemanticIndexStatus, SemanticModel, SemanticTask } from '@causality/contracts';

interface SemanticBadge {
  label: string;
  tone: 'neutral' | 'positive' | 'negative' | 'working';
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatMegabytes(bytes: number): string {
  return `约 ${Math.round(bytes / 1024 / 1024)} MB`;
}

export function formatSemanticDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

export function isActiveSemanticTask(task: SemanticTask | null): boolean {
  return task?.status === 'queued' || task?.status === 'running';
}

export function downloadStatus(model: SemanticModel): SemanticBadge {
  if (model.downloadStatus === 'downloading') return { label: '下载中', tone: 'working' };
  if (model.downloadStatus === 'verifying') return { label: '正在校验', tone: 'working' };
  if (model.downloadStatus === 'failed') return { label: '下载失败', tone: 'negative' };
  return model.downloadStatus === 'downloaded'
    ? { label: '已下载', tone: 'positive' }
    : { label: '未下载', tone: 'neutral' };
}

export function availabilityStatus(
  model: SemanticModel,
  indexStatus: SemanticIndexStatus,
): SemanticBadge {
  return model.isActive && (indexStatus === 'ready' || indexStatus === 'updating')
    ? { label: '可用', tone: 'positive' }
    : { label: '暂不可用', tone: 'neutral' };
}

export function modelIndexStatus(
  model: SemanticModel,
  indexStatus: SemanticIndexStatus,
): SemanticBadge {
  if (!model.isActive) return { label: '无当前索引', tone: 'neutral' };
  if (indexStatus === 'waiting_model') return { label: '等待索引', tone: 'working' };
  if (indexStatus === 'loading') return { label: '索引加载中', tone: 'working' };
  if (indexStatus === 'building') return { label: '索引生成中', tone: 'working' };
  if (indexStatus === 'updating') return { label: '索引更新中', tone: 'working' };
  if (indexStatus === 'ready') return { label: '索引就绪', tone: 'positive' };
  if (indexStatus === 'failed') return { label: '索引失败', tone: 'negative' };
  return { label: '索引为空', tone: 'neutral' };
}
