import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  evaluateQualityRankings,
  validateQualityFixture,
  type QualityFixture,
} from '../src/qualityBenchmark.js';

const fixture: QualityFixture = {
  documents: [
    { id: 'event-rate-rise', entityType: 'event', text: '央行提高政策利率' },
    { id: 'event-phone', entityType: 'event', text: '手机厂商发布新产品' },
  ],
  cases: [
    {
      entityType: 'event',
      query: '央行加息',
      relevantDocumentIds: ['event-rate-rise'],
      confusingDocumentIds: ['event-phone'],
    },
  ],
};

describe('semantic quality benchmark', () => {
  it('calculates reviewed top-10 hits and thresholded confusing results', () => {
    const result = evaluateQualityRankings(
      fixture,
      0.7,
      new Map([
        [
          '央行加息',
          [
            { id: 'event-rate-rise', similarity: 0.91 },
            { id: 'event-phone', similarity: 0.2 },
          ],
        ],
      ]),
    );

    expect(result).toEqual({
      queryCount: 1,
      ordinaryQueryHits: 0,
      ordinaryHitRate: 0,
      noMatchQueryCount: 0,
      noMatchFalsePositives: 0,
      noMatchFalsePositiveRate: 0,
      relevantCount: 1,
      relevantTop10Hits: 1,
      top10HitRate: 1,
      queryTop1Hits: 1,
      top1HitRate: 1,
      meanReciprocalRank: 1,
      confusingCount: 1,
      confusingReturned: 0,
      irrelevantResultRate: 0,
      hardNegativeOutrankCount: 0,
      hardNegativeOutrankRate: 0,
      emptyResultQueries: 0,
    });
  });

  it('counts unrelated queries that cross the configured threshold', () => {
    const fixtureWithNoMatch: QualityFixture = {
      ...fixture,
      noMatchCases: [{ entityType: 'event', query: '如何烘焙酸面包' }],
    };
    const result = evaluateQualityRankings(
      fixtureWithNoMatch,
      0.7,
      new Map([
        ['央行加息', [{ id: 'event-rate-rise', similarity: 0.91 }]],
        ['如何烘焙酸面包', [{ id: 'event-phone', similarity: 0.75 }]],
      ]),
    );

    expect(result.noMatchQueryCount).toBe(1);
    expect(result.noMatchFalsePositives).toBe(1);
    expect(result.noMatchFalsePositiveRate).toBe(1);
  });

  it('reports when a hard negative outranks the relevant result', () => {
    const result = evaluateQualityRankings(
      fixture,
      0.7,
      new Map([
        [
          '央行加息',
          [
            { id: 'event-phone', similarity: 0.92 },
            { id: 'event-rate-rise', similarity: 0.91 },
          ],
        ],
      ]),
    );

    expect(result.top1HitRate).toBe(0);
    expect(result.meanReciprocalRank).toBe(0.5);
    expect(result.hardNegativeOutrankRate).toBe(1);
  });

  it('rejects missing and cross-type fixture references', () => {
    expect(() =>
      validateQualityFixture({
        ...fixture,
        cases: [
          {
            entityType: 'case',
            query: '央行加息',
            relevantDocumentIds: ['event-rate-rise'],
            confusingDocumentIds: ['missing'],
          },
        ],
      }),
    ).toThrow(/fixture/i);
  });

  it('keeps the Chinese finance fixture balanced and reference-safe', async () => {
    const fixtureUrl = new URL('./fixtures/semantic-quality-zh-finance.json', import.meta.url);
    const financeFixture = validateQualityFixture(JSON.parse(await readFile(fixtureUrl, 'utf8')));

    expect(financeFixture.documents).toHaveLength(60);
    expect(financeFixture.cases).toHaveLength(45);
    expect(financeFixture.noMatchCases).toHaveLength(12);
    expect(
      Object.fromEntries(
        ['event', 'relation', 'case'].map((entityType) => [
          entityType,
          financeFixture.documents.filter((document) => document.entityType === entityType).length,
        ]),
      ),
    ).toEqual({ event: 20, relation: 20, case: 20 });
  });

  it('keeps the general causality fixture balanced and reference-safe', async () => {
    const fixtureUrl = new URL('./fixtures/semantic-quality-general.json', import.meta.url);
    const generalFixture = validateQualityFixture(JSON.parse(await readFile(fixtureUrl, 'utf8')));

    expect(generalFixture.documents).toHaveLength(54);
    expect(generalFixture.cases).toHaveLength(45);
    expect(generalFixture.noMatchCases).toHaveLength(6);
    expect(
      Object.fromEntries(
        ['event', 'relation', 'case'].map((entityType) => [
          entityType,
          generalFixture.documents.filter((document) => document.entityType === entityType).length,
        ]),
      ),
    ).toEqual({ event: 18, relation: 18, case: 18 });
  });
});
