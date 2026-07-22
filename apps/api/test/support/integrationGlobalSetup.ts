import type { TestProject } from 'vitest/node';
import { GenericContainer, Wait } from 'testcontainers';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresHost: string;
    postgresPort: number;
    postgresUser: string;
    postgresPassword: string;
  }
}

const postgresUser = 'causality';
const postgresPassword = 'causality';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new GenericContainer('postgres:18.4-alpine')
    .withEnvironment({
      POSTGRES_DB: 'postgres',
      POSTGRES_USER: postgresUser,
      POSTGRES_PASSWORD: postgresPassword,
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ['CMD-SHELL', `pg_isready -U ${postgresUser} -d postgres`],
      interval: 1_000,
      timeout: 3_000,
      retries: 30,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(120_000)
    .start();

  project.provide('postgresHost', container.getHost());
  project.provide('postgresPort', container.getMappedPort(5432));
  project.provide('postgresUser', postgresUser);
  project.provide('postgresPassword', postgresPassword);

  return async () => {
    await container.stop();
  };
}
