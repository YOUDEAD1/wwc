/** Native Node fetch adapter for grammY's signal shim and streamed documents. */
export const compatibleFetch: typeof fetch = async (input, init) => {
  const body = init?.body as unknown;
  const streaming = body !== null && typeof body === 'object' && Symbol.asyncIterator in body;
  const options: RequestInit & { duplex?: 'half' } = {
    ...init,
    ...(streaming ? { duplex: 'half' as const } : {}),
  };
  const source = init?.signal;
  if (source && !globalThis.AbortSignal.prototype.isPrototypeOf(source)) {
    const native = new AbortController();
    const abort = () => native.abort();
    // The per-request source must also cancel a response body after headers arrive.
    // It is not a global signal; the source and one-shot listener are GC'd together.
    source.addEventListener('abort', abort, { once: true });
    if (source.aborted) abort();
    options.signal = native.signal;
  }
  return globalThis.fetch(input, options);
};

export const managerFetch: typeof fetch = (input, init) =>
  compatibleFetch(input, { ...init, redirect: 'error' });
