import { readFileSync } from 'node:fs';

import { expect, test as base } from '@playwright/test';

import { e2eCsrfPath, e2eStorageStatePath } from './authenticateUser.js';
import { apiBase } from './urls.js';

export const test = base.extend({
  request: async ({ playwright }, use) => {
    const csrfToken = readFileSync(e2eCsrfPath, 'utf8').trim();
    const request = await playwright.request.newContext({
      baseURL: apiBase,
      storageState: e2eStorageStatePath,
      extraHTTPHeaders: {
        origin: process.env.E2E_WEB_ORIGIN ?? 'http://127.0.0.1:5274',
        'x-csrf-token': csrfToken,
      },
    });
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
});

export { expect };
