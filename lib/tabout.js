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
  findTaboutTarget,
};
