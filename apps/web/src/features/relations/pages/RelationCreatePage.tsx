import type { RelationFormInput } from '@causality/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';

import { buildListPath, resolveListReturnPath } from '../../../shared/navigation/listReturn';
import { createRelation } from '../api/relationApi';
import { RelationForm, type RelationFormValue } from '../components/RelationForm';

const emptyRelation: RelationFormValue = {
  causeEvent: null,
  effectEvent: null,
  confidence: 10,
  description: null,
  caseSelections: [],
};

export function RelationCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cancelTo = resolveListReturnPath(location.state, '/relations', 1);

  async function submit(input: RelationFormInput): Promise<void> {
    const relation = await createRelation(input);
    queryClient.setQueryData(['relations', 'detail', relation.id], relation);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['relations', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
    ]);
    navigate(`/relations/${relation.id}`, {
      state: {
        notice: '因果关系已创建',
        listReturnPath: buildListPath('/relations', relation.listPage),
        listFocusId: relation.id,
      },
    });
  }

  return (
    <section
      className="event-editor-page relation-editor-page"
      aria-labelledby="create-relation-title"
    >
      <Link className="back-link" to={cancelTo}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回关系列表
      </Link>
      <h1 id="create-relation-title">创建因果关系</h1>
      <RelationForm
        mode="create"
        initialValue={emptyRelation}
        onSubmit={submit}
        cancelTo={cancelTo}
      />
    </section>
  );
}
