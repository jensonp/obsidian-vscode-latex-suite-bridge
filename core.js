const {
  VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER,
  DEFAULT_SETTINGS,
} = require("./lib/constants");
const {
  loadPluginDataFromJson,
  loadPluginDataFromFile,
} = require("./lib/loader");
const {
  getContext,
  isWithinEnvironment,
} = require("./lib/context");
const {
  findSnippetMatch,
  resolveSnippetReplacement,
  applyRegexReplacement,
  trimWhitespace,
  isOnWordBoundary,
  isDelimiterCharacter,
} = require("./lib/snippets");
const {
  findAutoFractionSlashExpansion,
} = require("./lib/autofraction");
const {
  findTaboutTarget,
} = require("./lib/tabout");

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
  isDelimiterCharacter,
};
