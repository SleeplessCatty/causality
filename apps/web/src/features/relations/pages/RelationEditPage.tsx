import type { RelationFormInput } from '@causality/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import {
  buildListPath,
  listFocusState,
  resolveListReturnPath,
} from '../../../shared/navigation/listReturn';
import { getAllRelationCases, getRelation, replaceRelation } from '../api/relationApi';
import { RelationForm } from '../components/RelationForm';

export function RelationEditPage() {
  const { relationId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const relation = useQuery({
    queryKey: ['relations', 'detail', relationId],
    queryFn: ({ signal }) => getRelation(relationId, signal),
    enabled: Boolean(relationId),
  });
  const linkedCases = useQuery({
    queryKey: ['cases', 'relation-associations', 'edit', relationId],
    queryFn: ({ signal }) => getAllRelationCases(relationId, signal),
    enabled: relation.isSuccess && relation.data.caseCount > 0,
  });
  const casesPending = relation.isSuccess && relation.data.caseCount > 0 && linkedCases.isPending;
  const casesError = relation.isSuccess && relation.data.caseCount > 0 && linkedCases.isError;
  const listReturnTo = resolveListReturnPath(
    location.state,
    '/relations',
    relation.data?.listPage ?? 1,
  );
  const focusState = listFocusState(relationId);

  if (relation.isPending || casesPending) return <div className="page-state">加载因果关系…</div>;
  if (relation.isError || casesError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取因果关系</strong>
        <Link className="button button--secondary" to={listReturnTo} state={focusState}>
          返回关系列表
        </Link>
      </div>
    );
  }

  async function submit(input: RelationFormInput): Promise<void> {
    const updated = await replaceRelation(relationId, input);
    queryClient.setQueryData(['relations', 'detail', relationId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['relations', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['relations', 'pair-check'] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
    ]);
    navigate(buildListPath('/relations', updated.listPage), {
      state: { notice: '修改已保存', listFocusId: updated.id },
    });
  }

  return (
    <section
      className="event-editor-page relation-editor-page"
      aria-labelledby="edit-relation-title"
    >
      <Link className="back-link" to={listReturnTo} state={focusState}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回关系列表
      </Link>
      <h1 id="edit-relation-title">编辑因果关系</h1>
      <RelationForm
        mode="edit"
        relationId={relationId}
        initialValue={{
          causeEvent: relation.data.causeEvent,
          effectEvent: relation.data.effectEvent,
          confidence: relation.data.confidence,
          description: relation.data.description,
          caseSelections: (linkedCases.data ?? []).map((item) => ({
            type: 'existing' as const,
            caseId: item.id,
            content: item.content,
          })),
        }}
        onSubmit={submit}
        cancelTo={listReturnTo}
        cancelState={focusState}
      />
    </section>
  );
}
