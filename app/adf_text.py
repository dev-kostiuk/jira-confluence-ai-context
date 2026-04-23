from __future__ import annotations

from typing import Any


def adf_to_plain(node: Any) -> str:
    """Convert Atlassian Document Format (ADF) to plain text (minimal, good enough for context)."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "\n".join(adf_to_plain(x) for x in node if x is not None).strip()

    if not isinstance(node, dict):
        return ""

    parts: list[str] = []
    if "text" in node and isinstance(node["text"], str):
        parts.append(node["text"])

    content = node.get("content")
    if isinstance(content, list):
        inner = adf_to_plain(content)
        if inner:
            parts.append(inner)

    t = node.get("type")
    if t in {"paragraph", "heading", "blockquote"}:
        return "\n".join(parts).strip()
    if t == "hardBreak":
        return "\n"
    if t == "bulletList" or t == "orderedList":
        inner = adf_to_plain(content)
        return "\n".join(f"- {line}" for line in inner.splitlines() if line.strip())
    if t == "listItem":
        return adf_to_plain(content)

    return " ".join(p for p in parts if p).strip()
