import type { EventFormInput } from '@causality/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import { createEvent } from '../api/eventApi';
import { EventForm } from '../components/EventForm';

const emptyEvent: EventFormInput = { name: '', description: null, aliases: [], keywords: [] };

export function EventCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(input: EventFormInput): Promise<void> {
    const event = await createEvent(input);
    queryClient.setQueryData(['events', 'detail', event.id], event);
    await queryClient.invalidateQueries({ queryKey: ['events', 'list'] });
    navigate(`/events/${event.id}`, { state: { notice: '事件已创建' } });
  }

  return (
    <section className="event-editor-page" aria-labelledby="create-event-title">
      <Link className="back-link" to="/events">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回事件列表
      </Link>
      <h1 id="create-event-title">创建原子事件</h1>
      <EventForm mode="create" initialValue={emptyEvent} onSubmit={submit} cancelTo="/events" />
    </section>
  );
}
