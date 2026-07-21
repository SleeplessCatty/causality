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
} from '../schema/index.js';

function stableId(group: number, sequence: number): string {
  return `00000000-0000-4000-${group.toString().padStart(4, '0')}-${sequence.toString().padStart(12, '0')}`;
}

const eventDefinitions = [
  ['央行提高政策利率', '政策利率被上调', ['政策利率', '加息']],
  ['市场流动性收紧', '金融市场可用流动性下降', ['流动性', '资金面']],
  ['债券收益率上升', '债券市场收益率整体上行', ['债券收益率', '利率债']],
  ['股票估值折现率上升', '股票估值使用的折现率上升', ['折现率', '估值']],
  ['高估值股票承压', '高估值股票价格或估值受到压力', ['成长股', '高估值']],
  ['银行净息差扩大', '银行资产负债利差扩大', ['银行', '净息差']],
  ['原油价格上涨', '国际原油价格持续上行', ['原油', '能源价格']],
  ['通胀预期上升', '市场对未来通胀的预期上升', ['通胀', '通胀预期']],
  ['企业运输成本上升', '企业承担的运输成本提高', ['运输成本', '物流']],
  ['企业利润承压', '企业利润率或利润规模受到压力', ['企业利润', '利润率']],
  ['股票利好', '对相关股票价格形成正面影响', ['利好', '正面影响']],
  ['股票利空', '对相关股票价格形成负面影响', ['利空', '负面影响']],
] as const;

const fixedEvents = eventDefinitions.map(([name, description, keywords], index) => ({
  id: stableId(8000, index + 1),
  name,
  description,
  keywords: [...keywords],
}));

const fixedAliases = eventDefinitions.map(([, , keywords], index) => ({
  id: stableId(8001, index + 1),
  eventId: fixedEvents[index]!.id,
  alias: keywords[0],
}));

const relationDefinitions = [
  [0, 1, 75, '政策利率上升促使市场流动性收紧'],
  [1, 0, 20, '流动性持续收紧可能促使政策进一步调整'],
  [0, 2, 85, '政策利率上升带动债券收益率上行'],
  [0, 3, 80, '无风险利率上升提高股票估值折现率'],
  [1, 4, 70, '流动性收紧使高估值股票承压'],
  [2, 3, 90, '债券收益率上升提高估值折现率'],
  [3, 4, 88, '折现率上升压低高估值股票估值'],
  [4, 11, 82, '高估值股票承压形成股票利空'],
  [0, 5, 60, '利率上升可能扩大银行净息差'],
  [5, 10, 65, '银行净息差扩大形成银行股利好'],
  [6, 7, 78, '原油价格上涨推高通胀预期'],
  [6, 8, 92, '原油价格上涨推高运输成本'],
  [7, 2, 55, '通胀预期上升带动债券收益率上行'],
  [8, 9, 73, '运输成本上升使企业利润承压'],
  [9, 11, 0, '企业利润承压形成相关股票利空'],
] as const;

const fixedRelations = relationDefinitions.map(
  ([causeIndex, effectIndex, confidence, description], index) => ({
    id: stableId(8100, index + 1),
    causeEventId: fixedEvents[causeIndex]!.id,
    effectEventId: fixedEvents[effectIndex]!.id,
    confidence,
    description,
  }),
);

const fixedCases = Array.from({ length: 18 }, (_, index) => ({
  id: stableId(8200, index + 1),
  content: `202${4 + Math.floor(index / 12)}年${(index % 12) + 1}月固定案例${index + 1}`,
}));

const fixedCaseLinks = [
  ...Array.from({ length: 15 }, (_, index) => ({
    causalRelationId: fixedRelations[index]!.id,
    concreteCaseId: fixedCases[index]!.id,
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    causalRelationId: fixedRelations[index + 1]!.id,
    concreteCaseId: fixedCases[index]!.id,
  })),
];

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
