import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../src/render.mjs';

const body = '# 树形检查\n\n```text\nstation 变电站\n├── equipment 设备\n│   └── component 组件\n└── functional_unit 功能单元\n```\n\n```text\nordinary code\n  second line\n```';

test('tree code uses the same targeted styling in CLI and WebApp', async () => {
  for (const type of ['general', 'gb']) {
    const input = `---\ntype: ${type}\n---\n\n${body}`;
    const [cli, web] = await Promise.all([render(input), render(input, {}, {webSafe:true})]);
    const blocks = output => [...output.html.matchAll(/<pre(?: class="md-tree-code")?><code[^>]*>[\s\S]*?<\/code><\/pre>/g)].map(match => match[0]);
    assert.deepEqual(blocks(web), blocks(cli));
    assert.equal(blocks(cli).length, 2);
    assert.match(blocks(cli)[0], /^<pre class="md-tree-code">/);
    assert.match(blocks(cli)[0], /│\s+└── component 组件/);
    assert.match(blocks(cli)[1], /^<pre><code/);
  }
});
