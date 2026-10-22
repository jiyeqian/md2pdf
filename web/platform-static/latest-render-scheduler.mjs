function abortError() {
  const error = new Error('渲染已由较新的请求取代。');
  error.name = 'AbortError';
  return error;
}

// Coalesces requests that have not started and aborts superseded work for the
// same consumer. Separate consumer keys (editor, each template card) never
// cancel one another. Work must still check its signal after awaited steps.
export function createLatestRenderScheduler() {
  const consumers = new Map();
  return function schedule(consumer, work, externalSignal) {
    const key = typeof consumer === 'string' && consumer ? consumer : 'default';
    let state = consumers.get(key);
    if (!state) { state = { pending: null, active: new Set(), scheduled: false }; consumers.set(key, state); }
    for (const controller of state.active) controller.abort();
    if (state.pending) state.pending.reject(abortError());
    return new Promise((resolve, reject) => {
      const job = { work, resolve, reject, externalSignal };
      state.pending = job;
      if (state.scheduled) return;
      state.scheduled = true;
      queueMicrotask(() => {
        state.scheduled = false;
        const latest = state.pending;
        state.pending = null;
        if (!latest) return;
        const controller = new AbortController();
        state.active.add(controller);
        const abort = () => controller.abort();
        if (latest.externalSignal?.aborted) abort();
        else latest.externalSignal?.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return latest.work(controller.signal);
        }).then(latest.resolve, latest.reject).finally(() => {
          latest.externalSignal?.removeEventListener('abort', abort);
          state.active.delete(controller);
        });
      });
    });
  };
}
