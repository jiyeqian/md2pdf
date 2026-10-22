export function createDocumentAssetCache(maxEntries = 4) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer');
  const entries = new Map();

  function trim() {
    while (entries.size > maxEntries) {
      const oldestReady = [...entries].find(([, entry]) => entry.state === 'ready');
      if (!oldestReady) return;
      entries.delete(oldestReady[0]);
    }
  }

  return async function get(key, load) {
    let entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      return entry.promise;
    }

    entry = { state:'pending', promise:null };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.state = 'ready';
      trim();
      return value;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    trim();
    return entry.promise;
  };
}
