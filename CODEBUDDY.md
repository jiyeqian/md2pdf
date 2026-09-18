# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## What this is

`md2pdf` is a CLI that converts Markdown into styled Chinese A4 PDFs. It renders via headless Chrome (CDP `Page.printToPDF`) with a bundled Markdown parser. **Zero npm runtime dependencies** — `marked` is vendored at `vendor/marked.esm.js`, MathJax (LaTeX math) at `vendor/mathjax/tex-svg.js`. `package.json` has `"type": "module"` (pure ESM, no build step). Published to public npm as `@jiyeqian/md2pdf`.

## Commands

```bash
# Run the converter (dev): writes <file>.pdf next to the source
node src/md2pdf.mjs examples/demo.md -o /tmp/out.pdf

# Install globally from npm (real users); link in-repo for dev (edits take effect immediately)
npm install -g @jiyeqian/md2pdf
npm link                      # in-repo dev install

# Full validation — same script local and CI run (no browser needed, ~seconds)
bash ci/validate.sh            # or: npm test / npm run validate

# Render HTML only (no Chrome) — for style debugging and CI
node src/md2pdf.mjs examples/demo.md --html-only --keep-html

# Inspect a generated PDF's bookmark tree and internal link annotations
node ci/inspect-pdf.mjs out.pdf

# Regenerate demo PDFs (examples/) + README theme images (docs/) — keep both in sync
bash ci/build-demo-assets.sh
```

There is no unit-test framework. Tests are the assertion scripts under `ci/`, driven by `ci/validate.sh`. To run a single test layer, invoke `node ci/checks.mjs <root>` directly (it covers version consistency, placeholder/theme-variable closure, and end-to-end HTML rendering assertions). A trailing "guard self-test" in `ci/validate.sh` deliberately corrupts copies of the repo and asserts validation *fails* — keep that pattern: a check that only ever passes is considered broken.

## Architecture

Pipeline: `Markdown --(marked)--> HTML --(shell.html + base.css + theme-*.css)--> full HTML --(headless Chrome, CDP)--> PDF`.

- **`bin/md2pdf`** — POSIX sh launcher. Resolves symlinks to find the package root, then picks a Node binary preferring ≥22 (global `WebSocket`); falls back to any Node. Env `MD2PDF_NODE` overrides. Execs `src/md2pdf.mjs`. This symlink resolution is what lets the same launcher work both from a repo checkout (`npm link`) and from `node_modules/@jiyeqian/md2pdf` (global install).
- **`src/md2pdf.mjs`** — the whole program in one file. Sections are clearly delimited: arg parsing (`parseArgs`/`expandArgs`), frontmatter (`splitFrontmatter`/`buildMeta`), HTML post-processing (`sectionize`, heading id injection, TOC, math detection), Chrome driver (`Chrome` class: spawns headless Chrome, talks CDP over WebSocket, `print` uses `preferCSSPageSize: true` so CSS `@page` controls size/margins), and `main`. When the body contains `$...$` / `$$...$$`, it injects a vendored MathJax (`tex-svg`) script and `print` polls `window.__md2pdfMathReady` before `Page.printToPDF`. Markdown footnotes (`[^id]:` definitions) are parsed out; BibTeX footnotes (`@article{...}` etc.) are rendered as GB/T 7714-2025 citations and collected into a `参考文献` section by default; reference numbers are assigned by first-citation order in the body (LaTeX-style), not by definition order (`--bibliography footnote` is the default mode; `--no-bibliography` keeps them as plain footnotes). Section numbering (`--numbering auto|force|none`) adds hierarchical numbers to H2–H6 (H1 is the document title, left unnumbered).
- **`src/ws.mjs`** — `MiniWebSocket` fallback for Node < 22 (used when `WebSocket` is undefined or `MD2PDF_WS=mini`).
- **`src/install-skill.mjs`** — npm `postinstall` hook. Copies `skill/SKILL.md` into `~/.workbuddy/skills/md-to-pdf` (only when `~/.workbuddy` exists). `MD2PDF_SKILL=0` skips, `MD2PDF_SKILL_DIR` overrides the destination. Never fails the install.
- **`assets/`** — `shell.html` (page skeleton with `{{PLACEHOLDER}}` slots), `base.css` (skeleton with `{{PAGE_SIZE}}`/margin/font-size placeholders), `theme-elegant.css` (default), `theme-minimal.css`.
- **`ci/checks.mjs`** — consistency + end-to-end HTML assertions (no browser). **`ci/inspect-pdf.mjs`** — reads PDF bookmarks/links for local verification only. **`ci/validate.sh`** — orchestrates: structure, syntax (`sh -n`/`node --check`), consistency, behavior, and the guard self-test.

## Key invariants (enforced by validation)

- **Version is declared twice and must match**: the `VERSION` const in `src/md2pdf.mjs` and `"version"` in `package.json`. Update both when releasing. `npm publish` requires a version not already published.
- **The npm tarball must be self-contained**: `package.json` `files` whitelists `bin/src/assets/vendor/skill`. Anything the installed command or `postinstall` needs at runtime must be listed there (e.g. `skill/` for the postinstall copy).
- Placeholders in `assets/shell.html` and `assets/base.css` must be in 1:1 correspondence with the replacement logic in `src/md2pdf.mjs` (the `fill`/CSS `.replace` calls). Every `var(--x)` referenced in theme CSS must be defined.
- **README theme images (`docs/theme-*.png`) and demo PDFs (`examples/demo-*.pdf`) must stay in sync** — both are committed artifacts of the same render. After changing `examples/demo.md`, the CSS/themes, or layout logic, run `ci/build-demo-assets.sh` (renders both themes to `examples/demo-<theme>.pdf`, then derives `docs/theme-<theme>.png` from each PDF's first page via `pdftoppm`) and commit both. The README links the images to the PDFs and shows them in a 2-column table.
- Markdown/HTML processing that CI asserts on: H1 promoted to header + first paragraph becomes lead; H2 sections get `id="sec-N"` and are wrapped in `<section>`; TOC entries must be clickable `<a href="#...">` links (not plain text); the `generateDocumentOutline: true` param must reach `Page.printToPDF` (drives PDF bookmarks from h1–h6).

## Release process

Bump `VERSION` and `package.json` version together, then tag and push — CNB CI publishes to npm on tag_push:

```bash
git tag v1.4.0 && git push origin v1.4.0
```

`ci/validate.sh` runs on push/PR; on tag_push it additionally runs `npm publish --access public` (requires an `NPM_TOKEN` secret configured in the CNB project — see `.cnb.yml`). Manual publish is just `npm publish`. **CNB does not allow deleting tags** — a bad tag means bumping the version and releasing again.

## Environment variables

`MD2PDF_CHROME` (browser path), `MD2PDF_NODE` (node path), `MD2PDF_WS=mini` (force bundled WebSocket), `MD2PDF_SKILL=0` / `MD2PDF_SKILL_DIR` (postinstall skill install control — see README).
