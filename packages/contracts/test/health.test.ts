import { describe, expect, it } from 'vitest';

import { healthResponseSchema, readinessResponseSchema } from '../src/index.js';

describe('system status contracts', () => {
  it('accepts the documented health response', () => {
    expect(healthResponseSchema.parse({ status: 'ok', service: 'causality-api' })).toEqual({
      status: 'ok',
      service: 'causality-api',
    });
  });

  it('accepts both readiness outcomes', () => {
    expect(readinessResponseSchema.parse({ status: 'ready', database: 'available' })).toEqual({
      status: 'ready',
      database: 'available',
    });
    expect(readinessResponseSchema.parse({ status: 'not_ready', database: 'unavailable' })).toEqual(
      { status: 'not_ready', database: 'unavailable' },
    );
  });

  it('rejects missing fields and undocumented status values', () => {
    expect(() => healthResponseSchema.parse({ status: 'ok' })).toThrow();
    expect(() =>
      readinessResponseSchema.parse({ status: 'unknown', database: 'available' }),
    ).toThrow();
    expect(() =>
      readinessResponseSchema.parse({ status: 'ready', database: 'unavailable' }),
    ).toThrow();
  });
});
