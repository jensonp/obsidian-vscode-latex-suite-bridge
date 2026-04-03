const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const core = require("./core");
const { createDebouncedAsyncTask, sleep } = require("./lib/debounce");

let applyingEdit = false;
let dataFileWatcher = null;
let watchedDirectoryPath = "";
let watchedFileName = "";

let runtime = {
  snippets: [],
  settings: { ...core.DEFAULT_SETTINGS },
  dataPath: "",
  loadError: null,
  matcherHint: {
    hasAutoRegex: false,
    autoStringTailChars: new Set(),
  },
};

function config() {
  return vscode.workspace.getConfiguration("obsidianLatexSuite");
}

function isEnabled() {
  return config().get("enabled", true);
}

function resolveCanonicalPath(filePath) {
  if (!filePath || !String(filePath).trim()) {
    return "";
  }
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

async function reloadSnippetsWithRetry(maxAttempts = 4, baseDelayMs = 120) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await reloadSnippets({ notify: false });
    if (!runtime.loadError) {
      return;
    }
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * attempt);
    }
  }
  if (runtime.loadError) {
    vscode.window.setStatusBarMessage(
      `Obsidian LaTeX Suite: auto-reload failed (${runtime.loadError.message})`,
      4000,
    );
  }
}

const debouncedExternalReload = createDebouncedAsyncTask(
  () => reloadSnippetsWithRetry(4, 120),
  250,
);

function closeDataFileWatcher() {
  if (dataFileWatcher) {
    dataFileWatcher.close();
    dataFileWatcher = null;
  }
  watchedDirectoryPath = "";
  watchedFileName = "";
}

function watchDataFile(dataPath) {
  const canonicalPath = resolveCanonicalPath(dataPath);
  if (!canonicalPath) {
    closeDataFileWatcher();
    return;
  }

  const directoryPath = path.dirname(canonicalPath);
  const fileName = path.basename(canonicalPath);

  if (dataFileWatcher && watchedDirectoryPath === directoryPath && watchedFileName === fileName) {
    return;
  }

  closeDataFileWatcher();

  try {
    dataFileWatcher = fs.watch(directoryPath, { persistent: false }, (eventType, changedName) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      const changed = typeof changedName === "string"
        ? changedName
        : (Buffer.isBuffer(changedName) ? changedName.toString("utf8") : "");

      if (changed && changed !== fileName) {
        return;
      }

      debouncedExternalReload.trigger();
    });

    dataFileWatcher.on("error", () => {
      closeDataFileWatcher();
      // Re-establish on transient fs watcher failures.
      watchDataFile(dataPath);
    });

    watchedDirectoryPath = directoryPath;
    watchedFileName = fileName;
  } catch {
    closeDataFileWatcher();
  }
}

function isTexDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId !== "latex" && document.languageId !== "tex") {
    return false;
  }
  const fsPath = document.uri?.fsPath ?? "";
  return fsPath.toLowerCase().endsWith(".tex");
}

function isTexEditor(editor) {
  return Boolean(editor && isTexDocument(editor.document));
}

function activeTexEditor() {
  const editor = vscode.window.activeTextEditor;
  return isTexEditor(editor) ? editor : null;
}

function buildMatcherHint(snippets) {
  const autoStringTailChars = new Set();
  let hasAutoRegex = false;

  for (const snippet of snippets) {
    if (!snippet.options?.automatic) {
      continue;
    }
    if (snippet.type === "regex") {
      hasAutoRegex = true;
      continue;
    }
    const trigger = snippet.triggerText || "";
    if (trigger.length > 0) {
      autoStringTailChars.add(trigger[trigger.length - 1]);
    }
  }

  return {
    hasAutoRegex,
    autoStringTailChars,
  };
}

function currentDocumentState(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const context = core.getContext(text, offset);
  return { text, offset, context };
}

function rangeFromOffsets(document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function currentSelectionText(editor) {
  if (!editor || editor.selections.length !== 1) {
    return "";
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    return "";
  }
  return editor.document.getText(selection);
}

async function insertSnippet(editor, range, replacement) {
  applyingEdit = true;
  try {
    await editor.insertSnippet(new vscode.SnippetString(replacement), range);
  } finally {
    applyingEdit = false;
  }
}

function findSnippetAtEditor(editor, position, { automaticOnly = false } = {}) {
  const document = editor.document;
  const state = currentDocumentState(document, position);
  return core.findSnippetMatch(
    state.text,
    state.offset,
    runtime.snippets,
    runtime.settings,
    state.context,
    {
      automaticOnly,
      selectionText: currentSelectionText(editor),
    },
  );
}

async function applyMatch(editor, match) {
  if (!match) {
    return false;
  }
  const range = rangeFromOffsets(editor.document, match.start, match.end);
  await insertSnippet(editor, range, match.replacement);
  return true;
}

function configAllowsAutoSnippets() {
  return config().get("autoExpandRegexSnippets", true);
}

function configAllowsAutofraction() {
  return config().get("autofraction.enabled", true);
}

function configAllowsTabout() {
  return config().get("tabout.enabled", true);
}

function shouldAttemptAutomaticMatch(insertedChar, wordDelimiters) {
  if (runtime.matcherHint.hasAutoRegex) {
    return true;
  }
  if (runtime.matcherHint.autoStringTailChars.has(insertedChar)) {
    return true;
  }
  return core.isDelimiterCharacter(insertedChar, wordDelimiters);
}

async function tryAutoFraction(editor, position) {
  const document = editor.document;
  const state = currentDocumentState(document, position);
  const expansion = core.findAutoFractionSlashExpansion(
    state.text,
    state.offset,
    runtime.settings,
    state.context,
  );
  if (!expansion) {
    return false;
  }

  const range = rangeFromOffsets(document, expansion.start, expansion.end);
  await insertSnippet(editor, range, expansion.replacement);
  return true;
}

async function onDidChangeTextDocument(event) {
  if (applyingEdit || !isEnabled()) {
    return;
  }

  const editor = activeTexEditor();
  if (!editor || event.document !== editor.document) {
    return;
  }

  if (runtime.loadError) {
    return;
  }

  if (event.contentChanges.length !== 1) {
    return;
  }

  const [change] = event.contentChanges;
  if (change.text.length !== 1) {
    return;
  }

  const insertedChar = change.text;
  const position = event.document.positionAt(change.rangeOffset + change.text.length);

  if (insertedChar === "/" && configAllowsAutofraction() && runtime.settings.autofractionEnabled) {
    if (await tryAutoFraction(editor, position)) {
      return;
    }
  }

  if (!configAllowsAutoSnippets() || !runtime.settings.snippetsEnabled) {
    return;
  }

  if (!shouldAttemptAutomaticMatch(insertedChar, runtime.settings.wordDelimiters)) {
    return;
  }

  if (core.isDelimiterCharacter(insertedChar, runtime.settings.wordDelimiters) && position.character > 0) {
    const beforeBoundary = position.translate(0, -1);
    const boundaryMatch = findSnippetAtEditor(editor, beforeBoundary, { automaticOnly: true });
    if (boundaryMatch?.snippet?.options?.onWordBoundary) {
      await applyMatch(editor, boundaryMatch);
      return;
    }
  }

  const match = findSnippetAtEditor(editor, position, { automaticOnly: true });
  if (!match) {
    return;
  }
  await applyMatch(editor, match);
}

async function reloadSnippets({ notify = false } = {}) {
  const dataPath = config().get("obsidianDataJsonPath", "");
  watchDataFile(dataPath);

  runtime = {
    snippets: [],
    settings: { ...core.DEFAULT_SETTINGS },
    dataPath,
    loadError: null,
    matcherHint: {
      hasAutoRegex: false,
      autoStringTailChars: new Set(),
    },
  };

  if (!dataPath) {
    runtime.loadError = new Error("obsidianLatexSuite.obsidianDataJsonPath is empty.");
  } else {
    try {
      const loaded = core.loadPluginDataFromFile(dataPath);
      runtime = {
        snippets: loaded.snippets,
        settings: loaded.settings,
        dataPath,
        loadError: null,
        matcherHint: buildMatcherHint(loaded.snippets),
      };
    } catch (error) {
      runtime.loadError = error;
    }
  }

  if (notify) {
    if (runtime.loadError) {
      vscode.window.showWarningMessage(
        `Obsidian LaTeX Suite: failed to load snippets from ${dataPath || "(unset path)"}: ${runtime.loadError.message}`,
      );
      return;
    }
    const message = `Obsidian LaTeX Suite: loaded ${runtime.snippets.length} snippets`;
    vscode.window.setStatusBarMessage(message, 3000);
    vscode.window.showInformationMessage(message);
    return;
  }

  if (!runtime.loadError && runtime.snippets.length) {
    vscode.window.setStatusBarMessage(
      `Obsidian LaTeX Suite: loaded ${runtime.snippets.length} snippets`,
      2000,
    );
  }
}

async function expandCommand() {
  if (!isEnabled()) {
    return;
  }
  const editor = activeTexEditor();
  if (!editor) {
    return;
  }

  const match = findSnippetAtEditor(editor, editor.selection.active, { automaticOnly: false });
  await applyMatch(editor, match);
}

async function fallbackTab() {
  try {
    await vscode.commands.executeCommand("tab");
    return;
  } catch {
    // Fall through.
  }

  try {
    await vscode.commands.executeCommand("default:tab");
    return;
  } catch {
    // Fall through.
  }

  try {
    await vscode.commands.executeCommand("default:type", { text: "\t" });
    return;
  } catch {
    // Fall through.
  }

  await vscode.commands.executeCommand("type", { text: "\t" });
}

async function tabCommand() {
  const editor = activeTexEditor();
  if (!editor || !isEnabled()) {
    await fallbackTab();
    return;
  }

  const originalPosition = editor.selection.active;
  try {
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
  } catch {
    // Ignore and continue.
  }
  if (!editor.selection.active.isEqual(originalPosition)) {
    return;
  }

  if (configAllowsTabout() && runtime.settings.taboutEnabled) {
    const document = editor.document;
    const state = currentDocumentState(document, originalPosition);
    const targetOffset = core.findTaboutTarget(state.text, state.offset, state.context);
    if (typeof targetOffset === "number" && targetOffset >= 0) {
      const target = document.positionAt(targetOffset);
      editor.selection = new vscode.Selection(target, target);
      return;
    }
  }

  if (runtime.settings.snippetsEnabled && runtime.settings.snippetsTrigger === "Tab") {
    const match = findSnippetAtEditor(editor, editor.selection.active, { automaticOnly: false });
    if (await applyMatch(editor, match)) {
      return;
    }
  }

  await fallbackTab();
}

function activate(context) {
  void reloadSnippets();

  context.subscriptions.push(
    vscode.commands.registerCommand("obsidianLatexSuite.reload", () => reloadSnippets({ notify: true })),
    vscode.commands.registerCommand("obsidianLatexSuite.expand", expandCommand),
    vscode.commands.registerCommand("obsidianLatexSuite.tab", tabCommand),
    vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("obsidianLatexSuite")) {
        void reloadSnippets({ notify: true });
      }
    }),
    {
      dispose() {
        closeDataFileWatcher();
        debouncedExternalReload.dispose();
      },
    },
  );
}

function deactivate() {
  closeDataFileWatcher();
  debouncedExternalReload.dispose();
}

module.exports = {
  activate,
  deactivate,
};
