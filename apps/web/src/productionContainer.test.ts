import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Web production container', () => {
  it('serves the SPA and proxies API requests from an unprivileged port', () => {
    const nginx = readFileSync(resolve(process.cwd(), 'nginx.conf'), 'utf8');

    expect(nginx).toContain('listen 8080');
    expect(nginx).toContain('location = /health');
    expect(nginx).toContain('proxy_pass http://api:3000');
    expect(nginx).toContain('try_files $uri $uri/ /index.html');
  });

  it('pins the unprivileged Nginx runtime image', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('nginxinc/nginx-unprivileged:1.29.4-alpine');
    expect(dockerfile).not.toContain(':latest');
  });
});
