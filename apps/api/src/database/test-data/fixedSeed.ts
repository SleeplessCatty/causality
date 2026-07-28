import 'dotenv/config';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { parseEnv } from '../../config/env.js';
import { createDatabaseClient } from '../client.js';
import {
  abstractEvents,
  causalRelationCases,
  causalRelations,
  concreteCases,
  eventAliases,
  eventKeywords,
} from '../schema/index.js';
import {
  realisticCaseLocations,
  realisticSeedBridges,
  realisticSeedChains,
} from './realisticSeedData.js';

function stableId(group: number, sequence: number): string {
  return `00000000-0000-4000-${group.toString().padStart(4, '0')}-${sequence.toString().padStart(12, '0')}`;
}

const flattenedEventDefinitions = realisticSeedChains.flatMap((chain, chainIndex) =>
  chain.events.map(([name, alias], position) => ({
    name,
    alias,
    domain: chain.domain,
    topic: chain.topic,
    chainIndex,
    position,
  })),
);

const fixedEvents = flattenedEventDefinitions.map((event, index) => ({
  id: stableId(8000, index + 1),
  name: event.name,
  description: `${event.domain}领域“${event.topic}”因果链中的原子事件，表示${event.name}。`,
}));

const eventByName = new Map(fixedEvents.map((event, index) => [event.name, { event, index }]));

const fixedAliases = flattenedEventDefinitions.map((event, index) => ({
  id: stableId(8001, index + 1),
  eventId: fixedEvents[index]!.id,
  alias: event.alias,
}));

const fixedKeywords = flattenedEventDefinitions.flatMap((event, eventIndex) =>
  [event.domain, event.topic].map((keyword, keywordIndex) => ({
    id: stableId(8002, eventIndex * 2 + keywordIndex + 1),
    eventId: fixedEvents[eventIndex]!.id,
    keyword,
    position: keywordIndex + 1,
  })),
);

const chainRelationDefinitions = realisticSeedChains.flatMap((chain, chainIndex) =>
  Array.from({ length: chain.events.length - 1 }, (_, position) => {
    const cause = eventByName.get(chain.events[position]![0]);
    const effect = eventByName.get(chain.events[position + 1]![0]);
    if (!cause || !effect) throw new Error('Realistic seed chain references an unknown event');
    return {
      causeEventId: cause.event.id,
      effectEventId: effect.event.id,
      confidence: 64 + ((chainIndex * 3 + position * 7) % 31),
      description: `在${chain.topic}场景中，${cause.event.name}会促使${effect.event.name}`,
      location: chain.location,
      chainIndex,
    };
  }),
);

const bridgeRelationDefinitions = realisticSeedBridges.map((bridge) => {
  const cause = eventByName.get(bridge.cause);
  const effect = eventByName.get(bridge.effect);
  if (!cause || !effect) throw new Error('Realistic seed bridge references an unknown event');
  return {
    causeEventId: cause.event.id,
    effectEventId: effect.event.id,
    confidence: bridge.confidence,
    description: bridge.description,
    location: realisticCaseLocations[cause.index % realisticCaseLocations.length]!,
    chainIndex: Math.floor(cause.index / 5),
  };
});

// Keep the original 200-event seed at the front so existing relation and case IDs remain stable.
const legacySeedChainCount = 40;
const legacySeedChainRelationCount = legacySeedChainCount * 4;
const legacySeedRelationCount = legacySeedChainRelationCount + bridgeRelationDefinitions.length;
const relationDefinitions = [
  ...chainRelationDefinitions.slice(0, legacySeedChainRelationCount),
  ...bridgeRelationDefinitions,
  ...chainRelationDefinitions.slice(legacySeedChainRelationCount),
];

const fixedRelations = relationDefinitions.map((relation, index) => ({
  id: stableId(8100, index + 1),
  causeEventId: relation.causeEventId,
  effectEventId: relation.effectEventId,
  confidence: relation.confidence,
  baselineConfidence: relation.confidence,
  baselineCaseCount: 0,
  description: relation.description,
}));

const eventNamesById = new Map(fixedEvents.map((event) => [event.id, event.name]));
const primaryCaseTemplates = [
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${year}年${month}月，${location}在${cause}后记录到${effect}。`,
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${year}年${month}月，${location}的观察记录显示：先发生${cause}，随后出现${effect}。`,
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${location}于${year}年${month}月报告，${cause}发生后，${effect}逐渐显现。`,
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${year}年${month}月的${location}记录中，${cause}与随后发生的${effect}前后相继。`,
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${location}在${year}年${month}月观察到${cause}，之后确认${effect}。`,
  (year: number, month: number, location: string, cause: string, effect: string) =>
    `${year}年${month}月，${location}先出现${cause}，一段时间后又记录到${effect}。`,
] as const;

function primaryCase(
  relation: (typeof relationDefinitions)[number],
  relationIndex: number,
  caseSequence: number,
) {
  return {
    id: stableId(8200, caseSequence),
    relationIndex,
    content: primaryCaseTemplates[relationIndex % primaryCaseTemplates.length]!(
      2024 + (relationIndex % 2),
      (relationIndex % 12) + 1,
      relation.location,
      eventNamesById.get(relation.causeEventId)!,
      eventNamesById.get(relation.effectEventId)!,
    ),
  };
}

const legacyPrimaryCases = relationDefinitions
  .slice(0, legacySeedRelationCount)
  .map((relation, relationIndex) => primaryCase(relation, relationIndex, relationIndex + 1));

const additionalPrimaryCases = relationDefinitions
  .slice(legacySeedRelationCount)
  .map((relation, additionalIndex) =>
    primaryCase(
      relation,
      legacySeedRelationCount + additionalIndex,
      legacySeedRelationCount + legacySeedChainCount + additionalIndex + 1,
    ),
  );

const verificationCaseTemplates = [
  (month: number, location: string, cause: string, effect: string) =>
    `2025年${month}月，${location}的复核记录再次显示${cause}后发生${effect}。`,
  (month: number, location: string, cause: string, effect: string) =>
    `${location}在2025年${month}月完成复盘，确认${cause}先于${effect}出现。`,
  (month: number, location: string, cause: string, effect: string) =>
    `2025年${month}月的${location}复查中，${cause}之后再次观察到${effect}。`,
  (month: number, location: string, cause: string, effect: string) =>
    `${location}于2025年${month}月补充案例：${cause}发生后出现了${effect}。`,
] as const;

function verificationCase(
  chain: (typeof realisticSeedChains)[number],
  chainIndex: number,
  relationIndex: number,
  caseSequence: number,
) {
  return {
    id: stableId(8200, caseSequence),
    relationIndex,
    content: verificationCaseTemplates[chainIndex % verificationCaseTemplates.length]!(
      (chainIndex % 12) + 1,
      realisticCaseLocations[chainIndex % realisticCaseLocations.length]!,
      chain.events[0][0],
      chain.events[1][0],
    ),
  };
}

const legacyVerificationCases = realisticSeedChains
  .slice(0, legacySeedChainCount)
  .map((chain, chainIndex) =>
    verificationCase(chain, chainIndex, chainIndex * 4, legacySeedRelationCount + chainIndex + 1),
  );

const additionalVerificationCases = realisticSeedChains
  .slice(legacySeedChainCount)
  .map((chain, additionalChainIndex) => {
    const chainIndex = legacySeedChainCount + additionalChainIndex;
    return verificationCase(
      chain,
      chainIndex,
      legacySeedRelationCount + additionalChainIndex * 4,
      relationDefinitions.length + legacySeedChainCount + additionalChainIndex + 1,
    );
  });

const caseDefinitions = [
  ...legacyPrimaryCases,
  ...legacyVerificationCases,
  ...additionalPrimaryCases,
  ...additionalVerificationCases,
];
const fixedCases = caseDefinitions.map(({ id, content }) => ({ id, content }));
const fixedCaseLinks = caseDefinitions.map((concreteCase) => ({
  causalRelationId: fixedRelations[concreteCase.relationIndex]!.id,
  concreteCaseId: concreteCase.id,
}));

export async function runFixedSeed(pool: Pool): Promise<void> {
  const database = createDatabaseClient(pool);

  await database.transaction(async (transaction) => {
    await transaction
      .insert(abstractEvents)
      .values(fixedEvents)
      .onConflictDoNothing({ target: abstractEvents.id });
    await transaction
      .insert(eventAliases)
      .values(fixedAliases)
      .onConflictDoNothing({ target: eventAliases.id });
    await transaction.insert(eventKeywords).values(fixedKeywords).onConflictDoNothing();
    await transaction
      .insert(causalRelations)
      .values(fixedRelations)
      .onConflictDoNothing({ target: causalRelations.id });
    await transaction
      .insert(concreteCases)
      .values(fixedCases)
      .onConflictDoNothing({ target: concreteCases.id });
    await transaction
      .insert(causalRelationCases)
      .values(fixedCaseLinks)
      .onConflictDoNothing({
        target: [causalRelationCases.causalRelationId, causalRelationCases.concreteCaseId],
      });
  });
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await runFixedSeed(pool);
    process.stdout.write('Fixed seed data loaded successfully.\n');
  } catch {
    process.stderr.write('Fixed seed failed. Run pnpm db:migrate before loading data.\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
