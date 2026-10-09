#!/usr/bin/env node
// Build the CodeMirror 6 vendor bundle for the web editor (web/editor-vendor.js).
//
// Reproducible: installs EXACT pinned versions into an isolated temp directory,
// bundles with esbuild (IIFE, global MDEditorVendor), and writes a license
// attribution file. The repository ships only the built artifacts, so the
// runtime app has zero npm runtime dependencies and no CDN.
//
// Usage: node scripts/build-editor.mjs [--keep-temp]

import { mkdtemp, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const KEEP = process.argv.includes('--keep-temp');

// Pinned direct dependencies (recorded here for reproducibility).
export const PINNED = {
  '@codemirror/state': '6.5.2',
  '@codemirror/view': '6.36.5',
  '@codemirror/commands': '6.8.1',
  '@codemirror/language': '6.11.0',
  '@codemirror/search': '6.5.10',
  '@codemirror/autocomplete': '6.18.6',
  '@codemirror/lang-markdown': '6.3.2',
  '@codemirror/lang-javascript': '6.2.3',
  '@codemirror/lang-css': '6.3.1',
  '@codemirror/lang-html': '6.4.9',
  '@codemirror/lang-json': '6.0.1',
  '@codemirror/lang-python': '6.2.1',
  '@codemirror/lang-java': '6.0.2',
  '@codemirror/lang-cpp': '6.0.3',
  '@codemirror/lang-rust': '6.0.2',
  '@codemirror/lang-php': '6.0.2',
  '@codemirror/lang-sql': '6.9.0',
  '@codemirror/lang-xml': '6.1.0',
  '@codemirror/lang-yaml': '6.1.0',
  'esbuild': '0.25.4',
};

export const ENTRY = `export { EditorState, Compartment, StateEffect, Transaction } from '@codemirror/state';
export { EditorView, keymap, drawSelection, dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, placeholder, ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
export { history, historyKeymap, defaultKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
export { foldKeymap, foldCode, unfoldCode, foldAll, unfoldAll, codeFolding, indentOnInput, bracketMatching, indentUnit, syntaxHighlighting, defaultHighlightStyle, HighlightStyle, LanguageSupport, StreamLanguage, LanguageDescription } from '@codemirror/language';
export { searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, findNext, findPrevious, replaceNext, replaceAll, SearchQuery, search, setSearchQuery } from '@codemirror/search';
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion, CompletionContext, completeFromList } from '@codemirror/autocomplete';
export { markdown, markdownKeymap, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
export { javascriptLanguage, typescriptLanguage, jsxLanguage, tsxLanguage } from '@codemirror/lang-javascript';
export { cssLanguage } from '@codemirror/lang-css';
export { htmlLanguage } from '@codemirror/lang-html';
export { jsonLanguage } from '@codemirror/lang-json';
export { pythonLanguage } from '@codemirror/lang-python';
export { javaLanguage } from '@codemirror/lang-java';
export { cppLanguage } from '@codemirror/lang-cpp';
export { rustLanguage } from '@codemirror/lang-rust';
export { phpLanguage } from '@codemirror/lang-php';
export { sql, StandardSQL } from '@codemirror/lang-sql';
export { xmlLanguage } from '@codemirror/lang-xml';
export { yamlLanguage } from '@codemirror/lang-yaml';
export { tags } from '@lezer/highlight';
`;

// Walk node_modules and return every installed package (name, version, dir).
async function walkPackages(nodeModules) {
  const found = new Map();
  async function scan(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === '.bin') continue;
      if (entry.name.startsWith('@')) { await scan(full); continue; }
      const pkgJson = path.join(full, 'package.json');
      if (existsSync(pkgJson)) {
        try {
          const meta = JSON.parse(await readFile(pkgJson, 'utf8'));
          if (meta.name) {
            const depth = full.split(path.sep).length;
            const existing = found.get(meta.name);
            // Prefer the shallowest copy: that is the one esbuild resolves.
            if (!existing || depth < existing.depth) found.set(meta.name, { name: meta.name, version: meta.version, dir: full, depth });
          }
        } catch { /* ignore malformed */ }
      }
      const nested = path.join(full, 'node_modules');
      if (existsSync(nested)) await scan(nested);
    }
  }
  await scan(nodeModules);
  return found;
}

async function readLicense(dir) {
  let entries;
  try { entries = await readdir(dir); } catch { return ''; }
  const candidates = entries.filter(n => /^licen[cs]e(\..+)?$/i.test(n) || /^copying/i.test(n)).sort();
  const chunks = [];
  for (const name of candidates) {
    try {
      const st = await stat(path.join(dir, name));
      if (st.isFile() && st.size < 200000) chunks.push(await readFile(path.join(dir, name), 'utf8'));
    } catch { /* ignore */ }
  }
  return chunks.join('\n');
}

async function buildLicense(nodeModules, versions) {
  const pkgs = await walkPackages(nodeModules);
  const names = [...pkgs.keys()].filter(n => n !== 'esbuild' && n !== 'md2pdf-editor-build').sort();
  const lines = [
    'CodeMirror 6 vendor bundle - third-party license attribution',
    '',
    'web/editor-vendor.js bundles the following packages (versions resolved at build time).',
    'Build script: scripts/build-editor.mjs',
    '',
    'Packages:',
  ];
  for (const name of names) {
    const pkg = pkgs.get(name);
    let license = 'UNKNOWN';
    try { license = JSON.parse(await readFile(path.join(pkg.dir, 'package.json'), 'utf8')).license || 'UNKNOWN'; } catch { /* ignore */ }
    lines.push('  - ' + name + '@' + pkg.version + ' (' + license + ')');
  }
  lines.push('', '='.repeat(72), '');
  for (const name of names) {
    const pkg = pkgs.get(name);
    const text = await readLicense(pkg.dir);
    lines.push('-'.repeat(72));
    lines.push(name + '@' + pkg.version);
    lines.push('-'.repeat(72));
    lines.push(text.trim() || '(license text not found in package)');
    lines.push('');
  }
  lines.push('Direct pinned versions:', JSON.stringify(versions, null, 2));
  return lines.join('\n') + '\n';
}

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-editor-build-'));
  process.stdout.write('build dir: ' + temp + '\n');
  try {
    await writeFile(path.join(temp, 'package.json'), JSON.stringify({
      name: 'md2pdf-editor-build', private: true, version: '0.0.0', type: 'module', dependencies: PINNED,
    }, null, 2) + '\n');
    await writeFile(path.join(temp, 'entry.mjs'), ENTRY);
    process.stdout.write('installing pinned dependencies…\n');
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: temp, maxBuffer: 64 * 1024 * 1024 });
    const esbuild = path.join(temp, 'node_modules', '.bin', 'esbuild');
    const outfile = path.join(WEB, 'editor-vendor.js');
    process.stdout.write('bundling with esbuild…\n');
    await execFileAsync(esbuild, [
      'entry.mjs',
      '--bundle', '--format=iife', '--global-name=MDEditorVendor',
      '--target=es2020', '--minify', '--legal-comments=none',
      '--outfile=' + outfile,
    ], { cwd: temp, maxBuffer: 64 * 1024 * 1024 });
    const st = await stat(outfile);
    const license = await buildLicense(path.join(temp, 'node_modules'), PINNED);
    await writeFile(path.join(WEB, 'editor-vendor.LICENSE.txt'), license);
    process.stdout.write('wrote web/editor-vendor.js (' + Math.round(st.size / 1024) + ' KB)\n');
    process.stdout.write('wrote web/editor-vendor.LICENSE.txt\n');
  } finally {
    if (!KEEP) await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
