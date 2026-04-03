const fs = require("fs");
const vm = require("vm");
const {
  DEFAULT_SETTINGS,
  EXCLUSIONS,
  VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER,
} = require("./constants");

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

module.exports = {
  loadPluginDataFromFile,
  loadPluginDataFromJson,
};
