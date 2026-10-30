import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();
const broadcast = () => {
  for (const listener of listeners) listener();
};

/** One stdout subscription shared by all viewports; resizing never resets UI state. */
export function useTerminalSize() {
  const measure = () => ({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });
  const [size, setSize] = useState(measure);
  useEffect(() => {
    const resize = () => setSize(measure());
    if (!listeners.size) process.stdout.on('resize', broadcast);
    listeners.add(resize);
    return () => {
      listeners.delete(resize);
      if (!listeners.size) process.stdout.off('resize', broadcast);
    };
  }, []);
  return size;
}

export function useViewport(reservedRows = 14, maximum = 30): number {
  const { rows } = useTerminalSize();
  return Math.max(3, Math.min(maximum, rows - reservedRows));
}
