import { describe, expect, it } from 'vitest';

import { createAppQueryClient } from './AppProviders';

describe('createAppQueryClient', () => {
  it('keeps ordinary reads fresh for thirty seconds', () => {
    const client = createAppQueryClient();

    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
  });
});
