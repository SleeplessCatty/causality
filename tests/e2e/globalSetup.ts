import { chromium, type FullConfig } from '@playwright/test';

import { authenticateUser } from './support/authenticateUser.js';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('E2E baseURL is missing');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await authenticateUser(page);
  } finally {
    await browser.close();
  }
}
