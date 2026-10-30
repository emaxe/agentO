import { useLayoutEffect, useRef } from 'react';

/** Preserve the selected entity when filtering or reloading, independent of row indices. */
export function useStableSelection(
  ids: string[],
  selected: number,
  setSelected: (index: number) => void,
) {
  const previous = useRef({ keys: '', id: undefined as string | undefined });
  const keys = ids.join('\0');
  useLayoutEffect(() => {
    if (previous.current.keys !== keys) {
      const index = ids.indexOf(previous.current.id ?? '');
      const next = index >= 0 ? index : Math.min(selected, Math.max(0, ids.length - 1));
      previous.current = { keys, id: ids[next] };
      if (next !== selected) setSelected(next);
    } else previous.current.id = ids[selected];
  }, [keys, selected, setSelected]);
}
