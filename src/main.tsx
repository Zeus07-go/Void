import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { UniverseHost } from './portal/UniverseHost';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <UniverseHost />
    </StrictMode>,
  );
}
