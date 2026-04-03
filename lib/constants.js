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

module.exports = {
  VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER,
  DEFAULT_SETTINGS,
  EXCLUSIONS,
  MATH_ENVIRONMENTS,
};
