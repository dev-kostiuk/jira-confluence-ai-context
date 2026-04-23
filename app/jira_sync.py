from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx

from app.adf_text import adf_to_plain
from app.config import Settings
from app.http_util import client, raise_for_status
from app.jql_builder import jira_jql_batches


def _safe_dir_segment(s: str, max_len: int = 64) -> str:
    """Sanitize a project key for use as a directory name (Windows/WSL safe)."""
    s = (s or "UNKNOWN").strip()
    s = re.sub(r'[<>:"/\\\\|?*\x00-\x1f]', "_", s)
    return s[:max_len] or "UNKNOWN"


def _user_line(u: dict[str, Any] | None) -> str:
    if not u:
        return ""
    disp = u.get("displayName") or u.get("emailAddress") or u.get("accountId")
    return str(disp)


def _format_issue_md(issue: dict[str, Any]) -> str:
    fields = issue.get("fields") or {}
    key = issue.get("key", "")
    summary = fields.get("summary", "")
    status = (fields.get("status") or {}).get("name", "")
    itype = (fields.get("issuetype") or {}).get("name", "")
    proj = (fields.get("project") or {}).get("key", "")
    assignee = _user_line(fields.get("assignee"))
    reporter = _user_line(fields.get("reporter"))
    desc = fields.get("description")
    desc_text = ""
    if isinstance(desc, dict):
        desc_text = adf_to_plain(desc)
    elif isinstance(desc, str):
        desc_text = desc

    lines = [
        f"# {key}: {summary}",
        "",
        f"- **Project:** {proj}",
        f"- **Type:** {itype}",
        f"- **Status:** {status}",
        f"- **Assignee:** {assignee or '-'}",
        f"- **Reporter:** {reporter or '-'}",
        "",
        "## Description",
        desc_text or "_none_",
        "",
        "## All fields (JSON)",
        "```json",
        json.dumps(fields, ensure_ascii=False, indent=2),
        "```",
        "",
    ]
    return "\n".join(lines)


def _search_page(
    http: httpx.Client,
    settings: Settings,
    jql: str,
    next_page_token: str | None,
) -> dict[str, Any]:
    url = f"{settings.site}/rest/api/3/search/jql"
    payload: dict[str, Any] = {
        "jql": jql,
        "maxResults": settings.jira_page_size,
        "fields": ["*all"],
    }
    if next_page_token:
        payload["nextPageToken"] = next_page_token
    resp = http.post(url, json=payload)
    raise_for_status(resp, "Jira POST /search/jql")
    return resp.json()


def sync_jira(settings: Settings) -> int:
    """Export issues to output_dir/jira/<PROJECT_KEY>/KEY.md and KEY.json.

    Returns the number of issues written.
    """
    out_root = Path(settings.output_dir) / "jira"
    out_root.mkdir(parents=True, exist_ok=True)

    saved = 0
    with client(settings) as http:
        batches = jira_jql_batches(settings, http)
        (out_root / "_last_jql.txt").write_text(
            "\n\n--- BATCH ---\n\n".join(batches) + "\n", encoding="utf-8"
        )

        seen_keys: set[str] = set()
        for jql in batches:
            token: str | None = None
            # Pagination guard (Jira uses nextPageToken; avoid infinite loops)
            for _ in range(50000):
                data = _search_page(http, settings, jql, token)
                issues = data.get("issues") or []
                if not issues:
                    break

                for issue in issues:
                    key = issue.get("key")
                    if not key or key in seen_keys:
                        continue
                    seen_keys.add(key)
                    fields = issue.get("fields") or {}
                    pkey = (fields.get("project") or {}).get("key") or "UNKNOWN"
                    folder = out_root / _safe_dir_segment(str(pkey))
                    folder.mkdir(parents=True, exist_ok=True)

                    md_path = folder / f"{key}.md"
                    json_path = folder / f"{key}.json"
                    md_path.write_text(_format_issue_md(issue), encoding="utf-8")
                    json_path.write_text(
                        json.dumps(issue, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    saved += 1

                if data.get("isLast"):
                    break
                token = data.get("nextPageToken")
                if not token:
                    break

    return saved
