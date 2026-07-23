import { createBrowserRouter, Navigate } from 'react-router';

import { App } from './App';
import { EventListPage } from '../features/events/pages/EventListPage';
import { EventCreatePage } from '../features/events/pages/EventCreatePage';
import { EventDetailPage } from '../features/events/pages/EventDetailPage';
import { EventEditPage } from '../features/events/pages/EventEditPage';
import { SystemStatus } from '../features/system-status/SystemStatus';
import { DataMaintenance } from '../features/data-maintenance/DataMaintenance';
import { RelationListPage } from '../features/relations/pages/RelationListPage';
import { RelationCreatePage } from '../features/relations/pages/RelationCreatePage';
import { RelationEditPage } from '../features/relations/pages/RelationEditPage';
import { RelationDetailPage } from '../features/relations/pages/RelationDetailPage';
import { CaseCreatePage } from '../features/cases/pages/CaseCreatePage';
import { CaseDetailPage } from '../features/cases/pages/CaseDetailPage';
import { CaseEditPage } from '../features/cases/pages/CaseEditPage';
import { CaseListPage } from '../features/cases/pages/CaseListPage';

function GraphRouteFallback() {
  return <div className="page-state">正在加载因果图…</div>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: 'events', element: <EventListPage /> },
      { path: 'events/new', element: <EventCreatePage /> },
      { path: 'events/:eventId', element: <EventDetailPage /> },
      { path: 'events/:eventId/edit', element: <EventEditPage /> },
      { path: 'relations', element: <RelationListPage /> },
      { path: 'relations/new', element: <RelationCreatePage /> },
      { path: 'relations/:relationId', element: <RelationDetailPage /> },
      { path: 'relations/:relationId/edit', element: <RelationEditPage /> },
      { path: 'cases', element: <CaseListPage /> },
      { path: 'cases/new', element: <CaseCreatePage /> },
      { path: 'cases/:caseId', element: <CaseDetailPage /> },
      { path: 'cases/:caseId/edit', element: <CaseEditPage /> },
      {
        path: 'graph',
        HydrateFallback: GraphRouteFallback,
        lazy: async () => {
          const module = await import('../features/causal-graph/pages/CausalGraphPage');
          return { Component: module.CausalGraphPage };
        },
      },
      { path: 'maintenance', element: <DataMaintenance /> },
      { path: 'system', element: <SystemStatus /> },
      { path: '*', element: <Navigate to="/events" replace /> },
    ],
  },
]);
