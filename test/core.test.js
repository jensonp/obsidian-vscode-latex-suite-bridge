const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../core");

function makeDataJson({
  snippets = "[]",
  snippetVariables = "{}",
  overrides = {},
} = {}) {
  return JSON.stringify({
    snippets,
    snippetVariables,
    ...overrides,
  });
}

function findAutomaticMatch(documentText, offset, pluginData, extra = {}) {
  const context = core.getContext(documentText, offset);
  return core.findSnippetMatch(
    documentText,
    offset,
    pluginData.snippets,
    pluginData.settings,
    context,
    { automaticOnly: true, ...extra },
  );
}

test("loads Obsidian snippets with snippet variables and regex triggers", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: "mk", replacement: "$$0$", options: "tA"},
        {trigger: "(\${GREEK})hat", replacement: "\\\\hat{[[0]]}", options: "rmA"},
        {trigger: /([A-Za-z])(\\d)/, replacement: "[[0]]_{[[1]]}", options: "rmA", priority: -1}
      ]`,
      snippetVariables: `{
        GREEK: "alpha|beta",
        "\${SYMBOL}": "theta"
      }`,
    }),
  );

  assert.equal(pluginData.snippets.length, 3);

  const mk = pluginData.snippets.find((snippet) => snippet.triggerText === "mk");
  assert.ok(mk);
  assert.equal(mk.type, "string");
  assert.equal(mk.options.mode.text, true);

  const hat = pluginData.snippets.find((snippet) => snippet.type === "regex" && snippet.triggerRegex.source.includes("alpha|beta"));
  assert.ok(hat);

  const autoSubscript = pluginData.snippets.find((snippet) => snippet.type === "regex" && snippet.triggerText === "([A-Za-z])(\\d)");
  assert.ok(autoSubscript);
});

test("supports function-valued replacements from Obsidian snippets", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: /iden(\\d)/, replacement: (match) => {
          const n = Number(match[1]);
          return "I_" + n;
        }, options: "mA"}
      ]`,
    }),
  );

  const documentText = "$iden3$";
  const match = findAutomaticMatch(documentText, 6, pluginData);
  assert.ok(match);
  assert.equal(match.replacement, "I_3");
});

test("expands word-boundary snippets before an existing } boundary", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: "dm", replacement: "$$\\n$0\\n$$", options: "tAw"}
      ]`,
    }),
  );

  const documentText = String.raw`\SetAnswer{problem1_p_c_eq_1_d_eq_1}{dm}`;
  const offset = documentText.lastIndexOf("dm") + 2;
  const match = findAutomaticMatch(documentText, offset, pluginData);

  assert.ok(match);
  assert.equal(match.start, documentText.lastIndexOf("dm"));
  assert.equal(match.replacement, "$$\n$0\n$$");
});

test("expands text-mode automatic snippets at end of a line", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: "mk", replacement: "$$0$", options: "tA"}
      ]`,
    }),
  );

  const documentText = "mk";
  const match = findAutomaticMatch(documentText, documentText.length, pluginData);

  assert.ok(match);
  assert.equal(match.replacement, "$$0$");
});

test("does not run text-mode snippets while inside math mode", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: "dm", replacement: "$$\\n$0\\n$$", options: "tAw"}
      ]`,
    }),
  );

  const documentText = "$dm$";
  const match = findAutomaticMatch(documentText, 3, pluginData);
  assert.equal(match, null);
});

test("does not run non-visual snippets when there is a selection", () => {
  const pluginData = core.loadPluginDataFromJson(
    makeDataJson({
      snippets: `[
        {trigger: "mk", replacement: "$$0$", options: "tA"}
      ]`,
    }),
  );

  const documentText = "mk";
  const context = core.getContext(documentText, documentText.length);
  const match = core.findSnippetMatch(
    documentText,
    documentText.length,
    pluginData.snippets,
    pluginData.settings,
    context,
    { automaticOnly: true, selectionText: "selected" },
  );

  assert.equal(match, null);
});

test("applies regex capture replacements", () => {
  const replaced = core.applyRegexReplacement("\\hat{[[0]]} + [[1]]", ["xhat", "x", "y"]);
  assert.equal(replaced, "\\hat{x} + y");
});

test("builds Obsidian-style auto-fraction from a typed slash in math mode", () => {
  const settings = { ...core.DEFAULT_SETTINGS };
  const documentText = "$1/$";
  const offset = 3;
  const context = core.getContext(documentText, offset);
  const expansion = core.findAutoFractionSlashExpansion(documentText, offset, settings, context);

  assert.ok(expansion);
  assert.equal(expansion.start, 1);
  assert.equal(expansion.end, 3);
  assert.equal(expansion.numerator, "1");
  assert.equal(expansion.replacement, "\\frac{1}{$0}$1");
});

test("suppresses auto-fraction inside excluded environments", () => {
  const settings = { ...core.DEFAULT_SETTINGS };
  const documentText = "$e^{1/}$";
  const offset = documentText.indexOf("/") + 1;
  const context = core.getContext(documentText, offset);
  const expansion = core.findAutoFractionSlashExpansion(documentText, offset, settings, context);

  assert.equal(expansion, null);
});

test("tabout moves after inline and block math closers", () => {
  const inlineDocument = "$x$";
  const inlineContext = core.getContext(inlineDocument, 2);
  assert.equal(core.findTaboutTarget(inlineDocument, 2, inlineContext), 3);

  const blockDocument = "$$x$$";
  const blockContext = core.getContext(blockDocument, 3);
  assert.equal(core.findTaboutTarget(blockDocument, 3, blockContext), 5);
});
