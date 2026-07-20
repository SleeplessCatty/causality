import { useQuery } from '@tanstack/react-query';

import { getHealth, getReadiness } from './systemStatusApi';

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

export function SystemStatus() {
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: ({ signal }) => getHealth(signal),
  });
  const readiness = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
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

  const isChecking = health.isFetching || readiness.isFetching;

  function retry(): void {
    void Promise.all([health.refetch(), readiness.refetch()]);
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
      </div>
    </section>
  );
}
