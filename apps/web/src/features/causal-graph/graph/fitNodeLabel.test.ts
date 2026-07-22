import { describe, expect, it } from 'vitest';

import {
  fitNodeLabel,
  GRAPH_NODE_FONT_SIZE,
  GRAPH_NODE_MAX_LINES,
  GRAPH_NODE_TEXT_HEIGHT,
  GRAPH_NODE_TEXT_WIDTH,
} from './fitNodeLabel';

const measureText = (text: string, fontSize: number) =>
  Array.from(text).reduce(
    (width, character) => width + (/\p{Script=Han}/u.test(character) ? fontSize : fontSize * 0.56),
    0,
  );

describe('fitNodeLabel', () => {
  it('uses six pixels of padding on every side of the fixed-size node', () => {
    expect(GRAPH_NODE_TEXT_WIDTH).toBe(208);
    expect(GRAPH_NODE_TEXT_HEIGHT).toBe(84);
  });

  it('uses a fixed 22px font and no more than three lines', () => {
    expect(GRAPH_NODE_FONT_SIZE).toBe(22);
    expect(GRAPH_NODE_MAX_LINES).toBe(3);
    expect(fitNodeLabel('降息', measureText)).toEqual({ text: '降息', fontSize: 22 });
  });

  it('keeps a fitting mixed-language name complete', () => {
    const name = 'OPEC减产 pushes oil prices higher';
    const result = fitNodeLabel(name, measureText);

    expect(result.text.replaceAll('\n', '')).toBe(name);
    expect(result.text.split('\n').length).toBeLessThanOrEqual(GRAPH_NODE_MAX_LINES);
  });

  it('breaks a continuous Latin token without exceeding three lines', () => {
    const result = fitNodeLabel(
      'SupercalifragilisticexpialidociousWithoutAnyBreakOpportunity',
      measureText,
    );

    expect(result.fontSize).toBe(22);
    expect(result.text.split('\n')).toHaveLength(3);
    expect(result.text.endsWith('…')).toBe(true);
  });

  it('ellipsizes a 50-character CJK name within the measured third-line width', () => {
    const name = '宏'.repeat(50);
    const result = fitNodeLabel(name, measureText);
    const lines = result.text.split('\n');

    expect(result.fontSize).toBe(22);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
    expect(measureText(lines[2]!, GRAPH_NODE_FONT_SIZE)).toBeLessThanOrEqual(GRAPH_NODE_TEXT_WIDTH);
    expect(result.text.replaceAll('\n', '').length).toBeLessThan(name.length);
  });
});
