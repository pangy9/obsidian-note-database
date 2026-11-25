// Rules, schema, and note frontmatter are written separately. A scheduler
// sharing the same source must not publish a partially applied option rename.
const listeners = new WeakMap<object, (busy: boolean) => void>();
const counts = new WeakMap<object, number>();

export function observeReminderReadBarrier(source: object, listener: (busy: boolean) => void): () => void {
  listeners.set(source, listener);
  return () => { if (listeners.get(source) === listener) listeners.delete(source); };
}

export function holdReminderReads(source: object): () => void {
  const count = counts.get(source) ?? 0;
  if (count === 0) listeners.get(source)?.(true);
  counts.set(source, count + 1);
  return () => {
    const remaining = (counts.get(source) ?? 1) - 1;
    if (remaining > 0) counts.set(source, remaining);
    else {
      counts.delete(source);
      listeners.get(source)?.(false);
    }
  };
}
