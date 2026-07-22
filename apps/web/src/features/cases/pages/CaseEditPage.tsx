import type { CaseFormInput } from '@causality/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import { getCase, replaceCase } from '../api/caseApi';
import { CaseForm } from '../components/CaseForm';

export function CaseEditPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['cases', 'detail', caseId],
    queryFn: ({ signal }) => getCase(caseId, signal),
    enabled: Boolean(caseId),
  });

  if (detail.isPending) return <div className="page-state">加载案例…</div>;
  if (detail.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取案例</strong>
        <Link className="button button--secondary" to="/cases">
          返回案例列表
        </Link>
      </div>
    );
  }

  async function submit(input: CaseFormInput): Promise<void> {
    const updated = await replaceCase(caseId, input);
    queryClient.setQueryData(['cases', 'detail', caseId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cases', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['relations'] }),
    ]);
    navigate('/cases', { state: { notice: '修改已保存' } });
  }

  return (
    <section className="event-editor-page" aria-labelledby="edit-case-title">
      <Link className="back-link" to="/cases">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回案例列表
      </Link>
      <h1 id="edit-case-title">编辑具体案例</h1>
      {detail.data.relationCount > 0 ? (
        <div className="case-edit-notice">
          修改会同步影响当前案例所关联的 {detail.data.relationCount} 条因果关系中的显示内容。
        </div>
      ) : null}
      <CaseForm
        mode="edit"
        initialContent={detail.data.content}
        onSubmit={submit}
        cancelTo="/cases"
      />
    </section>
  );
}
