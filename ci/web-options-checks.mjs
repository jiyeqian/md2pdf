import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from '../src/profiles.mjs';
import {
  webPolicyDocument, policyForType, effectiveOptions, assertOptionsAllowed, resolveWebType,
} from '../src/web-options.mjs';

const gb = PROFILES.gb.defaults;

test('policy document exposes every type and the auto policy', () => {
  const doc = webPolicyDocument();
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.types.map(t => t.id), ['general', 'readme', 'skill', 'paper', 'gb']);
  for (const id of doc.types.map(t => t.id)) assert.ok(doc.policy[id], '缺少类型策略：' + id);
  assert.equal(doc.autoPolicy.type, 'auto');
});

test('gb policy locks everything except toc and inherits original profile defaults', () => {
  const policy = policyForType('gb');
  assert.equal(policy.locked, true);
  assert.deepEqual(policy.availableKeys, ['type', 'toc']);
  for (const key of ['theme', 'numberScheme', 'numbering', 'fontSize', 'margin']) {
    assert.equal(policy.controls[key].available, false, key + ' 应为锁定的控件');
    assert.ok(policy.lockedKeys.includes(key), key + ' 应出现在 lockedKeys');
  }
  // 固定值来自 profiles.gb（未被强制改写）
  assert.equal(policy.fixed.theme, gb.theme);
  assert.equal(policy.fixed.numberScheme, gb.numberScheme);
  assert.equal(policy.fixed.numbering, gb.numbering);
  assert.equal(policy.fixed.marginTop, gb.marginTop);
  assert.equal(policy.fixed.marginBottom, gb.marginBottom);
  assert.equal(policy.fixed.marginLeft, gb.marginLeft);
  assert.equal(policy.fixed.marginRight, gb.marginRight);
  assert.equal(policy.controls.fontSize.fixedValue, 10.5);
  assert.equal(policy.controls.toc.available, true);
  assert.equal(policy.controls.type.available, true);
});

test('paper policy does not offer the cjk numbering scheme', () => {
  const policy = policyForType('paper');
  assert.deepEqual(policy.controls.numberScheme.values, ['arabic', 'chapter']);
});

test('assertOptionsAllowed rejects forbidden overrides', () => {
  const bad = (opts, type) => assert.throws(() => assertOptionsAllowed(opts, type), { status: 400 });
  // 非 gb 类型不得使用 gb 专属取值
  bad({ theme: 'gb' }, 'general');
  bad({ numberScheme: 'gb' }, 'readme');
  // 未开放的编号方案（paper 无 cjk）
  bad({ numberScheme: 'cjk' }, 'paper');
  // gb：除 toc 外全部锁定，哪怕取值恰好等于模板默认也拒绝覆盖
  bad({ theme: 'gb' }, 'gb');
  bad({ numberScheme: 'gb' }, 'gb');
  bad({ numbering: 'force' }, 'gb');
  bad({ fontSize: 12 }, 'gb');
  bad({ marginTop: 25 }, 'gb');
  bad({ margin: 20 }, 'gb');
  bad({ marginLeft: 25 }, 'gb');
  bad({ landscape: true }, 'gb');
});

test('assertOptionsAllowed accepts the legitimate selections', () => {
  assert.doesNotThrow(() => assertOptionsAllowed({ theme: 'minimal', numberScheme: 'cjk', numbering: 'force' }, 'general'));
  assert.doesNotThrow(() => assertOptionsAllowed({ numberScheme: 'chapter' }, 'paper'));
  assert.doesNotThrow(() => assertOptionsAllowed({ toc: true, landscape: false }, 'gb'));
  assert.doesNotThrow(() => assertOptionsAllowed({}, 'gb'));
});

test('resolveWebType detects the effective type from frontmatter and explicit override', () => {
  assert.equal(resolveWebType('# 普通\n\n正文'), 'general');
  assert.equal(resolveWebType('---\nname: 日志分析\n---\n# 技能'), 'skill');
  assert.equal(resolveWebType('---\nabstract: 摘要\n---\n# 论文'), 'paper');
  assert.equal(resolveWebType('---\n标准号: GB/T 1234-2020\n---\n# 标准\n\n## 范围'), 'gb');
  assert.equal(resolveWebType('---\nstandard: GB 1\n---\n# 标准'), 'gb');
  // 显式类型优先于自动探测
  assert.equal(resolveWebType('---\n标准号: GB 1\n---\n# 标准', 'general'), 'general');
  // 无文件名时 README 不会被自动识别
  assert.equal(resolveWebType('# 项目说明'), 'general');
});

test('effectiveOptions inherits gb template defaults without mutating opts', () => {
  const opts = {};
  const effective = effectiveOptions(opts, 'gb');
  assert.equal(effective.theme, gb.theme);
  assert.equal(effective.numberScheme, gb.numberScheme);
  assert.equal(effective.numbering, gb.numbering);
  assert.equal(effective.marginTop, gb.marginTop);
  assert.equal(effective.marginRight, gb.marginRight);
  assert.equal(effective.fontSize, 10.5);
  assert.deepEqual(opts, {}, 'effectiveOptions 不得回写调用方的 opts');
});
