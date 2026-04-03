# Obsidian LaTeX Suite Bridge

VS Code / Cursor extension that reuses Obsidian LaTeX Suite snippet data for `.tex` files.

## Current status

The extension is working and tested. It now has:

- fixture-driven acceptance tests
- modularized core runtime (`lib/*`)
- improved word-boundary parity for typed delimiters
- basic matcher prefilter to reduce unnecessary full scans
- CI on GitHub Actions

## Features

- Loads Obsidian `data.json` from `obsidianLatexSuite.obsidianDataJsonPath`
- Evaluates JavaScript snippets and snippet variables
- Supports string, regex, and function-valued replacements
- Supports visual snippets using `${VISUAL}`
- Supports mode flags (`m`, `n`, `M`, `t`, `c`), auto snippets (`A`), and word-boundary snippets (`w`)
- Supports slash-triggered auto-fraction
- Supports tabout in math context
- Auto-reloads snippets when external edits change the configured `data.json`

## Install locally

1. Clone this repo.
2. Set `obsidianLatexSuite.obsidianDataJsonPath` to your Obsidian LaTeX Suite `data.json`.
3. Install locally as an unpacked extension or package to VSIX.
4. Reload the editor window.

## Commands

- `npm test`
- `npm run test:ci`
- `npm run package:vsix`

## Architecture

- `extension.js`: VS Code integration and editor event wiring
- `core.js`: stable facade for runtime functions
- `lib/constants.js`: shared defaults and constants
- `lib/loader.js`: snippet/settings parsing from Obsidian data
- `lib/context.js`: math context and environment scanning
- `lib/snippets.js`: snippet matching/replacement logic
- `lib/autofraction.js`: slash-triggered fraction expansion
- `lib/tabout.js`: tabout target resolution

## Test coverage

- `test/core.test.js`: unit coverage for runtime internals
- `test/acceptance.test.js`: fixture-based behavior checks

## Notes

- This project reuses Obsidian snippet data but does not execute Obsidian's plugin host runtime.
- `mk`/`dm` behavior is controlled by the loaded Obsidian snippets, not hardcoded by this bridge.
