const locks = new Map<string, Promise<void>>();
export async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  await prev;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
