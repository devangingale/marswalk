// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/components.css';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');

if (rootElement && new URLSearchParams(window.location.search).get('spike') === '1') {
  void import('./globe/spike').then(({ mountSpike }) => mountSpike(rootElement));
} else if (rootElement && new URLSearchParams(window.location.search).get('globe') === '1') {
  void import('./globe/GlobePage').then(({ GlobePage }) =>
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <GlobePage />
      </React.StrictMode>
    )
  );
} else if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
