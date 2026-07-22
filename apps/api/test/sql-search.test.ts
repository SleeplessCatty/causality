import { describe, expect, it } from 'vitest';

import { escapeLikePattern, normalizeSearchQuery } from '../src/features/shared/sqlSearch.js';

describe('SQL search helpers', () => {
  it.each([
    ['  Interest RATE  ', 'interest rate'],
    ['  中文搜索  ', '中文搜索'],
    ['MiXeD Case', 'mixed case'],
  ])('normalizes %j to %j', (query, expected) => {
    expect(normalizeSearchQuery(query)).toBe(expected);
  });

  it.each([
    ['plain', 'plain'],
    ['path\\segment', 'path\\\\segment'],
    ['100%', '100\\%'],
    ['under_score', 'under\\_score'],
    ['\\%_', '\\\\\\%\\_'],
  ])('escapes LIKE pattern %j to %j', (value, expected) => {
    expect(escapeLikePattern(value)).toBe(expected);
  });
});
