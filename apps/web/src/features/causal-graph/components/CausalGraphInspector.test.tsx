import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEvent } from '../../events/api/eventApi';
import { getRelation } from '../../relations/api/relationApi';
import { CausalGraphInspector } from './CausalGraphInspector';

vi.mock('../../events/api/eventApi', () => ({ getEvent: vi.fn() }));
vi.mock('../../relations/api/relationApi', () => ({ getRelation: vi.fn() }));

const eventId = '11111111-1111-4111-8111-111111111111';
const relationId = '33333333-3333-4333-8333-333333333333';

const eventDetail = {
  id: eventId,
  name: '原油价格上涨',
  description: '国际原油价格持续上涨',
  aliases: ['油价上涨'],
  keywords: ['能源', '成本'],
  relationCount: 0,
  listPage: 1,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const relationDetail = {
  id: relationId,
  causeEvent: { id: eventId, name: '原油价格上涨' },
  effectEvent: {
    id: '22222222-2222-4222-8222-222222222222',
    name: '航空公司成本上升',
  },
  confidence: 80,
  caseCount: 6,
  listPage: 1,
  description: '能源成本向航空业传导',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  recentCases: [{ id: '44444444-4444-4444-8444-444444444444', content: '2026年航空燃油成本上升' }],
};

function renderInspector(props: Partial<ComponentProps<typeof CausalGraphInspector>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CausalGraphInspector
          open
          selection={null}
          centerEventId={eventId}
          onClose={vi.fn()}
          onSetCenter={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CausalGraphInspector', () => {
  beforeEach(() => {
    vi.mocked(getEvent).mockResolvedValue(eventDetail);
    vi.mocked(getRelation).mockResolvedValue(relationDetail);
  });

  it('only requests details when open with a selection', () => {
    renderInspector({ open: false, selection: { type: 'node', id: eventId } });
    const inspector = screen.getByRole('complementary', { hidden: true });
    expect(inspector.getAttribute('aria-hidden')).toBe('true');
    expect(inspector.classList.contains('is-open')).toBe(false);
    expect(inspector.hasAttribute('inert')).toBe(true);
    expect(getEvent).not.toHaveBeenCalled();
    expect(getRelation).not.toHaveBeenCalled();
  });

  it('shows an empty prompt while open without a selection', () => {
    renderInspector();
    const inspector = screen.getByRole('complementary');
    expect(inspector.getAttribute('aria-hidden')).toBe('false');
    expect(inspector.classList.contains('is-open')).toBe(true);
    expect(screen.getByText('请选择节点或关系')).toBeTruthy();
  });

  it('loads event details and can set a different node as center', async () => {
    const onSetCenter = vi.fn();
    renderInspector({
      centerEventId: '22222222-2222-4222-8222-222222222222',
      selection: { type: 'node', id: eventId },
      onSetCenter,
    });
    expect(await screen.findByRole('heading', { name: '原油价格上涨' })).toBeTruthy();
    expect(screen.getByText('国际原油价格持续上涨')).toBeTruthy();
    expect(screen.getByText('油价上涨')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '设为中心事件' }));
    expect(onSetCenter).toHaveBeenCalledWith(eventId);
  });

  it('loads relation details and links to all cases when more than five exist', async () => {
    renderInspector({ selection: { type: 'relation', id: relationId } });
    expect(await screen.findByText('原油价格上涨 → 航空公司成本上升')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('6 条')).toBeTruthy();
    expect(screen.getByText('2026年航空燃油成本上升')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看全部 6 条' }).getAttribute('href')).toBe(
      `/cases?relationId=${relationId}`,
    );
  });

  it('keeps boundary-length event content complete without nested tooltips', async () => {
    const longName = 'N'.repeat(50);
    const longDescription = 'D'.repeat(2_000);
    const longAlias = 'A'.repeat(80);
    const longKeyword = 'K'.repeat(50);
    vi.mocked(getEvent).mockResolvedValue({
      ...eventDetail,
      name: longName,
      description: longDescription,
      aliases: [longAlias],
      keywords: [longKeyword],
    });

    renderInspector({ selection: { type: 'node', id: eventId } });
    const inspector = screen.getByRole('complementary');
    expect(await screen.findByRole('heading', { name: longName })).toBeTruthy();
    expect(inspector.textContent).toContain(longDescription);
    expect(inspector.textContent).toContain(longAlias);
    expect(inspector.textContent).toContain(longKeyword);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
