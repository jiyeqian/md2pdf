// 浏览器与接收服务使用同一字段白名单，防止文档内容进入统计。
const templates = ['general', 'paper', 'gb', 'skill'];
const method = ['server-pdf', 'browser-print'];
const schemas = {
  page_view: {
    source: ['direct', 'search', 'social', 'referral', 'campaign'],
    campaign: ['github', 'wechat', 'zhihu', 'xiaohongshu', 'other'],
    device: ['desktop', 'mobile', 'tablet'],
    browser: ['chrome', 'safari', 'firefox', 'edge', 'other'],
    os: ['windows', 'macos', 'ios', 'android', 'linux', 'other'],
    language: ['zh', 'en', 'other'],
  },
  template_selected: { template: templates, theme: ['elegant', 'minimal', 'gb'] },
  preview_finished: {
    success: 'boolean', duration: ['lt1s', '1to3s', '3to10s', '10to30s', 'gte30s'],
    length: ['lt1k', '1kto10k', '10kto50k', 'gte50k'], template: templates,
  },
  export_started: { method },
  export_failed: { method, code: ['unavailable', 'timeout', 'failed'] },
  offline_ready: { ready: 'boolean' },
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateEvent(value) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'deployment,event,properties,version') return null;
  if (typeof value.event !== 'string' || !Object.hasOwn(schemas, value.event)) return null;
  if (typeof value.version !== 'string' || value.version.length > 64 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version)) return null;
  if (!['server', 'static'].includes(value.deployment) || !record(value.properties)) return null;
  const schema = schemas[value.event];
  const properties = {};
  for (const [key, field] of Object.entries(value.properties)) {
    if (!Object.hasOwn(schema, key)) return null;
    if (schema[key] === 'boolean' ? typeof field !== 'boolean' : !schema[key].includes(field)) return null;
    properties[key] = field;
  }
  for (const key of Object.keys(schema)) if (key !== 'campaign' && !Object.hasOwn(properties, key)) return null;
  if (value.event === 'page_view' && Object.hasOwn(properties, 'campaign') && properties.source !== 'campaign') return null;
  return { event: value.event, version: value.version, deployment: value.deployment, properties };
}
