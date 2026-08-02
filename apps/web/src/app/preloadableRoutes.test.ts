import { describe, expect, it, vi } from 'vitest';

import { createPreloadableRoute } from './preloadableRoutes';

describe('createPreloadableRoute', () => {
  it('deduplicates preload and load calls around one module promise', async () => {
    const importer = vi.fn(async () => ({ value: 'module' }));
    const route = createPreloadableRoute(importer);

    await Promise.all([route.preload(), route.preload(), route.load()]);

    expect(importer).toHaveBeenCalledOnce();
    await expect(route.load()).resolves.toEqual({ value: 'module' });
    expect(importer).toHaveBeenCalledOnce();
  });

  it('clears a rejected module promise so a later load can retry', async () => {
    const importer = vi
      .fn<() => Promise<{ value: string }>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ value: 'module' });
    const route = createPreloadableRoute(importer);

    await expect(route.load()).rejects.toThrow('network');
    await expect(route.load()).resolves.toEqual({ value: 'module' });
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
