import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startUpdateCheck } from './lib/updateCheck';
import './styles.css';

startUpdateCheck();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
