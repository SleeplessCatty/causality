const apiPort = process.env.E2E_API_PORT ?? '3200';

export const apiBase = `http://127.0.0.1:${apiPort}/api`;
