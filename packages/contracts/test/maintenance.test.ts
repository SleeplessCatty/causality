import { describe, expect, it } from 'vitest';

import {
  caseDeletionImpactSchema,
  deleteResultSchema,
  eventDeletionImpactSchema,
  relationDeletionImpactSchema,
} from '../src/index.js';

describe('deletion maintenance contracts', () => {
  it('accepts boolean-only event deletion impact', () => {
    expect(eventDeletionImpactSchema.parse({ canDelete: false, hasRelations: true })).toEqual({
      canDelete: false,
      hasRelations: true,
    });
    expect(eventDeletionImpactSchema.parse({ canDelete: true, hasRelations: false })).toEqual({
      canDelete: true,
      hasRelations: false,
    });
    expect(() =>
      eventDeletionImpactSchema.parse({
        canDelete: false,
        hasRelations: true,
        relationCount: 2,
      }),
    ).toThrow();
  });

  it('accepts relation and case impacts without association details', () => {
    expect(
      relationDeletionImpactSchema.parse({
        canDelete: true,
        hasEvents: true,
        hasCases: false,
      }),
    ).toEqual({ canDelete: true, hasEvents: true, hasCases: false });
    expect(caseDeletionImpactSchema.parse({ canDelete: true, hasRelations: true })).toEqual({
      canDelete: true,
      hasRelations: true,
    });
    expect(() =>
      relationDeletionImpactSchema.parse({
        canDelete: true,
        hasEvents: true,
        hasCases: true,
        cases: [],
      }),
    ).toThrow();
  });

  it('accepts only the permanent deletion result', () => {
    expect(deleteResultSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(() => deleteResultSchema.parse({ deleted: false })).toThrow();
  });
});
