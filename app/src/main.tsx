// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/components.css';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');
const params = new URLSearchParams(window.location.search);

// The globe page is the Explore tab now; older ?globe=1 links open it.
if (params.get('globe') === '1' && !params.has('tab')) {
  params.delete('globe');
  params.set('tab', 'explore');
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

if (rootElement && params.get('spike') === '1') {
  void import('./globe/spike').then(({ mountSpike }) => mountSpike(rootElement));
} else if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
