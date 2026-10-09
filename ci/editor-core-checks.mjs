#!/usr/bin/env node
// Core checks for the md2pdf web editor (no browser).
//
// Covers: vendor bundle API surface, pure helper behavior, JS syntax, and
// contract-level source assertions (bridge, events, API, no eval/unsafe HTML).
//
// Run: node ci/editor-core-checks.mjs

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (condition) { process.stdout.write('  ok   ' + message + '\n'); }
  else { failures++; process.stdout.write('  FAIL ' + message + '\n'); }
}

const CORE = path.join(ROOT, 'web/editor-core.js');
const VENDOR = path.join(ROOT, 'web/editor-vendor.js');
const LICENSE = path.join(ROOT, 'web/editor-vendor.LICENSE.txt');

const REQUIRED_VENDOR = [
  'EditorView', 'EditorState', 'Compartment', 'StateEffect', 'Transaction',
  'keymap', 'lineNumbers', 'highlightActiveLine', 'highlightSpecialChars', 'drawSelection',
  'history', 'historyKeymap', 'defaultKeymap', 'undo', 'redo', 'indentWithTab',
  'searchKeymap', 'openSearchPanel', 'replaceAll', 'search',
  'autocompletion', 'closeBrackets', 'closeBracketsKeymap', 'completionKeymap',
  'foldKeymap', 'foldCode', 'unfoldCode', 'codeFolding',
  'indentOnInput', 'bracketMatching', 'syntaxHighlighting', 'defaultHighlightStyle', 'HighlightStyle', 'tags',
  'markdown', 'markdownKeymap', 'markdownLanguage',
  'javascriptLanguage', 'typescriptLanguage', 'jsxLanguage', 'tsxLanguage',
  'cssLanguage', 'htmlLanguage', 'jsonLanguage', 'pythonLanguage', 'javaLanguage',
  'cppLanguage', 'rustLanguage', 'phpLanguage', 'sql', 'xmlLanguage', 'yamlLanguage',
];

const REQUIRED_API = [
  'getValue', 'setValue', 'focus', 'getSelection', 'replaceSelection', 'replaceRange',
  'setSelection', 'goToLine', 'getCursorLine', 'runCommand', 'setCompletions',
];

async function checkVendor() {
  process.stdout.write('vendor bundle\n');
  assert(existsSync(VENDOR), 'web/editor-vendor.js exists');
  const source = await readFile(VENDOR, 'utf8');
  const sandbox = { window: {}, self: {}, console: { warn() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'editor-vendor.js' });
  const V = sandbox.MDEditorVendor;
  assert(!!V, 'vendor exposes global MDEditorVendor');
  const missing = REQUIRED_VENDOR.filter(name => !(name in (V || {})));
  assert(missing.length === 0, 'required exports present' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  assert(!/\bcdn\.|unpkg|jsdelivr/i.test(source), 'bundle contains no CDN references');
  // Tag names used by the core highlight style must exist.
  const tagNames = ['heading', 'strong', 'emphasis', 'strikethrough', 'link', 'url', 'monospace', 'keyword', 'string', 'comment', 'number', 'bool', 'typeName', 'quote', 'list'];
  const badTags = tagNames.filter(name => !(V && V.tags && name in V.tags));
  assert(badTags.length === 0, 'highlight tag names resolved' + (badTags.length ? ' (missing: ' + badTags.join(', ') + ')' : ''));
}

async function checkHelpers() {
  process.stdout.write('pure helpers\n');
  // editor-core.js is DOM-guarded; importing it under Node only installs helpers.
  await import(pathToFileURL(CORE).href);
  const h = globalThis.mdEditorCoreHelpers;
  assert(!!h, 'helpers exposed as mdEditorCoreHelpers');
  if (!h) return;

  assert(h.clamp(5, 0, 3) === 3, 'clamp upper bound');
  assert(h.clamp(-2, 0, 3) === 0, 'clamp lower bound');
  assert(h.clamp(NaN, 4, 9) === 4, 'clamp NaN -> min');

  assert(JSON.stringify(h.normalizeRange(10, 7, 2)) === JSON.stringify({ from: 2, to: 7 }), 'normalizeRange orders');
  assert(JSON.stringify(h.normalizeRange(5, 99, -3)) === JSON.stringify({ from: 0, to: 5 }), 'normalizeRange clamps');
  assert(JSON.stringify(h.normalizeRange(5, 2)) === JSON.stringify({ from: 2, to: 2 }), 'normalizeRange single offset');

  const text = 'a\nbb\nccc';
  assert(h.offsetToLine(text, 0) === 1, 'offsetToLine start');
  assert(h.offsetToLine(text, 2) === 2, 'offsetToLine second line');
  assert(h.offsetToLine(text, 5) === 3, 'offsetToLine third line');
  assert(h.offsetToLine(text, 999) === 3, 'offsetToLine clamps end');
  assert(h.lineToOffset(text, 1) === 0, 'lineToOffset first');
  assert(h.lineToOffset(text, 2) === 2, 'lineToOffset second');
  assert(h.lineToOffset(text, 3) === 5, 'lineToOffset third');
  assert(h.lineToOffset(text, 99) === 5, 'lineToOffset clamps to last line start');
  assert(h.lineCount(text) === 3, 'lineCount');
  assert(h.lineCount('') === 1, 'lineCount empty');
}

async function checkSourceContract() {
  process.stdout.write('core source contract\n');
  const source = await readFile(CORE, 'utf8');
  assert(!/\beval\s*\(/.test(source), 'no eval()');
  assert(!/\.innerHTML\s*=/.test(source), 'no innerHTML assignment');
  assert(source.includes('Object.getOwnPropertyDescriptor') && source.includes('HTMLTextAreaElement.prototype'), 'native descriptor bridge used');
  assert(source.includes("new Event('input', { bubbles: true })"), 'typed changes dispatch bubbling input');
  assert(source.includes('textarea.hidden = true'), 'textarea hidden after init');
  for (const name of REQUIRED_API) assert(source.includes(name + ':'), 'api method ' + name);
  for (const event of ['md-editor-ready', 'md-editor-change', 'md-editor-cursor']) assert(source.includes(event), 'event ' + event);
  for (const command of ['undo', 'redo', 'find', 'replace', 'fold', 'unfold', 'toggleFold']) assert(source.includes(command + ':'), 'command ' + command);
  assert(source.includes('toggleFold: function () { return V.unfoldCode(view) || V.foldCode(view); }'), 'toggleFold prefers unfold then fold at the current position');
  assert(source.includes("aria-label': 'Markdown 正文编辑器'"), 'content aria-label (Chinese)');
}

async function checkLicense() {
  process.stdout.write('license attribution\n');
  assert(existsSync(LICENSE), 'web/editor-vendor.LICENSE.txt exists');
  if (!existsSync(LICENSE)) return;
  const license = await readFile(LICENSE, 'utf8');
  assert(/@codemirror\/state/.test(license), 'license lists @codemirror/state');
  assert(/@codemirror\/lang-markdown/.test(license), 'license lists @codemirror/lang-markdown');
  const build = await readFile(path.join(ROOT, 'scripts/build-editor.mjs'), 'utf8');
  const pins = [...build.matchAll(/'([^']+)': '([\d.]+)'/g)].map(m => [m[1], m[2]]).filter(([name]) => name.startsWith('@codemirror/'));
  assert(pins.length >= 15, 'build script records pinned CodeMirror versions');
  const mismatched = pins.filter(([name, version]) => !license.includes(name + '@' + version));
  assert(mismatched.length === 0, 'pinned versions match license manifest' + (mismatched.length ? ' (mismatch: ' + mismatched.map(p => p.join('@')).join(', ') + ')' : ''));
}

async function main() {
  await checkVendor();
  await checkHelpers();
  await checkSourceContract();
  await checkLicense();
  process.stdout.write('\n' + (checks - failures) + '/' + checks + ' checks passed\n');
  if (failures) { process.stdout.write(failures + ' check(s) failed\n'); process.exit(1); }
}

main().catch(error => { console.error(error); process.exit(1); });
