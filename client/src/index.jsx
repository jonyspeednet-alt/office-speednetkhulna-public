import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'bootstrap/dist/css/bootstrap.min.css';
import App from './App';
import { initLocale } from './i18n';
import './styles/tokens.css';
import './styles/ui.css';
import './styles/index.css';
import './styles/reseller-profile.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30s: avoids duplicate refetch on quick route changes
      gcTime: 1000 * 60 * 10, // keep query cache for smoother back/forward navigation
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
initLocale('en');
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
