import { useEffect, useRef } from 'react';

// 仅调整游戏外壳；不锁定 body，首页、创角和顶层 dialog 仍可滚动。
export function useGameViewport(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    function update() {
      // 放大手势保持浏览器原生平移；普通尺寸/软键盘使用可见视口。
      if (!element || !viewport) return;
      if (viewport.scale !== 1) {
        element.style.removeProperty('--game-viewport-height');
        element.style.removeProperty('--game-viewport-top');
        return;
      }
      element.style.setProperty('--game-viewport-height', `${viewport.height}px`);
      element.style.setProperty('--game-viewport-top', `${viewport.offsetTop}px`);
    }
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      element.style.removeProperty('--game-viewport-height');
      element.style.removeProperty('--game-viewport-top');
    };
  }, [active]);
  return ref;
}
