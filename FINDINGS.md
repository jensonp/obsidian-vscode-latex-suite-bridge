# Findings

## Direct reuse of Obsidian's runtime

Running Obsidian LaTeX Suite's compiled `main.js` directly inside VS Code is not a clean path.

Reason:

- Obsidian's plugin is built against Obsidian's plugin host and editor abstractions
- VS Code extensions run against a different API and event model
- the data source is portable, the host runtime is not

The practical boundary is:

- reuse Obsidian's `data.json`
- reimplement the runtime behavior in a VS Code-native extension

## Snippet source format

Obsidian LaTeX Suite snippet definitions are JavaScript, not just plain JSON.

That means the loader must support:

- regex literals
- function-valued replacements
- snippet variables such as `${GREEK}`
- string triggers with the `r` option

Treating the file as plain JSON loses real functionality.

## Matching semantics carried over

The runtime in `core.js` mirrors these parts of Obsidian LaTeX Suite:

- mode flags (`m`, `n`, `M`, `t`, `c`)
- automatic snippets (`A`)
- word-boundary snippets (`w`)
- excluded environments for specific triggers
- whitespace trimming for inline math snippet expansions
- slash-triggered auto-fraction
- tabout out of math blocks

## Important behavior clarifications

Behavior is determined by the loaded Obsidian snippet source.

For the tested snippet source:

- `mk` is inline math
- `dm` is display math

If a user expects `dm` to become inline math, that requires changing the snippet source, not the bridge runtime.

## Auto-fraction

The bridge implements Obsidian-style auto-fraction on `/` in math mode.

It does **not** use the earlier approximation of waiting for a later breaking character. The correct behavior is:

- user types `/`
- runtime inspects the numerator to the left
- runtime expands immediately to something like `\frac{a}{$0}$1`

## Tabout

The bridge tabs out based on actual math bounds, not only by checking the next visible character.

That matters for cases like:

- inline math `$x$`
- block math `$$x$$`
- bracketed math delimiters
- environment-based math

The implementation tracks the end of the active math region and moves the cursor after the closing delimiter.

## Test coverage

The repo includes regression tests for:

- snippet loading from JavaScript source
- snippet variable expansion
- function-valued replacements
- word-boundary expansion before an existing `}`
- text-vs-math gating
- slash-triggered auto-fraction
- excluded auto-fraction environments
- tabout targets
