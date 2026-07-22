import { describe, expect, it } from 'vitest';

import {
  buildSimulationPlan,
  createSimulationBatchId,
  parseSimulationArguments,
} from '../src/database/test-data/simulatedData.js';

describe('simulation arguments', () => {
  it('uses the documented defaults', () => {
    expect(parseSimulationArguments([])).toEqual({
      events: 1_000,
      relations: 3_000,
      cases: 10_000,
      seed: 20_260_720,
    });
  });

  it('accepts valid integer overrides including zero cases', () => {
    expect(
      parseSimulationArguments(['--events=2', '--relations=2', '--cases=0', '--seed=-42']),
    ).toEqual({ events: 2, relations: 2, cases: 0, seed: -42 });
  });

  it('accepts the standalone separator forwarded by pnpm scripts', () => {
    expect(
      parseSimulationArguments(['--', '--events=10', '--relations=20', '--cases=30', '--seed=42']),
    ).toEqual({ events: 10, relations: 20, cases: 30, seed: 42 });
  });

  it.each([
    ['--events=1'],
    ['--events=100001'],
    ['--relations=0'],
    ['--relations=500001'],
    ['--cases=-1'],
    ['--cases=1000001'],
    ['--seed=1.5'],
    ['--unknown=1'],
  ])('rejects invalid argument %s', (argument) => {
    expect(() => parseSimulationArguments([argument])).toThrow('Invalid simulation arguments');
  });

  it('rejects an impossible directed relation count before generation', () => {
    expect(() => parseSimulationArguments(['--events=2', '--relations=3'])).toThrow(
      'at most 2 directed relations',
    );
  });
});

describe('simulation plan', () => {
  const options = { events: 8, relations: 20, cases: 30, seed: 42 };

  it('is deterministic for the same seed and batch identifier', () => {
    const first = buildSimulationPlan(options, 'test-batch');
    const second = buildSimulationPlan(options, 'test-batch');

    expect(first.events).toEqual(second.events);
    expect(first.keywords).toEqual(second.keywords);
    expect(first.relations).toEqual(second.relations);
    expect(Array.from(first.cases())).toEqual(Array.from(second.cases()));
    expect(Array.from(first.caseLinks())).toEqual(Array.from(second.caseLinks()));
  });

  it('creates two ordered keywords for every simulated event', () => {
    const plan = buildSimulationPlan(options, 'keyword-batch');
    const byEvent = new Map<string, typeof plan.keywords>();
    for (const keyword of plan.keywords) {
      const values = byEvent.get(keyword.eventId) ?? [];
      values.push(keyword);
      byEvent.set(keyword.eventId, values);
    }

    expect(plan.keywords).toHaveLength(options.events * 2);
    for (const event of plan.events) {
      expect(byEvent.get(event.id!)).toMatchObject([{ position: 1 }, { position: 2 }]);
    }
  });

  it('creates no self loops or duplicate directed relations', () => {
    const plan = buildSimulationPlan(options, 'integrity-batch');
    const directions = new Set<string>();

    for (const relation of plan.relations) {
      expect(relation.causeEventId).not.toBe(relation.effectEventId);
      const direction = `${relation.causeEventId}:${relation.effectEventId}`;
      expect(directions.has(direction)).toBe(false);
      directions.add(direction);
    }
  });

  it('creates independent cases with zero, one, and multiple relation links', () => {
    const plan = buildSimulationPlan(options, 'case-batch');
    const relationIds = new Set(plan.relations.map((relation) => relation.id));
    const cases = Array.from(plan.cases());
    const caseIds = new Set(cases.map((causalCase) => causalCase.id));
    const links = Array.from(plan.caseLinks());
    const linkCounts = new Map<string, number>();

    expect(cases).toHaveLength(30);
    for (const causalCase of cases) {
      expect(causalCase.content.length).toBeLessThanOrEqual(100);
    }
    for (const link of links) {
      expect(relationIds.has(link.causalRelationId)).toBe(true);
      expect(caseIds.has(link.concreteCaseId)).toBe(true);
      linkCounts.set(link.concreteCaseId, (linkCounts.get(link.concreteCaseId) ?? 0) + 1);
    }
    const counts = cases.map((causalCase) => linkCounts.get(causalCase.id!) ?? 0);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts.some((count) => count > 1)).toBe(true);
    expect(links).toHaveLength(28);
  });

  it.each([
    ['zero cases', { events: 2, relations: 1, cases: 0, seed: 42 }, 0],
    ['the default 10,000 cases', parseSimulationArguments([]), 9_333],
    [
      'the maximum 1,000,000 cases',
      { events: 2, relations: 2, cases: 1_000_000, seed: 42 },
      933_333,
    ],
  ])('counts generated case links for %s without inserting them', (_label, input, expected) => {
    let count = 0;
    const links = buildSimulationPlan(input, 'count-batch').caseLinks();
    while (!links.next().done) count += 1;
    expect(count).toBe(expected);
  });

  it('creates unique, filesystem-safe batch identifiers', () => {
    const first = createSimulationBatchId();
    const second = createSimulationBatchId();

    expect(first).toMatch(/^\d{8}t\d{6}-[a-f0-9]{8}$/);
    expect(second).not.toBe(first);
  });
});
