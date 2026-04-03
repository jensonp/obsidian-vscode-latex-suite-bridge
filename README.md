# Obsidian LaTeX Suite Bridge

VS Code / Cursor extension that reuses Obsidian LaTeX Suite snippet data for `.tex` files.

This project does **not** attempt to run Obsidian's bundled plugin host inside VS Code. It implements the snippet runtime natively against the VS Code extension API while preserving the parts of Obsidian LaTeX Suite that matter for editing behavior.

## What it supports

- Obsidian `data.json` loading through `obsidianLatexSuite.obsidianDataJsonPath`
- JavaScript-evaluated `snippets` and `snippetVariables`
- string triggers, regex triggers, and `r`-option regex triggers
- function-valued replacements
- mode flags such as `m`, `n`, `M`, `t`
- automatic snippets with `A`
- word-boundary snippets with `w`
- Obsidian-style slash-triggered auto-fraction
- tabout over math delimiters and closing brackets

## What it does not do

- it does not run Obsidian's `main.js` directly
- it does not depend on the Obsidian plugin lifecycle or vault APIs
- it currently targets LaTeX editors only: `latex` / `tex` language ids and `.tex` files

## Install locally

1. Clone the repo.
2. Set `obsidianLatexSuite.obsidianDataJsonPath` to the absolute path of your Obsidian LaTeX Suite `data.json`.
3. Copy or symlink the extension into your VS Code or Cursor extensions folder, or package it as a VSIX.
4. Reload the editor window.

## Behavior notes

- `mk` and `dm` semantics come from your Obsidian snippet source, not from this bridge.
- If your Obsidian `data.json` defines `dm` as display math, this bridge keeps that behavior.
- If your Obsidian `data.json` defines `mk` as inline math, this bridge keeps that behavior.

## Tests

```bash
npm test
```

or:

```bash
node --test
```

## Files

- `core.js`: snippet loading, mode detection, matching, auto-fraction, tabout
- `extension.js`: VS Code integration layer
- `test/core.test.js`: runtime regression tests
- `FINDINGS.md`: implementation notes and parity decisions
