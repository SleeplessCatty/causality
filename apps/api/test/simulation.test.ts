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
    expect(first.relations).toEqual(second.relations);
    expect(Array.from(first.cases())).toEqual(Array.from(second.cases()));
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

  it('binds every case to a relation and keeps chronological time order', () => {
    const plan = buildSimulationPlan(options, 'case-batch');
    const relationIds = new Set(plan.relations.map((relation) => relation.id));
    const cases = Array.from(plan.cases());

    expect(cases).toHaveLength(30);
    for (const causalCase of cases) {
      expect(relationIds.has(causalCase.causalRelationId)).toBe(true);
      expect(causalCase.effectOccurredAt.getTime()).toBeGreaterThanOrEqual(
        causalCase.causeOccurredAt.getTime(),
      );
    }
  });

  it('creates unique, filesystem-safe batch identifiers', () => {
    const first = createSimulationBatchId();
    const second = createSimulationBatchId();

    expect(first).toMatch(/^\d{8}t\d{6}-[a-f0-9]{8}$/);
    expect(second).not.toBe(first);
  });
});
