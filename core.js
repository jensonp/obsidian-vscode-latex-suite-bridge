const fs = require("fs");
const vm = require("vm");

const VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER = "${VISUAL}";

const DEFAULT_SETTINGS = {
  snippetsEnabled: true,
  snippetsTrigger: "Tab",
  removeSnippetWhitespace: true,
  autofractionEnabled: true,
  autofractionSymbol: "\\frac",
  autofractionBreakingChars: "+-=\t",
  taboutEnabled: true,
  wordDelimiters: "., +-\\n\t:;!?\\/{}[]()=~$",
  autofractionExcludedEnvs: [
    { openSymbol: "^{", closeSymbol: "}" },
    { openSymbol: "\\pu{", closeSymbol: "}" },
  ],
};

const EXCLUSIONS = {
  "([A-Za-z])(\\d)": { openSymbol: "\\pu{", closeSymbol: "}" },
  "->": { openSymbol: "\\ce{", closeSymbol: "}" },
};

const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "aligned",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "displaymath",
  "flalign",
  "flalign*",
  "alignat",
  "alignat*",
  "xalignat",
  "xxalignat",
  "split",
  "cases",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
]);

function isRegExp(value) {
  return Object.prototype.toString.call(value) === "[object RegExp]";
}

function filterFlags(flags) {
  const validFlags = new Set(["i", "m", "s", "u", "v"]);
  return Array.from(new Set(String(flags || "").split("")))
    .filter((flag) => validFlags.has(flag))
    .join("");
}

function evaluateJavaScriptLiteral(source, label) {
  if (!source || !String(source).trim()) {
    return label === "snippets" ? [] : {};
  }
  const rawSource = String(source).trim();
  const strippedSource = rawSource.startsWith("export default ")
    ? rawSource.slice("export default ".length)
    : rawSource;
  try {
    return vm.runInNewContext(`(${strippedSource})`, Object.create(null), { timeout: 200 });
  } catch (error) {
    throw new Error(`Failed to evaluate Obsidian ${label}: ${error.message}`);
  }
}

function normaliseSnippetVariables(rawVariables) {
  if (Array.isArray(rawVariables)) {
    throw new Error("Obsidian snippetVariables must evaluate to an object, not an array.");
  }
  if (!rawVariables || typeof rawVariables !== "object") {
    return {};
  }

  const snippetVariables = {};
  for (const [variable, value] of Object.entries(rawVariables)) {
    if (variable.startsWith("${")) {
      if (!variable.endsWith("}")) {
        throw new Error(
          `Invalid snippet variable name '${variable}': starts with '\${' but does not end with '}'.`,
        );
      }
      snippetVariables[variable] = String(value);
      continue;
    }

    if (variable.endsWith("}")) {
      throw new Error(
        `Invalid snippet variable name '${variable}': ends with '}' but does not start with '\${'.`,
      );
    }
    snippetVariables["${" + variable + "}"] = String(value);
  }

  return snippetVariables;
}

function insertSnippetVariables(trigger, variables) {
  let output = String(trigger);
  for (const [variable, replacement] of Object.entries(variables || {})) {
    output = output.replaceAll(variable, replacement);
  }
  return output;
}

function parseModeFlags(source) {
  const mode = {
    text: false,
    inlineMath: false,
    blockMath: false,
    code: false,
    codeMath: false,
    textEnv: false,
  };

  for (const flag of String(source || "")) {
    switch (flag) {
      case "m":
        mode.inlineMath = true;
        mode.blockMath = true;
        break;
      case "n":
        mode.inlineMath = true;
        break;
      case "M":
        mode.blockMath = true;
        break;
      case "t":
        mode.text = true;
        break;
      case "c":
        mode.code = true;
        break;
      default:
        break;
    }
  }

  if (!(mode.text || mode.inlineMath || mode.blockMath || mode.code || mode.codeMath || mode.textEnv)) {
    mode.text = true;
    mode.inlineMath = true;
    mode.blockMath = true;
    mode.code = true;
    mode.codeMath = true;
    mode.textEnv = true;
  }

  return mode;
}

function parseOptions(source) {
  const options = {
    source: String(source || ""),
    mode: parseModeFlags(source),
    automatic: false,
    regex: false,
    onWordBoundary: false,
    visual: false,
  };

  for (const flag of options.source) {
    switch (flag) {
      case "A":
        options.automatic = true;
        break;
      case "r":
        options.regex = true;
        break;
      case "w":
        options.onWordBoundary = true;
        break;
      case "v":
        options.visual = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function normaliseExcludedEnvironments(triggerText) {
  return Object.prototype.hasOwnProperty.call(EXCLUSIONS, triggerText) ? [EXCLUSIONS[triggerText]] : [];
}

function getTriggerLength(trigger) {
  return typeof trigger === "string" ? trigger.length : trigger.source.length;
}

function sortSnippets(snippets) {
  return [...snippets].sort((left, right) => {
    const leftPriority = left.priority || 0;
    const rightPriority = right.priority || 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }
    return getTriggerLength(right.trigger) - getTriggerLength(left.trigger);
  });
}

function normaliseSnippet(rawSnippet, snippetVariables) {
  if (!rawSnippet || typeof rawSnippet !== "object") {
    throw new Error("Snippet must be an object.");
  }
  if (typeof rawSnippet.options !== "string") {
    throw new Error("Snippet is missing a string options field.");
  }

  const options = parseOptions(rawSnippet.options);
  const priority = typeof rawSnippet.priority === "number" ? rawSnippet.priority : 0;
  const description = typeof rawSnippet.description === "string" ? rawSnippet.description : "";

  let trigger = rawSnippet.trigger;
  let triggerText = null;
  let triggerRegex = null;

  if (options.regex || isRegExp(trigger)) {
    let source;
    let flags = rawSnippet.flags || "";
    if (isRegExp(trigger)) {
      source = trigger.source;
      flags = `${trigger.flags}${flags}`;
    } else if (typeof trigger === "string") {
      source = trigger;
    } else {
      throw new Error("Regex snippet trigger must be a string or RegExp.");
    }

    source = insertSnippetVariables(source, snippetVariables);
    triggerText = source;
    triggerRegex = new RegExp(`${source}$`, filterFlags(flags));
    trigger = triggerRegex;
  } else if (typeof trigger === "string") {
    triggerText = insertSnippetVariables(trigger, snippetVariables);
    trigger = triggerText;
  } else {
    throw new Error("String snippet trigger must be a string.");
  }

  const excludedEnvironments = normaliseExcludedEnvironments(triggerText || "");
  const replacement = rawSnippet.replacement;
  const inferredVisual = typeof replacement === "string" && replacement.includes(VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER);
  if (inferredVisual) {
    options.visual = true;
  }

  let type = "string";
  if (options.visual) {
    type = "visual";
  } else if (triggerRegex) {
    type = "regex";
  }

  return {
    type,
    trigger,
    triggerText,
    triggerRegex,
    replacement,
    options,
    priority,
    description,
    excludedEnvironments,
  };
}

function parseExcludedEnvironments(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .filter((entry) => Array.isArray(entry) && entry.length === 2)
      .map(([openSymbol, closeSymbol]) => ({ openSymbol, closeSymbol }));
  }
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return DEFAULT_SETTINGS.autofractionExcludedEnvs;
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return DEFAULT_SETTINGS.autofractionExcludedEnvs;
    }
    return parsed
      .filter((entry) => Array.isArray(entry) && entry.length === 2)
      .map(([openSymbol, closeSymbol]) => ({ openSymbol, closeSymbol }));
  } catch {
    return DEFAULT_SETTINGS.autofractionExcludedEnvs;
  }
}

function loadPluginDataFromJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  const snippetVariables = normaliseSnippetVariables(
    evaluateJavaScriptLiteral(parsed.snippetVariables, "snippetVariables"),
  );
  const rawSnippets = evaluateJavaScriptLiteral(parsed.snippets, "snippets");
  if (!Array.isArray(rawSnippets)) {
    throw new Error("Obsidian snippets source did not evaluate to an array.");
  }

  const snippets = sortSnippets(rawSnippets.map((snippet) => normaliseSnippet(snippet, snippetVariables)));
  const settings = {
    snippetsEnabled: parsed.snippetsEnabled ?? DEFAULT_SETTINGS.snippetsEnabled,
    snippetsTrigger: parsed.snippetsTrigger ?? DEFAULT_SETTINGS.snippetsTrigger,
    removeSnippetWhitespace: parsed.removeSnippetWhitespace ?? DEFAULT_SETTINGS.removeSnippetWhitespace,
    autofractionEnabled: parsed.autofractionEnabled ?? DEFAULT_SETTINGS.autofractionEnabled,
    autofractionSymbol: parsed.autofractionSymbol ?? DEFAULT_SETTINGS.autofractionSymbol,
    autofractionBreakingChars: parsed.autofractionBreakingChars ?? DEFAULT_SETTINGS.autofractionBreakingChars,
    taboutEnabled: parsed.taboutEnabled ?? DEFAULT_SETTINGS.taboutEnabled,
    wordDelimiters: parsed.wordDelimiters ?? DEFAULT_SETTINGS.wordDelimiters,
    autofractionExcludedEnvs: parseExcludedEnvironments(parsed.autofractionExcludedEnvs),
  };

  return {
    snippets,
    snippetVariables,
    settings,
    raw: parsed,
  };
}

function loadPluginDataFromFile(path) {
  const jsonText = fs.readFileSync(path, "utf8");
  return loadPluginDataFromJson(jsonText);
}

function isEscaped(text, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function readEnvironmentName(text, startIndex) {
  const open = "\\begin{";
  const closeIndex = text.indexOf("}", startIndex + open.length);
  if (closeIndex === -1) {
    return null;
  }
  const envName = text.slice(startIndex + open.length, closeIndex);
  return {
    envName,
    endIndex: closeIndex + 1,
  };
}

function readClosingEnvironmentName(text, startIndex) {
  const open = "\\end{";
  const closeIndex = text.indexOf("}", startIndex + open.length);
  if (closeIndex === -1) {
    return null;
  }
  const envName = text.slice(startIndex + open.length, closeIndex);
  return {
    envName,
    endIndex: closeIndex + 1,
  };
}

function isSingleDollarDelimiter(text, index) {
  return text[index] === "$"
    && !isEscaped(text, index)
    && text[index - 1] !== "$"
    && text[index + 1] !== "$";
}

function scanToOffset(text, offset) {
  const stack = [];
  let inComment = false;

  for (let index = 0; index < offset; ) {
    const current = text[index];

    if (inComment) {
      if (current === "\n") {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (current === "%" && !isEscaped(text, index)) {
      inComment = true;
      index += 1;
      continue;
    }

    const top = stack[stack.length - 1];

    if (text.startsWith("\\begin{", index)) {
      const parsed = readEnvironmentName(text, index);
      if (parsed && MATH_ENVIRONMENTS.has(parsed.envName)) {
        stack.push({
          type: "env",
          envName: parsed.envName,
          contentStart: parsed.endIndex,
          openIndex: index,
        });
        index = parsed.endIndex;
        continue;
      }
    }

    if (top && top.type === "env" && text.startsWith(`\\end{${top.envName}}`, index)) {
      const parsed = readClosingEnvironmentName(text, index);
      index = parsed ? parsed.endIndex : index + 1;
      stack.pop();
      continue;
    }

    if (text.startsWith("\\[", index)) {
      if (top && top.type === "blockBracket") {
        stack.pop();
      } else {
        stack.push({ type: "blockBracket", contentStart: index + 2, openIndex: index });
      }
      index += 2;
      continue;
    }

    if (text.startsWith("\\]", index) && top && top.type === "blockBracket") {
      stack.pop();
      index += 2;
      continue;
    }

    if (text.startsWith("\\(", index)) {
      if (top && top.type === "inlineParen") {
        stack.pop();
      } else {
        stack.push({ type: "inlineParen", contentStart: index + 2, openIndex: index });
      }
      index += 2;
      continue;
    }

    if (text.startsWith("\\)", index) && top && top.type === "inlineParen") {
      stack.pop();
      index += 2;
      continue;
    }

    if (text.startsWith("$$", index) && !isEscaped(text, index)) {
      if (top && top.type === "blockDollar") {
        stack.pop();
      } else {
        stack.push({ type: "blockDollar", contentStart: index + 2, openIndex: index });
      }
      index += 2;
      continue;
    }

    if (isSingleDollarDelimiter(text, index)) {
      if (top && top.type === "inlineDollar") {
        stack.pop();
      } else {
        stack.push({ type: "inlineDollar", contentStart: index + 1, openIndex: index });
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return stack[stack.length - 1] || null;
}

function findMatchingBracket(text, startIndex, openSymbol, closeSymbol, searchBackwards = false, stopIndex = text.length) {
  if (searchBackwards) {
    const reversed = text.split("").reverse().join("");
    const reversedIndex = findMatchingBracket(
      reversed,
      text.length - (startIndex + closeSymbol.length),
      closeSymbol.split("").reverse().join(""),
      openSymbol.split("").reverse().join(""),
      false,
    );
    return reversedIndex === -1 ? -1 : text.length - (reversedIndex + openSymbol.length);
  }

  let depth = 0;
  for (let index = startIndex; index < stopIndex; index += 1) {
    if (text.startsWith(openSymbol, index)) {
      depth += 1;
      index += openSymbol.length - 1;
      continue;
    }
    if (text.startsWith(closeSymbol, index)) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      index += closeSymbol.length - 1;
    }
  }
  return -1;
}

function findMathBounds(text, offset, openMath) {
  if (!openMath) {
    return null;
  }

  if (openMath.type === "env") {
    let depth = 1;
    const closeToken = `\\end{${openMath.envName}}`;
    for (let index = openMath.contentStart; index < text.length; ) {
      if (text.startsWith(`\\begin{${openMath.envName}}`, index)) {
        depth += 1;
        index += `\\begin{${openMath.envName}}`.length;
        continue;
      }
      if (text.startsWith(closeToken, index)) {
        depth -= 1;
        if (depth === 0) {
          return { start: openMath.contentStart, end: index, afterEnd: index + closeToken.length };
        }
        index += closeToken.length;
        continue;
      }
      index += 1;
    }
    return null;
  }

  const closeToken = {
    inlineDollar: "$",
    blockDollar: "$$",
    inlineParen: "\\)",
    blockBracket: "\\]",
  }[openMath.type];

  if (!closeToken) {
    return null;
  }

  for (let index = openMath.contentStart; index < text.length; ) {
    if (closeToken === "$") {
      if (isSingleDollarDelimiter(text, index)) {
        return { start: openMath.contentStart, end: index, afterEnd: index + 1 };
      }
      index += 1;
      continue;
    }

    if (closeToken === "$$") {
      if (text.startsWith("$$", index) && !isEscaped(text, index)) {
        return { start: openMath.contentStart, end: index, afterEnd: index + 2 };
      }
      index += 1;
      continue;
    }

    if (text.startsWith(closeToken, index)) {
      return { start: openMath.contentStart, end: index, afterEnd: index + closeToken.length };
    }
    index += 1;
  }

  return null;
}

function isWithinEnvironment(documentText, offset, env, mathBounds) {
  if (!mathBounds) {
    return false;
  }
  const text = documentText.slice(mathBounds.start, mathBounds.end);
  let localOffset = offset - mathBounds.start;
  if (localOffset < 0 || localOffset > text.length) {
    return false;
  }

  const openBracket = env.openSymbol.slice(-1);
  const matchingClose = { "{": "}", "[": "]", "(": ")" }[openBracket];

  let offsetAdjustment = 0;
  let openSearchSymbol = env.openSymbol;
  if (matchingClose && env.closeSymbol === matchingClose) {
    offsetAdjustment = env.openSymbol.length - 1;
    openSearchSymbol = openBracket;
  }

  let leftIndex = text.lastIndexOf(env.openSymbol, Math.max(0, localOffset - 1));
  while (leftIndex !== -1) {
    const rightIndex = findMatchingBracket(
      text,
      leftIndex + offsetAdjustment,
      openSearchSymbol,
      env.closeSymbol,
      false,
    );
    if (rightIndex === -1) {
      return false;
    }
    if (rightIndex >= localOffset && localOffset >= leftIndex + env.openSymbol.length) {
      return true;
    }
    if (leftIndex === 0) {
      return false;
    }
    leftIndex = text.lastIndexOf(env.openSymbol, leftIndex - 1);
  }

  return false;
}

function getContext(documentText, offset) {
  const openMath = scanToOffset(documentText, offset);
  const mathBounds = findMathBounds(documentText, offset, openMath);

  const mode = {
    text: !openMath,
    inlineMath: Boolean(openMath && (openMath.type === "inlineDollar" || openMath.type === "inlineParen")),
    blockMath: Boolean(openMath && (openMath.type === "blockDollar" || openMath.type === "blockBracket" || openMath.type === "env")),
    code: false,
    codeMath: false,
    textEnv: false,
    inMath() {
      return this.inlineMath || this.blockMath || this.codeMath;
    },
    strictlyInMath() {
      return this.inMath() && !this.textEnv;
    },
  };

  if (mathBounds) {
    mode.textEnv = (
      isWithinEnvironment(documentText, offset, { openSymbol: "\\text{", closeSymbol: "}" }, mathBounds)
      || isWithinEnvironment(documentText, offset, { openSymbol: "\\tag{", closeSymbol: "}" }, mathBounds)
      || isWithinEnvironment(documentText, offset, { openSymbol: "\\begin{", closeSymbol: "}" }, mathBounds)
      || isWithinEnvironment(documentText, offset, { openSymbol: "\\end{", closeSymbol: "}" }, mathBounds)
    );
  }

  return {
    offset,
    mathBounds,
    mode,
  };
}

function snippetShouldRunInMode(options, mode) {
  if (((options.mode.inlineMath && mode.inlineMath) || (options.mode.blockMath && mode.blockMath) || ((options.mode.inlineMath || options.mode.blockMath) && mode.codeMath)) && !mode.textEnv) {
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

function getOpenBracket(closeBracket) {
  return { ")": "(", "]": "[", "}": "{" }[closeBracket] || null;
}

function findAutoFractionSlashExpansion(documentText, offset, settings, context) {
  if (!context?.mode?.strictlyInMath()) {
    return null;
  }

  const slashIndex = offset - 1;
  if (slashIndex < 0 || documentText[slashIndex] !== "/") {
    return null;
  }

  for (const env of settings.autofractionExcludedEnvs) {
    if (isWithinEnvironment(documentText, slashIndex, env, context.mathBounds)) {
      return null;
    }
  }

  if (!context.mathBounds) {
    return null;
  }

  const equationStart = context.mathBounds.start;
  let prefix = documentText.slice(0, slashIndex);
  const greek = "alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|iota|kappa|lambda|Lambda|mu|nu|omicron|xi|Xi|pi|Pi|rho|sigma|Sigma|tau|upsilon|Upsilon|varphi|phi|Phi|chi|psi|Psi|omega|Omega";
  prefix = prefix.replace(new RegExp(`(${greek}) ([^ ])`, "g"), "$1#$2");

  let start = equationStart;
  for (let index = prefix.length - 1; index >= equationStart; index -= 1) {
    const char = prefix[index];
    if ([")", "]", "}"].includes(char)) {
      const openBracket = getOpenBracket(char);
      const matchingIndex = openBracket ? findMatchingBracket(prefix, index, openBracket, char, true) : -1;
      if (matchingIndex === -1) {
        return null;
      }
      index = matchingIndex;
      if (index < equationStart) {
        start = equationStart;
        break;
      }
    }

    if (` $([{\n${settings.autofractionBreakingChars}`.includes(char)) {
      start = index + 1;
      break;
    }
  }

  if (start === slashIndex) {
    return null;
  }

  let numerator = documentText.slice(start, slashIndex);
  if (numerator.startsWith("(") && numerator.endsWith(")")) {
    const closing = findMatchingBracket(numerator, 0, "(", ")", false);
    if (closing === numerator.length - 1) {
      numerator = numerator.slice(1, -1);
    }
  }

  return {
    start,
    end: offset,
    numerator,
    replacement: `${settings.autofractionSymbol}{${numerator}}{$0}$1`,
  };
}

function findTaboutTarget(documentText, offset, context) {
  if (!context?.mode?.inMath() || !context.mathBounds) {
    return null;
  }

  const end = context.mathBounds.end;
  const rangle = "\\rangle";

  for (let index = offset; index < end; index += 1) {
    const char = documentText[index];
    if ([")", "]", "}", ">", "|", "$"].includes(char)) {
      return index + 1;
    }
    if (documentText.startsWith(rangle, index)) {
      return index + rangle.length;
    }
  }

  const between = documentText.slice(offset, end);
  const atEnd = between.trim().length === 0;
  if (!atEnd) {
    return null;
  }

  return context.mathBounds.afterEnd;
}

module.exports = {
  VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER,
  DEFAULT_SETTINGS,
  loadPluginDataFromJson,
  loadPluginDataFromFile,
  getContext,
  isWithinEnvironment,
  findSnippetMatch,
  resolveSnippetReplacement,
  applyRegexReplacement,
  findAutoFractionSlashExpansion,
  findTaboutTarget,
  trimWhitespace,
  isOnWordBoundary,
};
