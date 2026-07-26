import type { SemanticWorkerStatus } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';

import { getHealth, getReadiness, getSemanticWorkerStatus } from './systemStatusApi';

type StatusTone = 'neutral' | 'positive' | 'negative';

interface StatusValueProps {
  label: string;
  tone: StatusTone;
}

function StatusValue({ label, tone }: StatusValueProps) {
  return (
    <span className={`status-value status-value--${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function semanticWorkerStatus(worker: {
  isPending: boolean;
  data: SemanticWorkerStatus | undefined;
}): StatusValueProps {
  if (worker.isPending) return { label: '检查中', tone: 'neutral' };
  if (!worker.data || worker.data.status === 'unreachable') {
    return { label: '无法连接', tone: 'negative' };
  }
  if (worker.data.modelState === 'idle') {
    return { label: '正常·未加载模型', tone: 'positive' };
  }
  if (worker.data.modelState === 'preparing') {
    return { label: '正常·正在准备当前模型', tone: 'neutral' };
  }
  if (worker.data.modelState === 'loaded') {
    return { label: '正常·已加载当前模型', tone: 'positive' };
  }
  if (worker.data.modelState === 'mismatch') {
    return { label: '异常·加载模型与当前配置不一致', tone: 'negative' };
  }
  return { label: '异常·当前模型未加载', tone: 'negative' };
}

export function SystemStatus() {
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: ({ signal }) => getHealth(signal),
  });
  const readiness = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
  });
  const worker = useQuery({
    queryKey: ['system', 'semantic-worker'],
    queryFn: ({ signal }) => getSemanticWorkerStatus(signal),
  });
  const apiStatus: StatusValueProps = health.isPending
    ? { label: '检查中', tone: 'neutral' }
    : health.isSuccess
      ? { label: '正常', tone: 'positive' }
      : { label: '无法连接', tone: 'negative' };

  const databaseStatus: StatusValueProps = readiness.isPending
    ? { label: '检查中', tone: 'neutral' }
    : readiness.data?.status === 'ready'
      ? { label: '就绪', tone: 'positive' }
      : { label: '数据库不可用', tone: 'negative' };
  const workerStatus = semanticWorkerStatus(worker);

  const isChecking = health.isFetching || readiness.isFetching || worker.isFetching;

  function retry(): void {
    void Promise.all([health.refetch(), readiness.refetch(), worker.refetch()]);
  }

  return (
    <section className="status-card" aria-labelledby="system-status-title">
      <div className="status-card__heading">
        <div>
          <p className="eyebrow">运行环境</p>
          <h2 id="system-status-title">系统状态</h2>
        </div>
        <button type="button" onClick={retry} disabled={isChecking}>
          {isChecking ? '检查中…' : '重新检查'}
        </button>
      </div>

      <div className="status-list" aria-live="polite">
        <div className="status-row">
          <div>
            <strong>API 服务</strong>
            <span>Fastify 应用服务</span>
          </div>
          <StatusValue {...apiStatus} />
        </div>
        <div className="status-row">
          <div>
            <strong>PostgreSQL</strong>
            <span>数据存储连接</span>
          </div>
          <StatusValue {...databaseStatus} />
        </div>
        <div className="status-row status-row--semantic-worker">
          <div>
            <strong>Semantic Worker</strong>
            <span>语义模型运行服务</span>
          </div>
          <StatusValue {...workerStatus} />
        </div>
      </div>
    </section>
  );
}
