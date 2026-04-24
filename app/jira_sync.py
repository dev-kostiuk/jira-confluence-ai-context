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


def _resolve_jira_api_major(http: httpx.Client, settings: Settings) -> int:
    if settings.jira_rest_api_version in (2, 3):
        return settings.jira_rest_api_version
    base = settings.jira_site
    r = http.get(f"{base}/rest/api/3/field")
    if r.status_code == 200:
        return 3
    if r.status_code == 404:
        r2 = http.get(f"{base}/rest/api/2/field")
        if r2.status_code == 404:
            raise SystemExit(
                "Jira REST returned 404 for both /rest/api/3/field and /rest/api/2/field. "
                "If ATLASSIAN_SITE is your Confluence URL, set JIRA_SITE to the Jira base URL "
                "(browser address bar on the Jira dashboard, no trailing slash)."
            )
        raise_for_status(r2, "Jira GET /rest/api/2/field (v3 unavailable)")
        return 2
    raise_for_status(r, "Jira GET /rest/api/3/field")


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


def _search_page_v3(
    http: httpx.Client,
    settings: Settings,
    jql: str,
    next_page_token: str | None,
) -> dict[str, Any]:
    url = f"{settings.jira_site}/rest/api/3/search/jql"
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


def _search_page_v2(
    http: httpx.Client,
    settings: Settings,
    jql: str,
    start_at: int,
) -> dict[str, Any]:
    url = f"{settings.jira_site}/rest/api/2/search"
    payload: dict[str, Any] = {
        "jql": jql,
        "startAt": start_at,
        "maxResults": settings.jira_page_size,
        "fields": ["*all"],
    }
    resp = http.post(url, json=payload)
    raise_for_status(resp, "Jira POST /rest/api/2/search")
    return resp.json()


def sync_jira(settings: Settings) -> int:
    """Export issues to output_dir/jira/<PROJECT_KEY>/KEY.md and KEY.json.

    Returns the number of issues written.
    """
    out_root = Path(settings.output_dir) / "jira"
    out_root.mkdir(parents=True, exist_ok=True)

    saved = 0
    with client(settings) as http:
        api_major = _resolve_jira_api_major(http, settings)
        batches = jira_jql_batches(settings, http, api_major)
        (out_root / "_last_jql.txt").write_text(
            "\n\n--- BATCH ---\n\n".join(batches) + "\n", encoding="utf-8"
        )

        seen_keys: set[str] = set()
        for jql in batches:
            if api_major == 3:
                token: str | None = None
                for _ in range(50000):
                    data = _search_page_v3(http, settings, jql, token)
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
            else:
                start_at = 0
                for _ in range(50000):
                    data = _search_page_v2(http, settings, jql, start_at)
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

                    start_at += len(issues)
                    total = int(data.get("total") or 0)
                    if start_at >= total:
                        break

    return saved
