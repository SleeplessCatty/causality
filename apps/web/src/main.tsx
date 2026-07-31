import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { AppProviders } from './app/AppProviders';
import { router } from './app/router';
import { AuthProvider } from './features/auth/AuthProvider';
import './styles/base.css';
import './styles/appShell.css';
import './styles/shared.css';
import './styles/recordManagement.css';
import './features/system-status/systemStatus.css';
import './features/data-maintenance/dataMaintenance.css';
import './features/parameter-settings/parameterSettings.css';
import './features/data-transfer/dataTransfer.css';
import './features/auth/auth.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Application root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppProviders>
  </StrictMode>,
);
