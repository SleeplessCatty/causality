import { describe, expect, it } from 'vitest';

import { fitNodeLabel } from './fitNodeLabel';

const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.56;

describe('fitNodeLabel', () => {
  it.each([
    '原油价格持续快速上涨导致能源企业成本承压',
    'Central bank unexpectedly tightens monetary policy',
    'OPEC减产 pushes global crude oil prices higher',
    'SupercalifragilisticexpialidociousWithoutAnyBreakOpportunity',
    '宏'.repeat(120),
  ])('keeps every character for %s', (name) => {
    const result = fitNodeLabel(name, measureText);

    expect(result.text.replaceAll('\n', '').replaceAll(' ', '')).toBe(name.replaceAll(' ', ''));
    expect([14, 12, 10, 9]).toContain(result.fontSize);
  });

  it('uses the largest fitting size for a short name', () => {
    expect(fitNodeLabel('降息', measureText)).toEqual({ text: '降息', fontSize: 14 });
  });
});
