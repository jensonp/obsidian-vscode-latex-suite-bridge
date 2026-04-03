const {
  DEFAULT_SETTINGS,
  VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER,
} = require("./constants");
const { isWithinEnvironment } = require("./context");

function snippetShouldRunInMode(options, mode) {
  if (((options.mode.inlineMath && mode.inlineMath)
      || (options.mode.blockMath && mode.blockMath)
      || ((options.mode.inlineMath || options.mode.blockMath) && mode.codeMath))
    && !mode.textEnv) {
    return true;
  }
  if (mode.inMath() && mode.textEnv && options.mode.text) {
    return true;
  }
  if ((options.mode.text && mode.text) || (options.mode.code && mode.code)) {
    return true;
  }
  return false;
}

function isOnWordBoundary(documentText, triggerPos, offset, wordDelimiters) {
  const prevChar = triggerPos <= 0 ? "" : documentText.slice(triggerPos - 1, triggerPos);
  const nextChar = documentText.slice(offset, offset + 1);
  const delimiters = String(wordDelimiters || DEFAULT_SETTINGS.wordDelimiters).replace(/\\n/g, "\n");
  return delimiters.includes(prevChar) && delimiters.includes(nextChar);
}

function trimWhitespace(replacement, context) {
  if (!context?.mode?.inlineMath) {
    return replacement;
  }

  let spaceIndex = 0;
  if (replacement.endsWith(" ")) {
    spaceIndex = -1;
  } else {
    const lastThreeChars = replacement.slice(-3);
    const lastChar = lastThreeChars.slice(-1);
    if (lastThreeChars.slice(0, 2) === " $" && !Number.isNaN(Number.parseInt(lastChar, 10))) {
      spaceIndex = -3;
    }
  }

  if (spaceIndex === -1) {
    return replacement.trimEnd();
  }
  if (spaceIndex === -3) {
    return replacement.slice(0, -3) + replacement.slice(-2);
  }
  return replacement;
}

function applyRegexReplacement(template, match) {
  return template.replace(/\[\[(\d+)\]\]/g, (_, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10);
    return Number.isFinite(index) ? (match[index + 1] ?? "") : "";
  });
}

function resolveSnippetReplacement(snippet, match, selectionText) {
  if (snippet.type === "visual") {
    if (!selectionText) {
      return null;
    }
    if (typeof snippet.replacement === "string") {
      return snippet.replacement.replaceAll(VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER, selectionText);
    }
    const result = snippet.replacement(selectionText);
    return typeof result === "string" ? result : null;
  }

  if (snippet.type === "regex") {
    if (!match) {
      return null;
    }
    if (typeof snippet.replacement === "string") {
      return applyRegexReplacement(snippet.replacement, match);
    }
    const result = snippet.replacement(match);
    return typeof result === "string" ? result : null;
  }

  if (typeof snippet.replacement === "string") {
    return snippet.replacement;
  }
  const result = snippet.replacement(snippet.triggerText || "");
  return typeof result === "string" ? result : null;
}

function findSnippetMatch(documentText, offset, snippets, settings, context, { automaticOnly = false, selectionText = "" } = {}) {
  const prefix = documentText.slice(0, offset);

  for (const snippet of snippets) {
    if (automaticOnly && !snippet.options.automatic) {
      continue;
    }
    if (!snippetShouldRunInMode(snippet.options, context.mode)) {
      continue;
    }

    let excluded = false;
    for (const environment of snippet.excludedEnvironments) {
      if (isWithinEnvironment(documentText, offset, environment, context.mathBounds)) {
        excluded = true;
        break;
      }
    }
    if (excluded) {
      continue;
    }

    let triggerPos = -1;
    let match = null;

    if (snippet.type === "regex") {
      match = snippet.triggerRegex.exec(prefix);
      if (!match) {
        continue;
      }
      triggerPos = match.index;
    } else {
      const triggerText = snippet.triggerText || "";
      if (!prefix.endsWith(triggerText)) {
        continue;
      }
      triggerPos = prefix.length - triggerText.length;
    }

    if (snippet.options.onWordBoundary && !isOnWordBoundary(documentText, triggerPos, offset, settings.wordDelimiters)) {
      continue;
    }

    if (selectionText && snippet.type !== "visual") {
      continue;
    }

    let replacement = resolveSnippetReplacement(snippet, match, selectionText);
    if (replacement === null) {
      continue;
    }
    if (settings.removeSnippetWhitespace) {
      replacement = trimWhitespace(replacement, context);
    }

    return {
      snippet,
      start: triggerPos,
      end: offset,
      replacement,
      match,
    };
  }

  return null;
}

function isDelimiterCharacter(char, wordDelimiters = DEFAULT_SETTINGS.wordDelimiters) {
  if (!char || char.length !== 1) {
    return false;
  }
  const delimiters = String(wordDelimiters).replace(/\\n/g, "\n");
  return delimiters.includes(char);
}

module.exports = {
  applyRegexReplacement,
  findSnippetMatch,
  isDelimiterCharacter,
  isOnWordBoundary,
  resolveSnippetReplacement,
  trimWhitespace,
};
