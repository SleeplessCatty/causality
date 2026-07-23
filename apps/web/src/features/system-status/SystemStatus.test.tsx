import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { SystemStatus } from './SystemStatus';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderStatus() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <SystemStatus />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('SystemStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only shows runtime health and restores the original retry action', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderStatus();

    expect(await screen.findByText('正常')).toBeTruthy();
    expect(screen.getByText('就绪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy();
    expect(screen.queryByText('数据检查')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/data-checks'))).toBe(
      false,
    );
  });

  it('refetches both runtime statuses without starting data maintenance', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderStatus();
    await screen.findByText('正常');

    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/data-checks'))).toBe(
      false,
    );
  });
});
