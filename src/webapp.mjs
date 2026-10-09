const HELP = `用法：md2pdf webapp [--port <端口>]

默认地址：http://127.0.0.1:3000
  --port <端口>  指定端口（1–65535）
  -h, --help     显示帮助
按 Ctrl+C 停止工作台。`;

export function parseWebappArgs(args) {
  let port = 3000;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg !== '--port' && !arg.startsWith('--port=')) throw new Error(`webapp 不支持参数：${arg}`);
    const value = arg === '--port' ? args[++i] : arg.slice(7);
    if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535) {
      throw new Error('--port 必须是 1–65535 之间的整数');
    }
    port = Number(value);
  }
  return { port, help };
}

export async function runWebapp(args) {
  const { port, help } = parseWebappArgs(args);
  if (help) { console.log(HELP); return; }
  const { startServer } = await import('./server.mjs');
  // The installed command is a local workbench; public deployment uses server.mjs.
  return startServer({ port, publicHost: '' });
}
