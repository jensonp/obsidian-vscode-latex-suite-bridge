const { isWithinEnvironment, findMatchingBracket } = require("./context");

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

module.exports = {
  findAutoFractionSlashExpansion,
};
