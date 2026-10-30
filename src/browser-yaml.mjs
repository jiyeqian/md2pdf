// Use the same vendored YAML parser in the editor and the static runtime.
export function browserYaml(source) {
  const yaml = source.replace(/^import \{ createRequire \} from "node:module"; const require = createRequire\(import.meta.url\);/m,
    `const require = name => { if (name === 'process') return { env:{}, emitWarning:message => console.warn(message) }; if (name === 'buffer') return {}; throw new Error('不支持的浏览器模块：' + name); };`);
  if (/from ["']node:/.test(yaml)) throw new Error('YAML 浏览器适配失败');
  return yaml;
}
