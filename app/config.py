from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    site: str
    email: str
    api_token: str
    output_dir: str
    extra_jql: str | None
    use_raw_jql_only: bool
    raw_jql: str | None
    confluence_space_keys: list[str]
    confluence_max_pages_per_space: int
    jira_page_size: int


def _truthy(val: str | None) -> bool:
    if val is None:
        return False
    return val.strip().lower() in {"1", "true", "yes", "on"}


def load_settings() -> Settings:
    load_dotenv()
    site = os.environ.get("ATLASSIAN_SITE", "").strip().rstrip("/")
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
    )
