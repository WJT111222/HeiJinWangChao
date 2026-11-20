import { lazy, Suspense, useEffect, useState } from 'react';
const Editor = lazy(() => import('./PeintureSettings'));
export function PeintureLauncher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('heijin:open-preset-settings', show);
    return () => window.removeEventListener('heijin:open-preset-settings', show);
  }, []);
  return open ? (
    <Suspense fallback={null}>
      <Editor close={() => setOpen(false)} />
    </Suspense>
  ) : null;
}
