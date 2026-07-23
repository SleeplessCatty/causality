import { describe, expect, it } from 'vitest';

import { parseSmokeModelCode } from '../src/smokeArguments.js';

describe('parseSmokeModelCode', () => {
  it('accepts the pnpm script separator before a pinned model code', () => {
    expect(parseSmokeModelCode(['--', 'multilingual-e5-small'])).toBe('multilingual-e5-small');
  });

  it('rejects missing and arbitrary model codes', () => {
    expect(() => parseSmokeModelCode([])).toThrow(/model code/i);
    expect(() => parseSmokeModelCode(['arbitrary/model'])).toThrow(/model code/i);
  });
});
