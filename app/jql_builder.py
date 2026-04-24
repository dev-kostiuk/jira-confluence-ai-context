from __future__ import annotations

import json
from typing import Any

import httpx

from app.config import Settings
from app.http_util import raise_for_status


def _jql_field_reference(field: dict[str, Any]) -> str | None:
    """Stable JQL reference: cf[n] for customfield_n; else id or quoted name."""
    fid = field.get("id")
    if isinstance(fid, str) and fid.startswith("customfield_"):
        suffix = fid[len("customfield_") :]
        if suffix.isdigit():
            return f"cf[{suffix}]"
    if isinstance(fid, str) and fid and " " not in fid:
        return fid
    name = field.get("name")
    if name:
        return json.dumps(str(name))
    return None


def _field_clauses_for_current_user(
    field: dict[str, Any], api_major: int
) -> list[str]:
    """Build JQL fragments for fields where currentUser() is meaningful."""
    if not field.get("searchable", False):
        return []

    fid = field.get("id")
    # Data Center REST often marks fields "searchable" that JQL still rejects (sort-only
    # cf[], internal ids like archivedby). Cloud-style OR-of-all-user-fields is unsafe.
    if api_major == 2:
        return []

    quoted = _jql_field_reference(field)
    if not quoted:
        return []

    schema = field.get("schema") or {}
    ftype = schema.get("type")
    items = (schema.get("items") or "").lower()

    if ftype == "user":
        return [f"{quoted} = currentUser()"]

    if ftype == "array" and items in {"user", "sd-user"}:
        # multi-user picker
        return [f"{quoted} in (currentUser())"]

    return []


def build_jql_fragments(
    http: httpx.Client, settings: Settings, api_major: int
) -> list[str]:
    url = f"{settings.jira_site}/rest/api/{api_major}/field"
    resp = http.get(url)
    raise_for_status(resp, f"Jira GET /rest/api/{api_major}/field")

    fields: list[dict[str, Any]] = resp.json()
    clauses: list[str] = [
        "assignee = currentUser()",
        "reporter = currentUser()",
    ]

    # watcher / participant: Jira Cloud / JSD; often missing on Server/Data Center
    if api_major == 3:
        clauses.append("watcher = currentUser()")
        clauses.append("participant in (currentUser())")

    seen: set[str] = set(clauses)
    for field in fields:
        for c in _field_clauses_for_current_user(field, api_major):
            if c not in seen:
                seen.add(c)
                clauses.append(c)

    return clauses


def merge_jql_or(fragments: list[str]) -> str:
    parts = [f"({f})" for f in fragments if f.strip()]
    return " OR ".join(parts)


def _chunk_fragments(fragments: list[str], max_chars: int = 6500) -> list[list[str]]:
    """Split OR clauses so each JQL substring stays under the approximate size limit."""
    groups: list[list[str]] = []
    buf: list[str] = []
    size = 0
    for frag in fragments:
        frag = frag.strip()
        if not frag:
            continue
        piece = f"({frag})"
        add = len(piece) + (4 if buf else 0)  # " OR "
        if buf and size + add > max_chars:
            groups.append(buf)
            buf = [frag]
            size = len(piece)
        else:
            buf.append(frag)
            size += add
    if buf:
        groups.append(buf)
    return groups


def jira_jql_batches(
    settings: Settings, http: httpx.Client, api_major: int
) -> list[str]:
    """One or more JQL queries; the sync layer deduplicates issue keys across batches."""
    if settings.use_raw_jql_only and settings.raw_jql:
        return [settings.raw_jql]

    fragments = build_jql_fragments(http, settings, api_major)
    merged = merge_jql_or(fragments)
    if settings.extra_jql:
        merged = f"({merged}) OR ({settings.extra_jql})"

    if len(merged) <= 7200:
        return [merged]

    batches = [merge_jql_or(g) for g in _chunk_fragments(fragments) if g]
    if settings.extra_jql:
        batches.append(settings.extra_jql)
    return batches
