import { describe, expect, it } from 'vitest';

import { fitNodeLabel } from './fitNodeLabel';

const measureText = (text: string, fontSize: number) =>
  Array.from(text).reduce(
    (width, character) => width + (/\p{Script=Han}/u.test(character) ? fontSize : fontSize * 0.56),
    0,
  );

describe('fitNodeLabel', () => {
  it.each([
    '原油价格持续快速上涨导致能源企业成本承压',
    'Central bank unexpectedly tightens monetary policy',
    'OPEC减产 pushes global crude oil prices higher',
    'SupercalifragilisticexpialidociousWithoutAnyBreakOpportunity',
    '宏'.repeat(50),
  ])('keeps every character for %s', (name) => {
    const result = fitNodeLabel(name, measureText);

    expect(result.text.replaceAll('\n', '')).toBe(name);
    expect([16, 15, 14, 13, 12, 11, 10, 9]).toContain(result.fontSize);
  });

  it('preserves repeated internal whitespace while wrapping', () => {
    const name = 'Central  bank unexpectedly   tightens policy';
    const result = fitNodeLabel(name, measureText);

    expect(result.text.replaceAll('\n', '')).toBe(name);
  });

  it('uses the largest fitting size for a short name', () => {
    expect(fitNodeLabel('降息', measureText)).toEqual({ text: '降息', fontSize: 16 });
  });

  it('selects the largest fitting size for a 50-character event name', () => {
    const name = '宏'.repeat(50);
    const result = fitNodeLabel(name, measureText);

    expect(result.fontSize).toBe(15);
    expect(result.text.replaceAll('\n', '')).toBe(name);
  });
});
