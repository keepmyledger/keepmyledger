import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '@keepmyledger/shared';

/**
 * Searchable category picker. Renders a text input that filters a dropdown
 * list as you type. Use this in place of <select> when the category count is
 * large enough that scrolling is painful.
 */
export function CategoryCombobox({
  categories,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Uncategorized',
  invalid = false,
  width = 220,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreateNew?: () => void;
  placeholder?: string;
  invalid?: boolean;
  width?: number | string;
}) {
  const selected = value != null ? categories.find((c) => c.id === value) ?? null : null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query when selection changes externally or when closing
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  // Build the option list, including the optional "create new" sentinel at end
  type Item =
    | { kind: 'category'; id: number; name: string }
    | { kind: 'clear' }
    | { kind: 'create' };
  const items: Item[] = useMemo(() => {
    const list: Item[] = [];
    if (selected) list.push({ kind: 'clear' });
    for (const c of filtered) list.push({ kind: 'category', id: c.id, name: c.name });
    if (onCreateNew) list.push({ kind: 'create' });
    return list;
  }, [filtered, selected, onCreateNew]);

  // Clamp active index
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(Math.max(0, items.length - 1));
  }, [items.length, activeIdx]);

  const choose = (item: Item) => {
    if (item.kind === 'clear') {
      onChange(null);
    } else if (item.kind === 'category') {
      onChange(item.id);
    } else if (item.kind === 'create') {
      onCreateNew?.();
    }
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && items[activeIdx]) {
        e.preventDefault();
        choose(items[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    } else if (e.key === 'Backspace' && query === '' && selected) {
      e.preventDefault();
      onChange(null);
    }
  };

  const displayValue = open ? query : selected?.name ?? '';

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block', width }}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          borderColor: invalid ? '#d9534f' : undefined,
        }}
      />
      {open && items.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            background: '#FFFDF8',
            border: '1px solid #E1DACB',
            borderTop: 'none',
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: '0 4px 16px rgba(31,41,32,0.10)',
            fontSize: 13,
          }}
        >
          {items.map((item, idx) => {
            const isActive = idx === activeIdx;
            const label =
              item.kind === 'clear' ? 'Uncategorized'
              : item.kind === 'create' ? '+ Create new…'
              : item.name;
            const color =
              item.kind === 'clear' ? '#5E5E5E'
              : item.kind === 'create' ? '#2E7D61'
              : undefined;
            return (
              <li
                key={item.kind === 'category' ? `c-${item.id}` : item.kind}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                onMouseEnter={() => setActiveIdx(idx)}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  background: isActive ? '#e6f0ff' : undefined,
                  color,
                  fontStyle: item.kind === 'clear' ? 'italic' : undefined,
                }}
              >
                {label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
