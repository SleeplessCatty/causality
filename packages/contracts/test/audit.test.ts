import { describe, expect, it } from 'vitest';

import {
  auditActionSchema,
  auditActions,
  auditResultSchema,
  auditTargetTypeSchema,
} from '../src/index.js';

describe('audit contracts', () => {
  it('accepts every planned audit action and rejects unregistered actions', () => {
    for (const action of auditActions) {
      expect(auditActionSchema.parse(action)).toBe(action);
    }
    expect(auditActionSchema.safeParse('event.read').success).toBe(false);
    expect(auditActionSchema.parse('mcp_token.deleted')).toBe('mcp_token.deleted');
  });

  it('limits audit results and targets to the shared finite catalogs', () => {
    expect(auditResultSchema.options).toEqual(['success', 'failure', 'conflict']);
    expect(auditTargetTypeSchema.safeParse('user').success).toBe(true);
    expect(auditTargetTypeSchema.safeParse('password').success).toBe(false);
  });
});
