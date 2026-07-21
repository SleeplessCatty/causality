import type { CaseFormInput } from '@causality/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import { createCase } from '../api/caseApi';
import { CaseForm } from '../components/CaseForm';

export function CaseCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(input: CaseFormInput): Promise<void> {
    const created = await createCase(input);
    queryClient.setQueryData(['cases', 'detail', created.id], created);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cases', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'candidates'] }),
    ]);
    navigate(`/cases/${created.id}`, { state: { notice: '案例已创建' } });
  }

  return (
    <section className="event-editor-page" aria-labelledby="create-case-title">
      <Link className="back-link" to="/cases">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回案例列表
      </Link>
      <h1 id="create-case-title">创建具体案例</h1>
      <CaseForm mode="create" initialContent="" onSubmit={submit} cancelTo="/cases" />
    </section>
  );
}
