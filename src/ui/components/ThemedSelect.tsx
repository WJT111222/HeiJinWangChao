import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption { value: string; label: string }
// 只替换设置选择控件；浮层留在原 dialog 内，避免原生模态框使 body portal 不可交互。
export function ThemedSelect({ label, value, options, onChange, disabled = false, searchable = false, onOpen }: {
  label: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void;
  disabled?: boolean; searchable?: boolean; onOpen?: () => void;
}) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null), listbox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 300 });
  const filtered = options.filter((item) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = options.find((item) => item.value === value);
  const expanded = open && !disabled;
  function close(returnFocus = false) { setOpen(false); if (returnFocus) button.current?.focus(); }
  function show() {
    if (disabled) return;
    setQuery(''); setActive(Math.max(0, options.findIndex((item) => item.value === value))); setOpen(true); onOpen?.();
  }
  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      const box = button.current?.getBoundingClientRect(); if (!box) return;
      const width = Math.min(Math.max(box.width, 240), window.innerWidth - 24);
      const below = window.innerHeight - box.bottom - 16, above = box.top - 16;
      const height = Math.min(340, Math.max(100, Math.max(below, above)));
      const down = below >= Math.min(240, above);
      setPosition({ width, left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        top: down ? box.bottom + 6 : Math.max(12, box.top - height - 6), maxHeight: down ? Math.min(340, below) : height });
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    if (searchable) search.current?.focus(); else listbox.current?.focus();
    function outside(event: Event) {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [expanded, searchable]);
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded, id]);
  function choose(index: number) { const option = filtered[index]; if (option) { onChange(option.value); close(true); } }
  return <div className="themed-select">
    <span id={`${id}-label`} className="select-label">{label}</span>
    <button ref={button} type="button" role="combobox" className="select-trigger" aria-label={label}
      value={value} aria-expanded={expanded} aria-controls={`${id}-list`} aria-haspopup="listbox" disabled={disabled}
      onClick={() => expanded ? close() : show()} onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); if (!expanded) show(); }
      }}><span>{selected?.label ?? (value || '请选择')}</span><span aria-hidden="true">⌄</span></button>
    {expanded && createPortal(<div ref={popup} className="select-popup" style={position} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') close(true);
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); setActive((old) => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, filtered.length - 1)
            : Math.max(0, Math.min(filtered.length - 1, old + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key === 'Enter' || (!searchable && event.key === ' ')) { event.preventDefault(); choose(active); }
      }}>
      {searchable && <input ref={search} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label={`搜索${label}`} aria-controls={`${id}-list`}
        aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined} placeholder="搜索模型关键词…"
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} />}
      <div ref={listbox} tabIndex={searchable ? -1 : 0} id={`${id}-list`} role="listbox" aria-label={label} aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined}>
        {filtered.map((option, index) => <button key={option.value} type="button" role="option" id={`${id}-option-${index}`}
          value={option.value} aria-selected={option.value === value} className={index === active ? 'option-active' : ''} tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
          <span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}
        </button>)}
        {!filtered.length && <p className="muted">没有匹配项，可换个关键词或手动填写模型 ID。</p>}
      </div>
    </div>, button.current?.closest('dialog') ?? document.body)}
  </div>;
}
