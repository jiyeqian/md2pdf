const SINGLE = 10 * 1024 * 1024;
const TOTAL = 16 * 1024 * 1024;

export function imageMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return 'image/png';
  const prefix = String.fromCharCode(...bytes.slice(0,12));
  if (/^GIF8[79]a/.test(prefix)) return 'image/gif';
  if (prefix.startsWith('RIFF') && prefix.slice(8,12) === 'WEBP') return 'image/webp';
  throw new Error('仅支持 PNG、JPEG、GIF、WebP 图片。');
}

export function createCloudImages({ readImage, lex, walkTokens }) {
  const cache = new Map(); let cachedBytes = 0;
  return async (md, signal) => {
    signal?.throwIfAborted();
    const hrefs = new Set();
    walkTokens(lex(md), token => {
      if (token.type === 'image' && token.href && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(token.href)) hrefs.add(token.href);
    });
    if (hrefs.size > 100) throw new Error('云端图片超过 100 张，请减少图片后重试。');
    const assets = Object.create(null); let total = 0;
    for (const href of hrefs) {
      signal?.throwIfAborted();
      try {
        let image = cache.get(href);
        if (!image) {
          const bytes = await readImage(href);
          signal?.throwIfAborted();
          if (bytes.length > SINGLE) throw new Error('单张图片超过 10 MiB。');
          const mime = imageMime(bytes);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          image = { data:`data:${mime};base64,${btoa(binary)}`, size:bytes.length };
          while (cache.size && cachedBytes + image.size > TOTAL) { const [key,old] = cache.entries().next().value;cache.delete(key);cachedBytes -= old.size; }
          cache.set(href,image);cachedBytes += image.size;
        }
        total += image.size;
        if (total > TOTAL) throw new Error('云端图片合计超过 16 MiB。');
        assets[href] = image.data;
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        throw new Error(`图片“${href}”加载失败：${error.message}`);
      }
    }
    return assets;
  };
}
