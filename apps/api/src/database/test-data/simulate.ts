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
import {
  buildSimulationPlan,
  createSimulationBatchId,
  parseSimulationArguments,
  type SimulationOptions,
} from './simulatedData.js';

const insertBatchSize = 1_000;

export interface SimulationResult {
  batchId: string;
  inserted: {
    events: number;
    aliases: number;
    relations: number;
    cases: number;
    caseLinks: number;
  };
  elapsedMilliseconds: number;
}

export async function runSimulation(
  pool: Pool,
  options: SimulationOptions,
  batchId = createSimulationBatchId(),
): Promise<SimulationResult> {
  const startedAt = performance.now();
  const plan = buildSimulationPlan(options, batchId);
  const database = createDatabaseClient(pool);

  await database.transaction(async (transaction) => {
    for (let offset = 0; offset < plan.events.length; offset += insertBatchSize) {
      await transaction
        .insert(abstractEvents)
        .values(plan.events.slice(offset, offset + insertBatchSize));
    }
    for (let offset = 0; offset < plan.aliases.length; offset += insertBatchSize) {
      await transaction
        .insert(eventAliases)
        .values(plan.aliases.slice(offset, offset + insertBatchSize));
    }
    for (let offset = 0; offset < plan.relations.length; offset += insertBatchSize) {
      await transaction
        .insert(causalRelations)
        .values(plan.relations.slice(offset, offset + insertBatchSize));
    }

    let caseBatch: Array<typeof concreteCases.$inferInsert> = [];
    for (const causalCase of plan.cases()) {
      caseBatch.push(causalCase);
      if (caseBatch.length === insertBatchSize) {
        await transaction.insert(concreteCases).values(caseBatch);
        caseBatch = [];
      }
    }
    if (caseBatch.length > 0) {
      await transaction.insert(concreteCases).values(caseBatch);
    }

    let linkBatch: Array<typeof causalRelationCases.$inferInsert> = [];
    for (const link of plan.caseLinks()) {
      linkBatch.push(link);
      if (linkBatch.length === insertBatchSize) {
        await transaction.insert(causalRelationCases).values(linkBatch);
        linkBatch = [];
      }
    }
    if (linkBatch.length > 0) await transaction.insert(causalRelationCases).values(linkBatch);
  });

  return {
    batchId,
    inserted: {
      events: options.events,
      aliases: options.events,
      relations: options.relations,
      cases: options.cases,
      caseLinks: Array.from(plan.caseLinks()).length,
    },
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };
}

async function main(): Promise<void> {
  let pool: Pool | undefined;

  try {
    const options = parseSimulationArguments(process.argv.slice(2));
    const env = parseEnv(process.env);
    pool = new Pool({ connectionString: env.DATABASE_URL });
    const result = await runSimulation(pool, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith('Invalid simulation')
        ? error.message
        : 'Simulation failed. Check connectivity and migrations.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
