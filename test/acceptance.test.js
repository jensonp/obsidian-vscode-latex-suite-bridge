const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const core = require("../core");

const fixturePath = path.join(__dirname, "fixtures", "ols-fixture-data.json");

function loadFixture() {
  const raw = fs.readFileSync(fixturePath, "utf8");
  return core.loadPluginDataFromJson(raw);
}

function automaticMatch(documentText, offset, runtime, extra = {}) {
  const context = core.getContext(documentText, offset);
  return core.findSnippetMatch(
    documentText,
    offset,
    runtime.snippets,
    runtime.settings,
    context,
    { automaticOnly: true, ...extra },
  );
}

test("fixture loads and exposes expected snippet types", () => {
  const runtime = loadFixture();
  assert.equal(runtime.snippets.length, 5);

  const hasRegex = runtime.snippets.some((snippet) => snippet.type === "regex");
  const hasVisual = runtime.snippets.some((snippet) => snippet.type === "visual");
  const hasFunctionReplacement = runtime.snippets.some(
    (snippet) => snippet.type === "regex" && typeof snippet.replacement === "function",
  );

  assert.equal(hasRegex, true);
  assert.equal(hasVisual, true);
  assert.equal(hasFunctionReplacement, true);
});

test("word-boundary snippet expands when typing a delimiter after trigger", () => {
  const runtime = loadFixture();
  const line = "dm ";
  const offsetBeforeBoundary = 2;

  const match = automaticMatch(line, offsetBeforeBoundary, runtime);
  assert.ok(match);
  assert.equal(match.replacement, "$$\n$0\n$$");
  assert.equal(match.snippet.options.onWordBoundary, true);
});

test("regex and function snippets expand in math mode", () => {
  const runtime = loadFixture();

  const hatLine = "$xhat$";
  const hatMatch = automaticMatch(hatLine, 5, runtime);
  assert.ok(hatMatch);
  assert.equal(hatMatch.replacement, "\\hat{x}");

  const idLine = "$iden4$";
  const idMatch = automaticMatch(idLine, 6, runtime);
  assert.ok(idMatch);
  assert.equal(idMatch.replacement, "I_4");
});

test("visual snippet only expands with selection text", () => {
  const runtime = loadFixture();
  const line = "$U$";

  const withoutSelection = automaticMatch(line, 2, runtime);
  assert.equal(withoutSelection, null);

  const withSelection = automaticMatch(line, 2, runtime, { selectionText: "x+y" });
  assert.ok(withSelection);
  assert.equal(withSelection.replacement, "\\underbrace{ x+y }_{ $0 }");
});
