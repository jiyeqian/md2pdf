# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## What this is

`md2pdf` is a CLI that converts Markdown into styled Chinese A4 PDFs. It renders via headless Chrome (CDP `Page.printToPDF`) with a bundled Markdown parser. **Zero npm runtime dependencies** — `marked` is vendored at `vendor/marked.esm.js`, MathJax (LaTeX math) at `vendor/mathjax/tex-svg.js`, Paged.js (GB-only paging: odd/even headers, per-section page numbers, TOC `target-counter`) at `vendor/pagedjs/paged.polyfill.min.js`. `package.json` has `"type": "module"` (pure ESM, no build step). Published to public npm as `@jiyeqian/md2pdf`.

## Commands

```bash
# Run the converter (dev): writes <file>.pdf next to the source
node src/md2pdf.mjs examples/general.md -o /tmp/out.pdf

# Install globally from npm (real users); link in-repo for dev (edits take effect immediately)
npm install -g @jiyeqian/md2pdf
npm link                      # in-repo dev install

# Full validation — same script local and CI run (no browser needed, ~seconds)
bash ci/validate.sh            # or: npm test / npm run validate

# Render HTML only (no Chrome) — for style debugging and CI
node src/md2pdf.mjs examples/general.md --html-only --keep-html

# Inspect a generated PDF's bookmark tree and internal link annotations
node ci/inspect-pdf.mjs out.pdf

# Regenerate demo PDFs (examples/) + README theme images (docs/) — keep both in sync
bash ci/build-demo-assets.sh
```

There is no unit-test framework. Tests are the assertion scripts under `ci/`, driven by `ci/validate.sh`. To run a single test layer, invoke `node ci/checks.mjs <root>` directly (it covers version consistency, placeholder/theme-variable closure, and end-to-end HTML rendering assertions). A trailing "guard self-test" in `ci/validate.sh` deliberately corrupts copies of the repo and asserts validation *fails* — keep that pattern: a check that only ever passes is considered broken.

## Architecture

Pipeline: `Markdown --(marked)--> HTML --(shell.html + base.css + theme-*.css)--> full HTML --(headless Chrome, CDP)--> PDF`.

- **`bin/md2pdf`** — POSIX sh launcher. Resolves symlinks to find the package root, then picks a Node binary preferring ≥22 (global `WebSocket`); falls back to any Node. Env `MD2PDF_NODE` overrides. Execs `src/md2pdf.mjs`. This symlink resolution is what lets the same launcher work both from a repo checkout (`npm link`) and from `node_modules/@jiyeqian/md2pdf` (global install).
- **`src/md2pdf.mjs`** — the whole program in one file. Sections are clearly delimited: arg parsing (`parseArgs`/`expandArgs`), frontmatter (`splitFrontmatter`/`buildMeta`), HTML post-processing (`sectionize`, heading id injection, TOC, math detection), Chrome driver (`Chrome` class: spawns headless Chrome, talks CDP over WebSocket, `print` uses `preferCSSPageSize: true` so CSS `@page` controls size/margins), and `main`. When the body contains `$...$` / `$$...$$`, it injects a vendored MathJax (`tex-svg`) script and `print` polls `window.__md2pdfMathReady` before `Page.printToPDF`. MathJax is configured with `tags: "all"`, so every display equation is auto-numbered and `\label{eq:x}` / `\eqref{eq:x}` cross-reference them (LaTeX-style). Figures and tables are also auto-numbered (`numberFloats`), across three figure kinds — mermaid (` ```mermaid ` blocks, rendered in-browser via a vendored Mermaid and awaited like MathJax), raster images, and vector SVG — plus tables. Images/SVG take the caption from `alt` (with `{#fig:x}`), mermaid takes a preceding `图：…` line; tables take a preceding `表：…` line. All figures get a `图 N：…` caption and are referenced with `\ref{fig:x}` / `\ref{tab:x}` (which render as links to the figure/table anchor). Markdown footnotes (`[^id]:` definitions) are parsed out; BibTeX footnotes (`@article{...}` etc.) are rendered as GB/T 7714-2025 citations and collected into a `参考文献` section by default; reference numbers are assigned by first-citation order in the body (LaTeX-style), not by definition order (`--bibliography footnote` is the default mode; `--no-bibliography` keeps them as plain footnotes). Section numbering has two axes: behavior `--numbering auto|force|none`, and format `--number-scheme arabic|gb|cjk|chapter` (`src/numbering.mjs` has the `NUMBER_SCHEMES` formatters; unknown scheme throws). H2–H6 get numbers, H1 is the document title, left unnumbered. The resolved document type is printed in each output line as `type=xxx`.
- **`src/profiles.mjs`** — document-type presets (`P0` skeleton): the `PROFILES` registry (`general`, `skill`) plus `detectProfile({ basename, fm, explicit })`. Detection order: explicit `--type` (unknown value throws, same style as `--theme`) > filename `SKILL.md` > frontmatter has `name` (→ `skill`) > fallback `general`. A profile carries `kicker`, `skillMeta` (drives the `SKILL NAME` meta label and the `SKILL · <name>` colophon), `skipBadges` (skip figure-numbering for badge images, used by `readme`), `paperHeader`, `gbDoc` (cover page + `标准号` page header + GB chapter/clause & appendix-letter numbering, used by `gb`), `tocTitle` and a `defaults` slot merged under explicit CLI flags (e.g. `readme.defaults.toc = true` turns on the TOC by default; `opts.toc` is tri-state `undefined|true|false` so an explicit `--no-toc` still wins). See `docs/plan-profiles.md` for the roadmap (P1 jekyll, P2 numbering schemes, P3 GB, P4 extension syntax).
- **`src/ws.mjs`** — `MiniWebSocket` fallback for Node < 22 (used when `WebSocket` is undefined or `MD2PDF_WS=mini`).
- **`src/install-skill.mjs`** — npm `postinstall` hook. Copies `skill/SKILL.md` into `~/.workbuddy/skills/md-to-pdf` (only when `~/.workbuddy` exists). `MD2PDF_SKILL=0` skips, `MD2PDF_SKILL_DIR` overrides the destination. Never fails the install.
- **`assets/`** — `shell.html` (page skeleton with `{{PLACEHOLDER}}` slots), `base.css` (skeleton with `{{PAGE_SIZE}}`/four-value margin/font-size placeholders), `theme-elegant.css` (default), `theme-minimal.css`, `theme-gb.css` (GB layout on top of Paged.js named pages).
- **`templates/` + `examples/`** — for every `--type` (general/skill/readme/paper/gb) there is exactly one starter template and one full example, kept in 1:1 correspondence (enforced by `ci/checks.mjs`): `templates/<type>.md` ↔ `examples/<type or README>.md` ↔ `examples/<name>.pdf`. The readme example (`examples/README.md`) doubles as the examples-directory tour. Sample PDFs are committed artifacts — rebuild via `ci/build-demo-assets.sh` (mtime-incremental; unrelated samples are skipped).
- **`--paged-html` vs `--keep-html`** — `--paged-html` emits a browser-paginated HTML (Paged.js injected for every type + page-number/footer margin boxes for non-gb; mirrors the PDF layout); `--keep-html` emits the pre-pagination debug HTML. The PDF render path must stay Paged.js-free for non-gb types (the two HTML variants are kept separate on purpose).
- **`ci/checks.mjs`** — consistency + end-to-end HTML assertions (no browser). **`ci/inspect-pdf.mjs`** — reads PDF bookmarks/links for local verification only. **`ci/validate.sh`** — orchestrates: structure, syntax (`sh -n`/`node --check`), consistency, behavior, and the guard self-test.

## Key invariants (enforced by validation)

- **Version is declared twice and must match**: the `VERSION` const in `src/md2pdf.mjs` and `"version"` in `package.json`. Update both when releasing. `npm publish` requires a version not already published.
- **The npm tarball must be self-contained**: `package.json` `files` whitelists `bin/src/assets/vendor/skill`. Anything the installed command or `postinstall` needs at runtime must be listed there (e.g. `skill/` for the postinstall copy).
- Placeholders in `assets/shell.html` and `assets/base.css` must be in 1:1 correspondence with the replacement logic in `src/md2pdf.mjs` (the `fill`/CSS `.replace` calls). Every `var(--x)` referenced in theme CSS must be defined.
- **README theme images (`docs/theme-*.png`) and sample PDFs (`examples/*.pdf`) must stay in sync** — both are committed artifacts of the same render. After changing `examples/general.md` (or any sample), the CSS/themes, or layout logic, run `ci/build-demo-assets.sh` (mtime-incremental: renders `examples/general.md` to `examples/general-<theme>.pdf` + the other typed samples, then derives `docs/theme-<theme>.png` from each general PDF's first page via `pdftoppm`; unrelated samples are skipped) and commit both. The README links the images to the PDFs and shows them in a 2-column table.- Markdown/HTML processing that CI asserts on: H1 promoted to header + first paragraph becomes lead; H2 sections get `id="sec-N"` and are wrapped in `<section>`; TOC entries must be clickable `<a href="#...">` links (not plain text); the `generateDocumentOutline: true` param must reach `Page.printToPDF` (drives PDF bookmarks from h1–h6).

## Git remote

`origin` is `https://cnb.cool/jiyeqian/md2pdf`. Authentication uses a CNB access token (username `cnb`, **not** SSH — CNB does not support SSH) stored in the macOS keychain via `credential.helper=osxkeychain`. Push with plain `git push origin main`; the tracking ref updates automatically.

## Known issues / TODO

- **Regenerated PDFs are never byte-identical.** `examples/*.pdf` are committed artifacts, but Chrome `Page.printToPDF` embeds a creation timestamp (`/CreationDate`, `/ModDate`, and possibly `/ID`), so rebuilding via `ci/build-demo-assets.sh` always produces different bytes — the visual content is identical. Mermaid ids are already deterministic (`deterministicIds: true` in the mermaid init), so the timestamp is the remaining source of churn. Possible future fix (not done, small risk): post-process each PDF to normalize `/CreationDate` / `/ModDate`.

- **Sample artifacts are only rebuilt when their inputs change**（项目策略，2026-09-19 确认）. `ci/build-demo-assets.sh` rebuilds everything today; incremental skip by input mtime/hash is a possible future improvement. Unrelated samples must not be re-rendered just to churn bytes.

- **GB cover font fidelity depends on 方正 fonts being installed**（小标宋/黑体/书宋），most machines fall back to system fonts — documented with remaining sub-3mm layout deviations and Paged.js quirks in `docs/gb-template.md` §已知边界（含：named-page bottom margin 的 Paged.js 疑似失效已绕过、强制分页末行 justify 拉伸的覆盖规则、GB logo 为官方提取位图未矢量化）。


## Release process

Bump `VERSION` and `package.json` version together, then tag and push — CNB CI publishes to npm on tag_push:

```bash
git tag v1.4.0 && git push origin v1.4.0
```

`ci/validate.sh` runs on push/PR; on tag_push it additionally runs `npm publish --access public` (requires an `NPM_TOKEN` secret configured in the CNB project — see `.cnb.yml`). Manual publish is just `npm publish`. **CNB does not allow deleting tags** — a bad tag means bumping the version and releasing again.

## Environment variables

`MD2PDF_CHROME` (browser path), `MD2PDF_NODE` (node path), `MD2PDF_WS=mini` (force bundled WebSocket), `MD2PDF_SKILL=0` / `MD2PDF_SKILL_DIR` (postinstall skill install control — see README).
