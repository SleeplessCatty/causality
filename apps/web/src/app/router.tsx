import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';

import { InitialPasswordPage } from '../features/auth/InitialPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireSession } from '../features/auth/RequireSession';
import { PageSkeleton, type SkeletonVariant } from '../shared/loading/PageSkeleton';
import { useDelayedVisibility } from '../shared/loading/useDelayedVisibility';
import { App } from './App';
import { routeLoaders } from './preloadableRoutes';

function lazyPage<TModule>(
  load: () => Promise<TModule>,
  select: (module: TModule) => ComponentType,
) {
  return async () => ({ Component: select(await load()) });
}

function createRouteFallback(variant: SkeletonVariant): ComponentType {
  return function RouteFallback() {
    const visible = useDelayedVisibility(true, { delayMs: 180, minimumVisibleMs: 300 });
    return <PageSkeleton variant={variant} visible={visible} />;
  };
}

const ListRouteFallback = createRouteFallback('list');
const DetailRouteFallback = createRouteFallback('detail');
const FormRouteFallback = createRouteFallback('form');
const SettingsRouteFallback = createRouteFallback('settings');
const CanvasRouteFallback = createRouteFallback('canvas');

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireSession allowPasswordChange />,
    children: [{ path: '/change-initial-password', element: <InitialPasswordPage /> }],
  },
  {
    element: <RequireSession />,
    children: [
      {
        path: '/',
        element: <App />,
        HydrateFallback: SettingsRouteFallback,
        children: [
          { index: true, element: <Navigate to="/events" replace /> },
          {
            path: 'events',
            HydrateFallback: ListRouteFallback,
            lazy: lazyPage(routeLoaders.eventList.load, (module) => module.EventListPage),
          },
          {
            path: 'events/new',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.eventCreate.load, (module) => module.EventCreatePage),
          },
          {
            path: 'events/:eventId',
            HydrateFallback: DetailRouteFallback,
            lazy: lazyPage(routeLoaders.eventDetail.load, (module) => module.EventDetailPage),
          },
          {
            path: 'events/:eventId/edit',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.eventEdit.load, (module) => module.EventEditPage),
          },
          {
            path: 'relations',
            HydrateFallback: ListRouteFallback,
            lazy: lazyPage(routeLoaders.relationList.load, (module) => module.RelationListPage),
          },
          {
            path: 'relations/new',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.relationCreate.load, (module) => module.RelationCreatePage),
          },
          {
            path: 'relations/:relationId',
            HydrateFallback: DetailRouteFallback,
            lazy: lazyPage(routeLoaders.relationDetail.load, (module) => module.RelationDetailPage),
          },
          {
            path: 'relations/:relationId/edit',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.relationEdit.load, (module) => module.RelationEditPage),
          },
          {
            path: 'cases',
            HydrateFallback: ListRouteFallback,
            lazy: lazyPage(routeLoaders.caseList.load, (module) => module.CaseListPage),
          },
          {
            path: 'cases/new',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.caseCreate.load, (module) => module.CaseCreatePage),
          },
          {
            path: 'cases/:caseId',
            HydrateFallback: DetailRouteFallback,
            lazy: lazyPage(routeLoaders.caseDetail.load, (module) => module.CaseDetailPage),
          },
          {
            path: 'cases/:caseId/edit',
            HydrateFallback: FormRouteFallback,
            lazy: lazyPage(routeLoaders.caseEdit.load, (module) => module.CaseEditPage),
          },
          {
            path: 'graph',
            HydrateFallback: CanvasRouteFallback,
            lazy: lazyPage(routeLoaders.graph.load, (module) => module.CausalGraphPage),
          },
          {
            path: 'maintenance',
            HydrateFallback: SettingsRouteFallback,
            lazy: lazyPage(routeLoaders.maintenance.load, (module) => module.DataMaintenance),
          },
          {
            path: 'data-transfer',
            HydrateFallback: SettingsRouteFallback,
            lazy: lazyPage(routeLoaders.dataTransfer.load, (module) => module.DataTransferPage),
          },
          {
            path: 'data-transfer/imports/:batchId',
            HydrateFallback: DetailRouteFallback,
            lazy: lazyPage(routeLoaders.importDetail.load, (module) => module.ImportDetailPage),
          },
          {
            path: 'data-transfer/ai-imports/:batchId',
            HydrateFallback: DetailRouteFallback,
            lazy: lazyPage(routeLoaders.aiImportDetail.load, (module) => module.AiImportDetailPage),
          },
          {
            path: 'settings',
            HydrateFallback: SettingsRouteFallback,
            lazy: lazyPage(routeLoaders.settings.load, (module) => module.ParameterSettings),
          },
          {
            path: 'system',
            HydrateFallback: SettingsRouteFallback,
            lazy: lazyPage(routeLoaders.system.load, (module) => module.SystemStatus),
          },
          { path: '*', element: <Navigate to="/events" replace /> },
        ],
      },
    ],
  },
]);
