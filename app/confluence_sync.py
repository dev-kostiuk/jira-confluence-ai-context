from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import html2text
import httpx

from app.config import Settings
from app.http_util import client, raise_for_status


def _confluence_api_base(http: httpx.Client, settings: Settings) -> str:
    """DC on dedicated host uses /rest/api; Cloud uses /wiki/rest/api."""
    site = settings.site.rstrip("/")
    if settings.confluence_rest_prefix:
        path = settings.confluence_rest_prefix
        base = f"{site}{path}"
        r = http.get(f"{base}/space?start=0&limit=1")
        raise_for_status(r, "Confluence GET /space (CONFLUENCE_REST_PREFIX)")
        return base
    for path in ("/wiki/rest/api", "/rest/api"):
        base = f"{site}{path}"
        r = http.get(f"{base}/space?start=0&limit=1")
        if r.status_code == 200:
            return base
    raise SystemExit(
        "Confluence REST not found at .../wiki/rest/api/space or .../rest/api/space. "
        "Set CONFLUENCE_REST_PREFIX (e.g. /rest/api) to match your server."
    )


def _slug(s: str, max_len: int = 100) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9\u0400-\u04FF]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return (s or "page")[:max_len]


def _respect_rate_limit(resp: httpx.Response) -> None:
    if resp.status_code == 429:
        retry = resp.headers.get("Retry-After")
        try:
            wait = float(retry) if retry else 2.0
        except ValueError:
            wait = 2.0
        time.sleep(min(wait, 60.0))


def _get(http: httpx.Client, url: str, ctx: str) -> httpx.Response:
    for attempt in range(5):
        resp = http.get(url)
        if resp.status_code == 429:
            _respect_rate_limit(resp)
            continue
        raise_for_status(resp, ctx)
        return resp
    raise RuntimeError(f"{ctx}: too many HTTP 429 responses")


def _list_spaces(
    http: httpx.Client, settings: Settings, api_base: str
) -> list[dict[str, Any]]:
    spaces: list[dict[str, Any]] = []
    start = 0
    limit = 100
    while True:
        url = (
            f"{api_base}/space"
            f"?start={start}&limit={limit}&expand=description.view"
        )
        resp = _get(http, url, "Confluence GET /space")
        data = resp.json()
        batch = data.get("results") or []
        spaces.extend(batch)
        if len(batch) < limit:
            break
        start += limit
    return spaces


def _space_keys_to_sync(
    settings: Settings, http: httpx.Client, api_base: str
) -> list[str]:
    if settings.confluence_space_keys:
        return [k.upper() for k in settings.confluence_space_keys]
    spaces = _list_spaces(http, settings, api_base)
    keys = []
    for s in spaces:
        k = s.get("key")
        if k:
            keys.append(str(k))
    return keys


def _fetch_page_detail(
    http: httpx.Client, settings: Settings, api_base: str, page_id: str
) -> dict[str, Any]:
    url = (
        f"{api_base}/content/{page_id}"
        "?expand=body.storage,version"
    )
    resp = _get(http, url, "Confluence GET /content/{id}")
    return resp.json()


def _search_pages_in_space(
    http: httpx.Client, settings: Settings, api_base: str, space_key: str
) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    start = 0
    limit = 50
    cap = settings.confluence_max_pages_per_space
    while len(pages) < cap:
        # CQL: omit quotes for simple alphanumeric space keys
        sk = space_key
        if re.fullmatch(r"[A-Za-z0-9_]+", sk):
            cql = f"type=page AND space={sk}"
        else:
            cql = f'type=page AND space="{sk}"'
        url = (
            f"{api_base}/content/search"
            f"?cql={quote(cql)}&start={start}&limit={limit}"
            f"&expand=body.storage,version"
        )
        resp = _get(http, url, "Confluence GET /content/search")
        data = resp.json()
        batch = data.get("results") or []
        if not batch:
            break
        pages.extend(batch)
        if len(batch) < limit:
            break
        start += limit
    return pages[:cap]


def _page_to_markdown(title: str, html_body: str) -> str:
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.body_width = 0
    md_body = h.handle(html_body or "")
    return f"# {title}\n\n{md_body}".strip() + "\n"


def sync_confluence(settings: Settings) -> int:
    """Export pages to output_dir/confluence/<SPACE_KEY>/slug.md plus .json metadata."""
    out_root = Path(settings.output_dir) / "confluence"
    out_root.mkdir(parents=True, exist_ok=True)

    saved = 0
    with client(settings) as http:
        api_base = _confluence_api_base(http, settings)
        keys = _space_keys_to_sync(settings, http, api_base)
        (out_root / "_spaces.txt").write_text(
            "\n".join(keys) + "\n", encoding="utf-8"
        )

        for space_key in keys:
            folder = out_root / _slug(space_key, 16).upper()
            folder.mkdir(parents=True, exist_ok=True)
            try:
                pages = _search_pages_in_space(http, settings, api_base, space_key)
            except RuntimeError as e:
                err_file = folder / "_sync_error.txt"
                err_file.write_text(str(e), encoding="utf-8")
                continue

            used_names: set[str] = set()
            for page in pages:
                pid = page.get("id")
                title = page.get("title") or f"page-{pid}"
                body = (page.get("body") or {}).get("storage") or {}
                html_val = body.get("value") or ""
                if pid and not html_val:
                    try:
                        page = _fetch_page_detail(http, settings, api_base, str(pid))
                        body = (page.get("body") or {}).get("storage") or {}
                        html_val = body.get("value") or ""
                    except RuntimeError:
                        pass

                base = _slug(title, 80)
                name = base
                n = 2
                while name in used_names:
                    name = f"{base}-{n}"
                    n += 1
                used_names.add(name)

                md_path = folder / f"{name}.md"
                json_path = folder / f"{name}.json"
                md_path.write_text(
                    _page_to_markdown(str(title), str(html_val)),
                    encoding="utf-8",
                )
                json_path.write_text(
                    json.dumps(page, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                saved += 1

    return saved
