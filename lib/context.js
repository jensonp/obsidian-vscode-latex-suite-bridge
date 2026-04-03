const { MATH_ENVIRONMENTS } = require("./constants");

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

function findMathBounds(text, openMath) {
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
  const localOffset = offset - mathBounds.start;
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
  const mathBounds = findMathBounds(documentText, openMath);

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

module.exports = {
  findMatchingBracket,
  getContext,
  isWithinEnvironment,
};
