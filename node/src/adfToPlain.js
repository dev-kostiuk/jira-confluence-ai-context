/**
 * Minimal Atlassian Document Format (ADF) to plain text.
 * @param {unknown} node
 * @returns {string}
 */
export function adfToPlain(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node
      .map((x) => adfToPlain(x))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof node !== "object") return "";

  const o = /** @type {Record<string, unknown>} */ (node);
  const parts = [];
  if (typeof o.text === "string") parts.push(o.text);

  const content = o.content;
  if (Array.isArray(content)) {
    const inner = adfToPlain(content);
    if (inner) parts.push(inner);
  }

  const t = o.type;
  if (t === "paragraph" || t === "heading" || t === "blockquote") {
    return parts.join("\n").trim();
  }
  if (t === "hardBreak") return "\n";
  if (t === "bulletList" || t === "orderedList") {
    const inner = adfToPlain(content);
    return inner
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `- ${line}`)
      .join("\n");
  }
  if (t === "listItem") return adfToPlain(content);

  return parts.filter(Boolean).join(" ").trim();
}
