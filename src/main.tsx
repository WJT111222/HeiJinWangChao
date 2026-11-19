import { installTavernFetch } from './presets/tavern/fetch';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

installTavernFetch();

const root = document.getElementById('root');

if (!root) {
  throw new Error('页面缺少应用挂载节点 #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
