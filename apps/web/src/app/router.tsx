import { createBrowserRouter, Navigate } from 'react-router';

import { App } from './App';
import { EventListPage } from '../features/events/pages/EventListPage';
import { EventCreatePage } from '../features/events/pages/EventCreatePage';
import { EventDetailPage } from '../features/events/pages/EventDetailPage';
import { EventEditPage } from '../features/events/pages/EventEditPage';
import { SystemStatus } from '../features/system-status/SystemStatus';
import { RelationListPage } from '../features/relations/pages/RelationListPage';
import { RelationCreatePage } from '../features/relations/pages/RelationCreatePage';
import { RelationEditPage } from '../features/relations/pages/RelationEditPage';

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
      { path: 'relations/:relationId/edit', element: <RelationEditPage /> },
      { path: 'system', element: <SystemStatus /> },
      { path: '*', element: <Navigate to="/events" replace /> },
    ],
  },
]);
