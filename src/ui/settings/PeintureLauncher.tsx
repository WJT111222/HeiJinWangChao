import { lazy, Suspense, useEffect, useState } from 'react';
import { builtInPresets, captureStoryPreset } from '../../presets/library';
const Editor = lazy(() => import('./PeintureSettings'));
export function PeintureLauncher() {
  const [definition, setDefinition] = useState<(typeof builtInPresets)[number]>();
  useEffect(() => {
    const show = () => {
      const selected = captureStoryPreset();
      const target = builtInPresets.find(preset => preset.id === selected?.definition.id);
      if (target?.id === 'peinture-1118') setDefinition(target);
    };
    window.addEventListener('heijin:open-preset-settings', show);
    return () => window.removeEventListener('heijin:open-preset-settings', show);
  }, []);
  return definition ? (
    <Suspense fallback={null}>
      <Editor definition={definition} close={() => setDefinition(undefined)} />
    </Suspense>
  ) : null;
}
