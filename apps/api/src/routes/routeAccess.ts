import type { FastifyInstance, HTTPMethods } from 'fastify';

export type RouteAccess = 'public' | 'business' | 'internal-mcp';

export interface RouteAccessPolicyEntry {
  method: HTTPMethods;
  url: string;
  access: RouteAccess;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    routeAccess?: RouteAccess;
  }

  interface FastifyInstance {
    routeAccessPolicy: RouteAccessPolicyEntry[];
  }
}

export function installRouteAccessRegistry(app: FastifyInstance): void {
  const policy: RouteAccessPolicyEntry[] = [];
  const pending: Array<{
    methods: HTTPMethods[];
    url: string;
    config: { routeAccess?: RouteAccess };
  }> = [];
  app.decorate('routeAccessPolicy', policy);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const config = route.config ?? {};
    route.config = config;
    pending.push({ methods, url: route.url, config });
  });
  app.addHook('onReady', async () => {
    for (const route of pending) {
      const access = route.config.routeAccess;
      if (!access) {
        throw new Error(`API route has no access policy: ${route.methods.join(',')} ${route.url}`);
      }
      for (const method of route.methods) {
        if (method === 'HEAD') continue;
        policy.push({ method, url: route.url, access });
      }
    }
  });
}

export function markBusinessRoutes(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const config = route.config ?? {};
    config.routeAccess = 'business';
    route.config = config;
  });
}
