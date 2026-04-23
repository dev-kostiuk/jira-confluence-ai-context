from __future__ import annotations

import argparse

from app.config import load_settings
from app.confluence_sync import sync_confluence
from app.jira_sync import sync_jira


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync Jira issues and Confluence pages to local files for AI/offline context."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default="all",
        choices=("all", "jira", "confluence"),
        help="What to sync: all | jira | confluence (default: all).",
    )
    args = parser.parse_args()
    settings = load_settings()

    if args.target in ("all", "jira"):
        n = sync_jira(settings)
        print(f"Jira: saved {n} issues → {settings.output_dir}/jira/")
    if args.target in ("all", "confluence"):
        n = sync_confluence(settings)
        print(f"Confluence: saved {n} pages → {settings.output_dir}/confluence/")


if __name__ == "__main__":
    main()
