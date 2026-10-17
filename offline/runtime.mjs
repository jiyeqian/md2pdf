import assets from './assets-text.mjs';
const base = new URL('./', import.meta.url);
function normalize(value) {
  const parts = [];
  for (const part of value.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
export const path = {
  sep:'/',
  join:(...parts) => normalize(parts.join('/')),
  resolve:(...parts) => normalize((parts[0]?.startsWith('/') ? '' : '/md2pdf/') + parts.join('/')),
  dirname:value => value.slice(0, value.lastIndexOf('/')) || '/',
  basename:(value, ext = '') => { const name = value.split('/').pop(); return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name; },
  extname:value => /\.[^/.]+$/.exec(value)?.[0] || '',
};
export const fileURLToPath = value => '/md2pdf/src/' + new URL(value).pathname.split('/').pop();
export const pathToFileURL = value => new URL(value.replace(/^\/md2pdf\//, ''), base);
export const existsSync = value => Object.hasOwn(assets, value);
export const readdirSync = value => Object.keys(assets).filter(key => path.dirname(key) === value).map(key => path.basename(key));
export async function readFile(value) {
  if (!existsSync(value)) throw new Error('离线资源不存在：' + value);
  return assets[value];
}
