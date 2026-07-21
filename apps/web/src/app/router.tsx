import { createBrowserRouter, Navigate } from 'react-router';

import { App } from './App';
import { EventListPage } from '../features/events/pages/EventListPage';
import { EventCreatePage } from '../features/events/pages/EventCreatePage';
import { EventDetailPage } from '../features/events/pages/EventDetailPage';
import { EventEditPage } from '../features/events/pages/EventEditPage';
import { SystemStatus } from '../features/system-status/SystemStatus';

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
      { path: 'system', element: <SystemStatus /> },
      { path: '*', element: <Navigate to="/events" replace /> },
    ],
  },
]);
