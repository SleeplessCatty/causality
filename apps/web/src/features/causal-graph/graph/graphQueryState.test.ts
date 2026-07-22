import { describe, expect, it } from 'vitest';

import {
  graphCaseCountOptions,
  graphConfidenceOptions,
  graphLimitOptions,
  parseGraphQueryState,
  toGraphSearchParams,
} from './graphQueryState';

const centerEventId = '11111111-1111-4111-8111-111111111111';

describe('graphQueryState', () => {
  it('parses and serializes all supported query parameters in stable order', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(
        `centerEventId=${centerEventId}&direction=downstream&limit=50&minConfidence=60&minCaseCount=2`,
      ),
    );

    expect(parsed).toEqual({
      state: {
        centerEventId,
        direction: 'downstream',
        limit: 50,
        minConfidence: 60,
        minCaseCount: 2,
      },
      needsCanonicalization: false,
    });
    expect(toGraphSearchParams(parsed.state).toString()).toBe(
      `centerEventId=${centerEventId}&direction=downstream&limit=50&minConfidence=60&minCaseCount=2`,
    );
  });

  it('canonicalizes unsupported URL values to safe defaults', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(
        `centerEventId=${centerEventId}&direction=sideways&limit=75&minConfidence=101&minCaseCount=-1`,
      ),
    );

    expect(parsed.state).toEqual({
      centerEventId,
      direction: 'both',
      limit: 20,
      minConfidence: 100,
      minCaseCount: 0,
    });
    expect(parsed.needsCanonicalization).toBe(true);
  });

  it('normalizes URL filters to the selectable discrete options', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(`centerEventId=${centerEventId}&minConfidence=25&minCaseCount=99`),
    );

    expect(parsed.state).toMatchObject({ minConfidence: 20, minCaseCount: 10 });
    expect(graphLimitOptions).toEqual([20, 50, 100]);
    expect(graphConfidenceOptions).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(graphCaseCountOptions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps an empty graph URL empty while exposing safe defaults', () => {
    const parsed = parseGraphQueryState(new URLSearchParams());
    expect(parsed.state).toEqual({
      centerEventId: '',
      direction: 'both',
      limit: 20,
      minConfidence: 0,
      minCaseCount: 0,
    });
    expect(parsed.needsCanonicalization).toBe(false);
    expect(toGraphSearchParams(parsed.state).toString()).toBe('');
  });
});
