from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    site: str
    """Base URL for Jira REST (often differs from Confluence when both are on one host)."""
    jira_site: str
    email: str
    api_token: str
    output_dir: str
    extra_jql: str | None
    use_raw_jql_only: bool
    raw_jql: str | None
    confluence_space_keys: list[str]
    confluence_max_pages_per_space: int
    jira_page_size: int
    http_verify_ssl: bool
    # None = auto (try v3, then v2). Set 2 for Jira Server/Data Center without v3 routes.
    jira_rest_api_version: int | None
    # e.g. "/rest/api" (DC on own host) or "/wiki/rest/api" (Cloud). None = auto-probe.
    confluence_rest_prefix: str | None


def _truthy(val: str | None) -> bool:
    if val is None:
        return False
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _parse_jira_rest_api_version(raw: str | None) -> int | None:
    if raw is None or not str(raw).strip():
        return None
    v = int(str(raw).strip())
    if v not in (2, 3):
        raise SystemExit("JIRA_REST_API_VERSION must be 2 or 3 when set.")
    return v


def _ssl_verify_enabled() -> bool:
    """TLS verify for httpx; set HTTPX_VERIFY_SSL=0 for corporate/self-signed CAs."""
    val = os.environ.get("HTTPX_VERIFY_SSL", "1").strip().lower()
    return val not in {"0", "false", "no", "off"}


def load_settings() -> Settings:
    load_dotenv()
    site = os.environ.get("ATLASSIAN_SITE", "").strip().rstrip("/")
    jira_site_raw = os.environ.get("JIRA_SITE", "").strip().rstrip("/")
    jira_site = jira_site_raw or site
    email = os.environ.get("ATLASSIAN_EMAIL", "").strip()
    token = os.environ.get("ATLASSIAN_API_TOKEN", "").strip()
    if not site or not email or not token:
        raise SystemExit(
            "Set ATLASSIAN_SITE, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN in your "
            "environment or .env file (see .env.example)."
        )

    spaces_raw = os.environ.get("CONFLUENCE_SPACE_KEYS", "").strip()
    space_keys = [s.strip() for s in spaces_raw.split(",") if s.strip()]

    return Settings(
        site=site,
        jira_site=jira_site,
        email=email,
        api_token=token,
        output_dir=os.environ.get("OUTPUT_DIR", "output").strip() or "output",
        extra_jql=os.environ.get("EXTRA_JQL", "").strip() or None,
        use_raw_jql_only=_truthy(os.environ.get("USE_RAW_JQL_ONLY")),
        raw_jql=os.environ.get("RAW_JQL", "").strip() or None,
        confluence_space_keys=space_keys,
        confluence_max_pages_per_space=int(
            os.environ.get("CONFLUENCE_MAX_PAGES_PER_SPACE", "500")
        ),
        jira_page_size=min(100, max(1, int(os.environ.get("JIRA_PAGE_SIZE", "100")))),
        http_verify_ssl=_ssl_verify_enabled(),
        jira_rest_api_version=_parse_jira_rest_api_version(
            os.environ.get("JIRA_REST_API_VERSION")
        ),
        confluence_rest_prefix=_normalize_confluence_rest_prefix(
            os.environ.get("CONFLUENCE_REST_PREFIX")
        ),
    )


def _normalize_confluence_rest_prefix(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    p = str(raw).strip().rstrip("/")
    if not p.startswith("/"):
        p = "/" + p
    return p
