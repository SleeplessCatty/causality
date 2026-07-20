import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { SystemStatus } from './SystemStatus';

function renderStatus() {
  return render(
    <AppProviders>
      <SystemStatus />
    </AppProviders>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('SystemStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows checking while requests are pending', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );

    renderStatus();

    expect(screen.getAllByText('检查中')).toHaveLength(2);
  });

  it('shows normal API and ready PostgreSQL states', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith('/api/health')
        ? jsonResponse({ status: 'ok', service: 'causality-api' })
        : jsonResponse({ status: 'ready', database: 'available' });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderStatus();

    expect(await screen.findByText('正常')).toBeTruthy();
    expect(await screen.findByText('就绪')).toBeTruthy();
  });

  it('shows connection failure when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    renderStatus();

    expect(await screen.findByText('无法连接')).toBeTruthy();
  });

  it('shows unavailable when PostgreSQL readiness returns 503', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith('/api/health')
        ? jsonResponse({ status: 'ok', service: 'causality-api' })
        : jsonResponse({ status: 'not_ready', database: 'unavailable' }, 503);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderStatus();

    expect(await screen.findByText('数据库不可用')).toBeTruthy();
  });

  it('requests both statuses again when retry is clicked', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith('/api/health')
        ? jsonResponse({ status: 'ok', service: 'causality-api' })
        : jsonResponse({ status: 'ready', database: 'available' });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderStatus();
    expect(await screen.findByText('就绪')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
