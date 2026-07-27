import type { EventFormInput } from '@causality/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import {
  buildListPath,
  listFocusState,
  resolveRecordReturnTarget,
} from '../../../shared/navigation/listReturn';
import { getEvent, replaceEvent } from '../api/eventApi';
import { EventForm } from '../components/EventForm';

export function EventEditPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: ({ signal }) => getEvent(eventId, signal),
    enabled: Boolean(eventId),
  });
  const returnTarget = resolveRecordReturnTarget(
    location.state,
    '/events',
    event.data?.listPage ?? 1,
  );
  const listReturnTo = returnTarget.path;
  const focusState = listFocusState(eventId);

  if (event.isPending) return <div className="page-state">加载事件…</div>;
  if (event.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取事件</strong>
        <Link className="button button--secondary" to={listReturnTo} state={focusState}>
          返回事件列表
        </Link>
      </div>
    );
  }

  async function submit(input: EventFormInput): Promise<void> {
    const updated = await replaceEvent(eventId, input);
    queryClient.setQueryData(['events', 'detail', eventId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['events', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['relations', 'list'] }),
      queryClient.invalidateQueries({ queryKey: ['causal-graph'] }),
    ]);
    navigate(buildListPath('/events', updated.listPage), {
      state: { notice: '修改已保存', listFocusId: updated.id },
    });
  }

  return (
    <section className="event-editor-page" aria-labelledby="edit-event-title">
      <Link className="back-link" to={listReturnTo} state={focusState}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回事件列表
      </Link>
      <h1 id="edit-event-title">编辑原子事件</h1>
      <EventForm
        mode="edit"
        initialValue={{
          name: event.data.name,
          description: event.data.description,
          aliases: event.data.aliases,
          keywords: event.data.keywords,
        }}
        excludeId={eventId}
        onSubmit={submit}
        cancelTo={listReturnTo}
        cancelState={focusState}
      />
    </section>
  );
}
