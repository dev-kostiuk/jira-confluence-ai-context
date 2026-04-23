# jira-context

**jira-context** mirrors Jira issues and Confluence pages you care about into plain files under `output/`. The goal is to give coding assistants (or humans) **fast, grep-friendly, offline-friendly context** tied to the same Atlassian Cloud site you already use for work.

This repository ships **two independent implementations** that read the **same environment variables** and write the **same directory layout**:

| Runtime | Location | Typical command |
|--------|----------|------------------|
| **Python** | `app/` | `python -m app` |
| **Node.js** | `node/src/` | `node node/src/cli.js` or `npm run sync` from `node/` |

Pick whichever stack you prefer; you do not need both installed unless you want to compare behaviour.

---

## Table of contents

1. [What gets synced](#what-gets-synced)
2. [Repository layout](#repository-layout)
3. [Prerequisites](#prerequisites)
4. [Authentication](#authentication)
5. [Configuration](#configuration)
6. [Python usage](#python-usage)
7. [Node.js usage](#nodejs-usage)
8. [Output layout](#output-layout)
9. [How Jira search works](#how-jira-search-works)
10. [How Confluence export works](#how-confluence-export-works)
11. [Limitations](#limitations)
12. [Troubleshooting](#troubleshooting)
13. [Security notes](#security-notes)
14. [References](#references)

---

## What gets synced

### Jira

Issues are fetched when **any** of the following JQL fragments match (combined with `OR`), then deduplicated by issue key:

- `assignee = currentUser()`
- `reporter = currentUser()`
- `watcher = currentUser()` *(may be unavailable on some products/plans)*
- `participant in (currentUser())` *(broader “involvement” heuristic)*
- Every **searchable** field on your site whose schema is a **single user** or **multi-user picker** (standard and custom fields returned by `/rest/api/3/field`)

Optional `EXTRA_JQL` is appended with `OR`. If the combined JQL string is very long, it is **split into multiple queries**; results are still deduplicated.

Each issue is written as:

- `KEY.md` — human-readable header plus full field dump as JSON for AI context
- `KEY.json` — raw issue JSON from the search API

### Confluence

For each space (either **all spaces you can list** or a configured subset), **wiki pages** (`type=page`) are exported:

- `title-slug.md` — HTML storage format converted to Markdown
- `title-slug.json` — raw page JSON (metadata + body when returned by search)

If search results omit `body.storage`, the tool performs a follow-up `GET /wiki/rest/api/content/{id}` with `expand=body.storage`.

---

## Repository layout

```
.
├── .env.example          # Copy to `.env` at repo root (recommended)
├── README.md             # This file (English)
├── README.uk.md          # Ukrainian documentation
├── app/                  # Python package
│   ├── __main__.py       # `python -m app`
│   ├── cli.py
│   ├── config.py
│   ├── http_util.py
│   ├── adf_text.py
│   ├── jira_sync.py
│   ├── jql_builder.py
│   └── confluence_sync.py
├── node/                 # Node.js implementation
│   ├── package.json
│   └── src/
│       ├── cli.js
│       ├── config.js
│       ├── http.js
│       ├── adfToPlain.js
│       ├── jira/
│       │   ├── jqlBuilder.js
│       │   └── sync.js
│       └── confluence/
│           └── sync.js
├── pyproject.toml        # Python packaging
├── requirements.txt      # Pip-style deps (optional if you use pyproject)
└── output/               # Created on first run (gitignored)
```

---

## Prerequisites

- An **Atlassian Cloud** site (`*.atlassian.net`) with **Jira** and optionally **Confluence**
- A user account that can access the issues and pages you want to export
- **Python 3.10+** *or* **Node.js 18+** (global `fetch` is used on Node; no `node-fetch` dependency)

---

## Authentication

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and create a token.
2. Use **HTTP Basic**: email as username, **API token** as password (never your Atlassian web password).
3. Both CLIs send `Authorization: Basic …` on every request.

The token inherits your visibility: private issues or restricted spaces will not appear in exports.

---

## Configuration

Copy `.env.example` to `.env` in the **repository root** (recommended so both runtimes pick it up).

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLASSIAN_SITE` | **Yes** | Base URL, e.g. `https://acme.atlassian.net` (no trailing slash) |
| `ATLASSIAN_EMAIL` | **Yes** | Account email for Basic auth |
| `ATLASSIAN_API_TOKEN` | **Yes** | API token |
| `OUTPUT_DIR` | No | Output root (default `output`) |
| `EXTRA_JQL` | No | Extra JQL OR-ed onto the auto-generated query |
| `USE_RAW_JQL_ONLY` | No | If `1`, only `RAW_JQL` is used |
| `RAW_JQL` | When raw-only | Full JQL replacing automation |
| `CONFLUENCE_SPACE_KEYS` | No | Comma-separated space keys; empty = all listed spaces |
| `CONFLUENCE_MAX_PAGES_PER_SPACE` | No | Safety cap per space (default `500`) |
| `JIRA_PAGE_SIZE` | No | Page size for Jira search (max `100`, default `100`) |

**Node.js** also loads `.env` from the current working directory as a fallback. The loader **prefers** `../../.env` relative to `node/src/config.js` (i.e. repo root) so `npm run sync` from inside `node/` still finds a root `.env`.

---

## Python usage

```bash
cd /path/to/jira-context
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
python -m app               # sync everything
python -m app jira
python -m app confluence
```

Installed console script (if your `PATH` includes the venv):

```bash
jira-context
jira-context jira
```

---

## Node.js usage

```bash
cd /path/to/jira-context/node
npm install
npm run sync              # all
npm run sync:jira
npm run sync:confluence
```

Or from the repo root:

```bash
node node/src/cli.js
node node/src/cli.js jira
```

Global-style CLI after `npm install -g .` inside `node/` (optional):

```bash
jira-context-node
```

---

## Output layout

```
output/
├── jira/
│   ├── _last_jql.txt          # Exact JQL batch(es) used on last run
│   ├── PROJECTKEY/
│   │   ├── PROJ-123.md
│   │   └── PROJ-123.json
│   └── OTHER/
│       └── ...
└── confluence/
    ├── _spaces.txt            # Space keys processed last run
    ├── SPACEKEY/
    │   ├── some-page-title.md
    │   ├── some-page-title.json
    │   └── _sync_error.txt    # Only if that space failed
    └── ...
```

Markdown issue headers use English section labels (`Description`, `All fields (JSON)`, etc.) so mixed-language teams get consistent filenames and headings for tooling.

---

## How Jira search works

1. `GET /rest/api/3/field` loads field metadata.
2. For each field with `searchable: true` and schema type `user` or `array` of `user` / `sd-user`, a clause is added, e.g. `"Approvers" in (currentUser())`.
3. Clauses are OR-merged. If `len(jql) > 7200`, fragments are chunked into multiple JQL strings (still OR within each chunk; chunks are run as separate searches).
4. Issues are fetched with `POST /rest/api/3/search/jql` (the modern Jira Cloud endpoint; legacy `/rest/api/3/search` may return **410 Gone**).
5. Pagination follows `nextPageToken` until `isLast` or no token.

**Important:** Jira cannot express “current user appears in *any* field” in one universal JQL. Non-searchable user fields, some plugin fields, or mentions only inside rich text may **not** be matched. Use `EXTRA_JQL` / `RAW_JQL` when you know specific JQL that covers your workflow.

---

## How Confluence export works

1. Space keys come from `CONFLUENCE_SPACE_KEYS` or `GET /wiki/rest/api/space` pagination.
2. For each space, `GET /wiki/rest/api/content/search` runs CQL `type=page AND space=KEY` (quoted key when needed).
3. Each page is written to Markdown using `html-to-text` (Node) or `html2text` (Python).

Large sites: restrict `CONFLUENCE_SPACE_KEYS` and/or lower `CONFLUENCE_MAX_PAGES_PER_SPACE` to avoid long runs and rate limits.

---

## Limitations

- **Not a backup product** — no attachments download, no version history chains, no incremental delta tracking (full export semantics per run for matched issues/pages).
- **JQL coverage** is limited to what your Jira site exposes as searchable user fields plus standard assignee/reporter/watcher/participant clauses.
- **Confluence** exports **pages** only (not inline comments, databases, whiteboards, etc., unless they appear as standard page content).
- **Rate limits** — HTTP 429 is retried with backoff (Confluence path); Jira path relies on single-threaded sequential requests but may still hit limits on huge exports.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|--------|---------------|------------|
| `401` / `403` | Bad token or no access | Regenerate token; confirm site URL and product access |
| Jira error mentioning `watcher` / `participant` | Product/plan does not support clause | Set `USE_RAW_JQL_ONLY=1` and supply a working `RAW_JQL` |
| `410` on `/rest/api/3/search` | Deprecated endpoint (external tool) | Use this project’s code paths; they call `/search/jql` |
| Empty Confluence folders | Private space or search returned nothing | Check `_sync_error.txt`; verify space key |
| Huge `output/` | Whole Confluence + all issues | Narrow `CONFLUENCE_SPACE_KEYS`, add `EXTRA_JQL` time/project filters, or use `RAW_JQL` |

---

## Security notes

- **Never commit `.env`** — it is listed in `.gitignore`.
- API tokens are as sensitive as passwords; rotate if leaked.
- Exported JSON may contain **PII** (names, emails in changelog, custom fields). Treat `output/` like confidential data.

---

## Choosing Python vs Node.js

| Criterion | Python | Node.js |
|-----------|--------|---------|
| Typical install | `pip install -e .` | `npm install` inside `node/` |
| HTTP stack | `httpx` | Native `fetch` |
| HTML → Markdown | `html2text` | `html-to-text` |
| Type hints / IDE | Strong typing in source | JSDoc + plain JS |

Behaviour and output paths are intended to match; if you find a discrepancy, compare `_last_jql.txt` and issue JSON side by side.

---

## Example `.env` (minimal)

```env
ATLASSIAN_SITE=https://your-site.atlassian.net
ATLASSIAN_EMAIL=you@company.com
ATLASSIAN_API_TOKEN=your_token_here
OUTPUT_DIR=output
CONFLUENCE_SPACE_KEYS=ENG,DOC
```

Restricting Confluence spaces is the single biggest lever for shorter runs.

---

## Performance tips

- Start with `python -m app jira` or `node node/src/cli.js jira` to validate credentials before pulling all of Confluence.
- Lower `JIRA_PAGE_SIZE` only if you hit payload limits (rare); it does **not** reduce total API calls proportionally.
- Run during off-peak hours for very large sites to reduce 429 responses.

---

## References

- [Jira Cloud REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Jira JQL](https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
- [Confluence Cloud REST API](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/)
- [CQL for Confluence](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/)

---

## Ukrainian documentation

See [README.uk.md](README.uk.md) for the same material in Ukrainian.
