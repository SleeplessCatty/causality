import { createHash, randomUUID } from 'node:crypto';

import type {
  abstractEvents,
  causalRelationCases,
  causalRelations,
  concreteCases,
  eventAliases,
} from '../schema/index.js';

export interface SimulationOptions {
  events: number;
  relations: number;
  cases: number;
  seed: number;
}

type SimulatedEvent = typeof abstractEvents.$inferInsert;
type SimulatedAlias = typeof eventAliases.$inferInsert;
type SimulatedRelation = typeof causalRelations.$inferInsert;
type SimulatedCase = typeof concreteCases.$inferInsert;
type SimulatedCaseLink = typeof causalRelationCases.$inferInsert;

export interface SimulationPlan {
  events: SimulatedEvent[];
  aliases: SimulatedAlias[];
  relations: SimulatedRelation[];
  cases: () => IterableIterator<SimulatedCase>;
  caseLinks: () => IterableIterator<SimulatedCaseLink>;
}

const defaults: SimulationOptions = {
  events: 1_000,
  relations: 3_000,
  cases: 10_000,
  seed: 20_260_720,
};

const ranges = {
  events: { minimum: 2, maximum: 100_000 },
  relations: { minimum: 1, maximum: 500_000 },
  cases: { minimum: 0, maximum: 1_000_000 },
  seed: { minimum: -2_147_483_648, maximum: 2_147_483_647 },
} as const;

export function parseSimulationArguments(args: string[]): SimulationOptions {
  const values = { ...defaults };

  for (const argument of args) {
    if (argument === '--') continue;
    const match = /^--(events|relations|cases|seed)=(-?\d+)$/.exec(argument);
    if (!match) throw new Error('Invalid simulation arguments');

    const key = match[1] as keyof SimulationOptions;
    const value = Number(match[2]);
    const range = ranges[key];
    if (!Number.isSafeInteger(value) || value < range.minimum || value > range.maximum) {
      throw new Error('Invalid simulation arguments');
    }
    values[key] = value;
  }

  const maximumDirections = values.events * (values.events - 1);
  if (values.relations > maximumDirections) {
    throw new Error(
      `Invalid simulation arguments: ${values.events} events support at most ${maximumDirections} directed relations`,
    );
  }

  return values;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createSimulationBatchId(): string {
  const iso = new Date().toISOString();
  const timestamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}t${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
  return `${timestamp}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

function buildDirections(
  eventCount: number,
  relationCount: number,
  random: () => number,
): Array<[number, number]> {
  const directions: Array<[number, number]> = [];
  const seen = new Set<string>();
  let attempts = 0;
  const randomAttemptLimit = Math.max(relationCount * 20, 100);

  while (directions.length < relationCount && attempts < randomAttemptLimit) {
    attempts += 1;
    const cause = Math.floor(random() * eventCount);
    const effect = Math.floor(random() * eventCount);
    const key = `${cause}:${effect}`;
    if (cause === effect || seen.has(key)) continue;
    seen.add(key);
    directions.push([cause, effect]);
  }

  for (let cause = 0; cause < eventCount && directions.length < relationCount; cause += 1) {
    for (let effect = 0; effect < eventCount && directions.length < relationCount; effect += 1) {
      const key = `${cause}:${effect}`;
      if (cause === effect || seen.has(key)) continue;
      seen.add(key);
      directions.push([cause, effect]);
    }
  }

  return directions;
}

export function buildSimulationPlan(options: SimulationOptions, batchId: string): SimulationPlan {
  const random = createSeededRandom(options.seed);
  const events = Array.from({ length: options.events }, (_, index) => ({
    id: deterministicUuid(`${batchId}:event:${index}`),
    name: `SIM-${batchId}-事件-${index + 1}`,
    description: `模拟原子事件 ${index + 1}，仅用于开发和性能测试。`,
    keywords: [`模拟事件${index + 1}`, `批次${batchId}`],
  }));
  const aliases = events.map((event, index) => ({
    id: deterministicUuid(`${batchId}:alias:${index}`),
    eventId: event.id!,
    alias: `SIM-${batchId}-E${index + 1}`,
  }));
  const directions = buildDirections(options.events, options.relations, random);
  const relations = directions.map(([cause, effect], index) => ({
    id: deterministicUuid(`${batchId}:relation:${index}`),
    causeEventId: events[cause]!.id!,
    effectEventId: events[effect]!.id!,
    confidence: Math.floor(random() * 101),
    description: `模拟关系：${events[cause]!.name} → ${events[effect]!.name}`,
  }));

  return {
    events,
    aliases,
    relations,
    cases: function* cases() {
      for (let index = 0; index < options.cases; index += 1) {
        yield {
          id: deterministicUuid(`${batchId}:case:${index}`),
          content: `SIM-${batchId}-案例-${index + 1}`,
        };
      }
    },
    caseLinks: function* caseLinks() {
      const caseRandom = createSeededRandom(options.seed ^ 0x5f37_59df);
      for (let index = 0; index < options.cases; index += 1) {
        if (index % 5 === 0) continue;
        const concreteCaseId = deterministicUuid(`${batchId}:case:${index}`);
        const relationIndex = Math.floor(caseRandom() * relations.length);
        yield {
          causalRelationId: relations[relationIndex]!.id!,
          concreteCaseId,
        };
        if (index % 6 === 0 && relations.length > 1) {
          yield {
            causalRelationId: relations[(relationIndex + 1) % relations.length]!.id!,
            concreteCaseId,
          };
        }
      }
    },
  };
}
