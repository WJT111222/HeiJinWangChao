import { oracleId } from '../../presets/meowssiah/definition';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { GameState } from '../../domain/state';
import { isPeinture } from '../../presets/peintureSettings';
import { builtInPresets, captureStoryPreset } from '../../presets/library';
const Editor = lazy(() => import('./PeintureSettings'));
const OracleConsole = lazy(() => import('./meowssiah/OracleConsole'));
export function PeintureLauncher({ state }: { state?: GameState }) {
  const [definition, setDefinition] = useState<(typeof builtInPresets)[number]>();
  const [clock, setClock] = useState(false);
  useEffect(() => {
    const show = (event: Event) => {
      const selected = captureStoryPreset();
      const target = builtInPresets.find(preset => preset.id === selected?.definition.id);
      if (target && (isPeinture(target.id) || target.id === oracleId)) { setClock(event.type === 'heijin:open-preset-clock'); setDefinition(target); }
    };
    window.addEventListener('heijin:open-preset-settings', show);
    window.addEventListener('heijin:open-preset-clock', show);
    return () => {
      window.removeEventListener('heijin:open-preset-settings', show);
      window.removeEventListener('heijin:open-preset-clock', show);
    };
  }, []);
  return definition ? (
    <Suspense fallback={null}>
      {definition.id === oracleId ? <OracleConsole key={state?.saveId} saveId={state?.saveId} close={() => setDefinition(undefined)}/> : <Editor definition={definition} state={state} showClock={clock} close={() => setDefinition(undefined)} />}
    </Suspense>
  ) : null;
}
