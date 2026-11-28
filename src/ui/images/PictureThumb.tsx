import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from '../Dialog';
import type { Picture } from '../../services/images/model';
import { slots } from '../../services/images/model';
import type { PictureResources } from './pictureResources';

const observers = new Map<Element, (value: boolean) => void>();
let observer: IntersectionObserver | undefined;
function observe(el: Element, notify: (visible: boolean) => void) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) observers.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: '120px' },
  );
  // An image that merely crosses the screen during a fling does not need decoding.
  let timer: ReturnType<typeof setTimeout>;
  observers.set(el, (visible) => {
    clearTimeout(timer);
    if (visible) timer = setTimeout(() => notify(true), 90);
    else notify(false);
  });
  observer.observe(el);
  return () => {
    clearTimeout(timer);
    observers.delete(el);
    observer?.unobserve(el);
  };
}

function useResource(resources: PictureResources, picture: Picture, active: boolean, full = false) {
  const [loaded, setLoaded] = useState<{ resources: PictureResources; id: string; url?: string }>();
  useEffect(() => {
    if (!active) {
      setLoaded(undefined);
      return;
    }
    let live = true;
    const lease = resources.acquire(picture, full);
    void lease.promise.then(
      (url) => {
        if (live) setLoaded({ resources, id: picture.id, url });
      },
      () => {
        if (live) setLoaded({ resources, id: picture.id });
      },
    );
    return () => {
      live = false;
      lease.release();
    };
  }, [resources, picture.id, picture.mime, active, full]); // Immutable resource ID.
  return active && loaded?.resources === resources && loaded.id === picture.id ? loaded : undefined;
}
function FullPicture({
  resources,
  p,
  close,
}: {
  resources: PictureResources;
  p: Picture;
  close: () => void;
}) {
  const loaded = useResource(resources, p, true, true);
  const [failed, setFailed] = useState(false);
  return (
    <Dialog title={p.target.title + ' · ' + slots[p.slot]} onClose={close}>
      {loaded?.url && !failed ? (
        <img className="image-full" src={loaded.url} alt={p.target.title} onError={() => setFailed(true)} />
      ) : (
        <p role="status">{loaded || failed ? '图片暂时无法读取' : '正在读取原图…'}</p>
      )}
    </Dialog>
  );
}

export function PictureThumb({
  resources,
  p,
  variant = p.slot,
  fallback,
}: {
  resources: PictureResources;
  p: Picture;
  variant?: string;
  fallback?: ReactNode;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => (root.current ? observe(root.current, setNear) : undefined), []);
  const loaded = useResource(resources, p, near && !failed);
  useEffect(() => {
    if (loaded && !loaded.url) setFailed(true);
  }, [loaded]);
  const broken = failed || (loaded && !loaded.url);
  return (
    <>
      <span ref={root} className={'picture-thumb thumb-' + variant} data-unavailable={broken || undefined}>
        {loaded?.url && !broken ? (
          <button
            type="button"
            aria-label={'预览' + slots[p.slot] + ' · ' + p.target.title}
            onClick={() => setOpen(true)}
          >
            <img alt={p.target.title} src={loaded.url} decoding="async" onError={() => setFailed(true)} />
          </button>
        ) : (
          fallback
        )}
      </span>
      {open && <FullPicture resources={resources} p={p} close={() => setOpen(false)} />}
    </>
  );
}

// Export the original bytes only when the player asks for them.
export async function downloadPicture(resources: PictureResources, p: Picture) {
  const lease = resources.acquire(p, true);
  try {
    const url = await lease.promise;
    if (!url) throw Error('原图无法读取');
    const link = document.createElement('a');
    link.href = url;
    link.download = p.target.title + '.' + p.mime.split('/')[1];
    link.click();
  } finally {
    setTimeout(lease.release, 1000);
  }
}
