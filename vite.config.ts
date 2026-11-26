import { execFileSync } from 'node:child_process';
import { prototypeSandbox } from './experiments/spreset/devServer';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function buildVersion() {
  const isCommit = (value: string) => /^[0-9a-f]{40}$/.test(value);
  const cloudflareCommit = process.env.WORKERS_CI_COMMIT_SHA?.trim().toLowerCase();
  if (cloudflareCommit && isCommit(cloudflareCommit)) return cloudflareCommit;

  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (isCommit(commit)) return commit;
  } catch {
    // A source archive may have no Git metadata or git executable.
  }
  return 'unavailable';
}

export default defineConfig(({ command }) => ({
  define: {
    'import.meta.env.VITE_FEEDBACK_BUILD': JSON.stringify(command === 'build' ? buildVersion() : 'development'),
  },
  plugins: [react(), prototypeSandbox()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}));
