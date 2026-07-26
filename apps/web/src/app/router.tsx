import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';

import { App } from './App';

function lazyPage<TModule>(
  load: () => Promise<TModule>,
  select: (module: TModule) => ComponentType,
) {
  return async () => ({ Component: select(await load()) });
}

function GraphRouteFallback() {
  return <div className="page-state">正在加载因果图…</div>;
}

function AppRouteFallback() {
  return <div className="page-state">正在加载页面…</div>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    HydrateFallback: AppRouteFallback,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      {
        path: 'events',
        lazy: lazyPage(
          () => import('../features/events/pages/EventListPage'),
          (module) => module.EventListPage,
        ),
      },
      {
        path: 'events/new',
        lazy: lazyPage(
          () => import('../features/events/pages/EventCreatePage'),
          (module) => module.EventCreatePage,
        ),
      },
      {
        path: 'events/:eventId',
        lazy: lazyPage(
          () => import('../features/events/pages/EventDetailPage'),
          (module) => module.EventDetailPage,
        ),
      },
      {
        path: 'events/:eventId/edit',
        lazy: lazyPage(
          () => import('../features/events/pages/EventEditPage'),
          (module) => module.EventEditPage,
        ),
      },
      {
        path: 'relations',
        lazy: lazyPage(
          () => import('../features/relations/pages/RelationListPage'),
          (module) => module.RelationListPage,
        ),
      },
      {
        path: 'relations/new',
        lazy: lazyPage(
          () => import('../features/relations/pages/RelationCreatePage'),
          (module) => module.RelationCreatePage,
        ),
      },
      {
        path: 'relations/:relationId',
        lazy: lazyPage(
          () => import('../features/relations/pages/RelationDetailPage'),
          (module) => module.RelationDetailPage,
        ),
      },
      {
        path: 'relations/:relationId/edit',
        lazy: lazyPage(
          () => import('../features/relations/pages/RelationEditPage'),
          (module) => module.RelationEditPage,
        ),
      },
      {
        path: 'cases',
        lazy: lazyPage(
          () => import('../features/cases/pages/CaseListPage'),
          (module) => module.CaseListPage,
        ),
      },
      {
        path: 'cases/new',
        lazy: lazyPage(
          () => import('../features/cases/pages/CaseCreatePage'),
          (module) => module.CaseCreatePage,
        ),
      },
      {
        path: 'cases/:caseId',
        lazy: lazyPage(
          () => import('../features/cases/pages/CaseDetailPage'),
          (module) => module.CaseDetailPage,
        ),
      },
      {
        path: 'cases/:caseId/edit',
        lazy: lazyPage(
          () => import('../features/cases/pages/CaseEditPage'),
          (module) => module.CaseEditPage,
        ),
      },
      {
        path: 'graph',
        HydrateFallback: GraphRouteFallback,
        lazy: lazyPage(
          () => import('../features/causal-graph/pages/CausalGraphPage'),
          (module) => module.CausalGraphPage,
        ),
      },
      {
        path: 'maintenance',
        lazy: lazyPage(
          () => import('../features/data-maintenance/DataMaintenance'),
          (module) => module.DataMaintenance,
        ),
      },
      {
        path: 'settings',
        lazy: lazyPage(
          () => import('../features/parameter-settings/ParameterSettings'),
          (module) => module.ParameterSettings,
        ),
      },
      {
        path: 'system',
        lazy: lazyPage(
          () => import('../features/system-status/SystemStatus'),
          (module) => module.SystemStatus,
        ),
      },
      { path: '*', element: <Navigate to="/events" replace /> },
    ],
  },
]);
