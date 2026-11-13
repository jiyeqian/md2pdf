// The editor's srcdoc preview inherits this policy; document output has its own stricter CSP.
const BASE = "default-src 'self'; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline'; frame-src 'self' about: https://login.microsoftonline.com; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://*.files.1drv.com https://*.up.1drv.com; object-src 'none'; base-uri 'none'; form-action 'none'";
export function pageCsp(analytics, { callback = false, meta = false } = {}) {
  let policy = BASE;
  if (analytics?.enabled) policy = policy.replace("connect-src 'self'", "connect-src 'self' " + new URL(analytics.endpoint).origin);
  return meta ? policy : policy + "; frame-ancestors " + (callback ? "'self'" : "'none'");
}
