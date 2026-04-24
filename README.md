# jira-context

**jira-context** mirrors Jira issues and Confluence pages you care about into plain files under `output/`. The goal is to give coding assistants (or humans) **fast, grep-friendly, offline-friendly context** from **Atlassian Cloud** or **self-managed Jira / Confluence (Data Center or Server)** — including separate wiki / jira hostnames and the two common Confluence REST base paths (`/wiki/rest/api` vs `/rest/api`).

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

**Cloud vs Data Center:** the same CLI supports **Atlassian Cloud** and **self-managed** instances; see [Configuration](#configuration), [How Jira search works](#how-jira-search-works), and [Troubleshooting](#troubleshooting).

---

## What gets synced

### Jira

Issues are fetched when **any** of the following JQL fragments match (combined with `OR`), then deduplicated by issue key:

- `assignee = currentUser()`
- `reporter = currentUser()`
- `watcher = currentUser()` *(Jira API **v3** / Cloud only; omitted on API v2 / most DC)*
- `participant in (currentUser())` *(same — Cloud-oriented)*
- On **Jira REST API v3** (Cloud): every **searchable** field whose schema is a **single user** or **multi-user picker** (from `GET …/rest/api/3/field`), using stable `cf[…]` references for custom fields where applicable.
- On **Jira REST API v2** (typical Data Center): only **`assignee`** and **`reporter`** are auto-generated (DC often rejects a long OR of user-picker clauses). Use **`EXTRA_JQL`** or **`USE_RAW_JQL_ONLY` + `RAW_JQL`** for broader coverage.

Optional `EXTRA_JQL` is appended with `OR`. If the combined JQL string is very long, it is **split into multiple queries**; results are still deduplicated.

Each issue is written as:

- `KEY.md` — human-readable header plus full field dump as JSON for AI context
- `KEY.json` — raw issue JSON from the search API

### Confluence

For each space (either **all spaces you can list** or a configured subset), **wiki pages** (`type=page`) are exported:

- `title-slug.md` — HTML storage format converted to Markdown
- `title-slug.json` — raw page JSON (metadata + body when returned by search)

If search results omit `body.storage`, the tool performs a follow-up `GET {apiBase}/content/{id}` with `expand=body.storage`, where `{apiBase}` is `{ATLASSIAN_SITE}/wiki/rest/api` on Cloud or `{ATLASSIAN_SITE}/rest/api` on many DC deployments (see **auto-probe** above).

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

- **Jira** (required for Jira sync) and optionally **Confluence**, on either:
  - **Atlassian Cloud** (`*.atlassian.net`), or  
  - **Jira / Confluence Data Center or Server** (your own hostname(s), Basic auth — often **username + password or PAT**, not necessarily a Cloud API token)
- A user account that can access the issues and pages you want to export
- **Python 3.10+** *or* **Node.js 18+** (Node uses global `fetch` and the **`undici`** package for optional TLS relax when `HTTPX_VERIFY_SSL=0`)

---

## Authentication

Both runtimes use **HTTP Basic** on every request: `Authorization: Basic …`.

- **Atlassian Cloud:** create an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Use your **Atlassian account email** as the Basic username and the **API token** as the password (not your Atlassian web login password).
- **Jira / Confluence Data Center or Server:** use whatever your instance accepts for REST Basic auth — commonly the **Jira login username** (not always an email) and **password** or a **Personal Access Token** issued by your server. Cloud-style tokens from `id.atlassian.com` often **do not** work on DC.

Credentials apply to both products; use `JIRA_SITE` / `ATLASSIAN_SITE` when Jira and Confluence live on different URLs.

---

## Configuration

Copy `.env.example` to `.env` in the **repository root** (recommended so both runtimes pick it up).

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLASSIAN_SITE` | **Yes** | **Confluence** base URL (no trailing slash), e.g. `https://wiki.company.com` or `https://acme.atlassian.net` |
| `JIRA_SITE` | No | **Jira** base URL when it differs from `ATLASSIAN_SITE` (other subdomain, host, or `/jira` context). Defaults to `ATLASSIAN_SITE`. |
| `ATLASSIAN_EMAIL` | **Yes** | Basic auth username (Cloud: email; DC: often Jira username) |
| `ATLASSIAN_API_TOKEN` | **Yes** | Basic auth password (Cloud: API token; DC: password or PAT) |
| `OUTPUT_DIR` | No | Output root (default `output`) |
| `EXTRA_JQL` | No | Extra JQL OR-ed onto the auto-generated query |
| `USE_RAW_JQL_ONLY` | No | If `1`, only `RAW_JQL` is used |
| `RAW_JQL` | When raw-only | Full JQL replacing automation |
| `CONFLUENCE_SPACE_KEYS` | No | Comma-separated space keys; empty = all listed spaces |
| `CONFLUENCE_MAX_PAGES_PER_SPACE` | No | Safety cap per space (default `500`) |
| `CONFLUENCE_REST_PREFIX` | No | Force Confluence REST path: `/rest/api` (typical DC on its own host) or `/wiki/rest/api` (Cloud). If unset, both are **auto-probed**. |
| `JIRA_PAGE_SIZE` | No | Page size for Jira search (max `100`, default `100`) |
| `JIRA_REST_API_VERSION` | No | `2` or `3` to **force** Jira REST API version. If unset, **auto-detect** (`3` first, then `2`). Cloud uses `3`; many DC installs use `2`. |
| `HTTPX_VERIFY_SSL` | No | `1` (default) verify TLS; `0` / `false` / `off` disables verification (insecure; useful for corporate CAs). Same variable name in **Python and Node**. |

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

**Base URL:** all Jira REST calls use `JIRA_SITE` (or `ATLASSIAN_SITE` if `JIRA_SITE` is unset).

**API version:** if `JIRA_REST_API_VERSION` is unset, the tools probe `GET …/rest/api/3/field`; on **404** they fall back to **`…/rest/api/2/field`**. Set `JIRA_REST_API_VERSION=2` or `3` to skip probing.

**Field metadata and JQL fragments**

1. `GET {jiraSite}/rest/api/{2|3}/field` loads field metadata (when not using raw-only mode).
2. **API v3 (Cloud):** adds `watcher` / `participant` clauses, plus searchable user / multi-user-picker fields (custom fields referenced as `cf[id]` where possible).
3. **API v2 (typical DC):** only `assignee = currentUser()` and `reporter = currentUser()` — avoids HTTP 400 from DC JQL on fields that are not actually searchable or use localized names.
4. Clauses are OR-merged. If `len(jql) > 7200`, fragments are chunked into multiple JQL strings (chunks run as separate searches; results deduplicated by issue key).

**Search and pagination**

- **API v3:** `POST …/rest/api/3/search/jql` with `nextPageToken` until `isLast` or no token.
- **API v2:** `POST …/rest/api/2/search` with `startAt` / `total` pagination.

**Important:** There is no single universal JQL for “current user anywhere”. On DC, plan on **`EXTRA_JQL`** / **`RAW_JQL`** for project- or role-specific coverage.

---

## How Confluence export works

1. **REST base path:** if `CONFLUENCE_REST_PREFIX` is set (e.g. `/rest/api`), it is used under `ATLASSIAN_SITE`. Otherwise the tools try **`/wiki/rest/api`** (Atlassian Cloud style), then **`/rest/api`** (common on Data Center when Confluence has an empty servlet context). The first path that returns **200** on `GET …/space?start=0&limit=1` wins.
2. Space keys come from `CONFLUENCE_SPACE_KEYS` or paginated `GET {apiBase}/space`.
3. For each space, `GET {apiBase}/content/search` runs CQL `type=page AND space=KEY` (quoted key when needed).
4. Each page is written to Markdown using `html-to-text` (Node) or `html2text` (Python).

Large sites: restrict `CONFLUENCE_SPACE_KEYS` and/or lower `CONFLUENCE_MAX_PAGES_PER_SPACE` to avoid long runs and rate limits.

---

## Limitations

- **Not a backup product** — no attachments download, no version history chains, no incremental delta tracking (full export semantics per run for matched issues/pages).
- **JQL coverage** depends on REST API version: Cloud-style v3 adds many user-field OR clauses; v2 / DC uses a **minimal** assignee/reporter set unless you extend with `EXTRA_JQL` / `RAW_JQL`.
- **Confluence** exports **pages** only (not inline comments, databases, whiteboards, etc., unless they appear as standard page content).
- **Rate limits** — HTTP 429 is retried with backoff (Confluence path); Jira path relies on single-threaded sequential requests but may still hit limits on huge exports.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|--------|---------------|------------|
| `401` / `403` | Bad token or no access | Regenerate token; on DC use username + password/PAT as accepted by your server; confirm `ATLASSIAN_SITE` / `JIRA_SITE` |
| `SSL: CERTIFICATE_VERIFY_FAILED` (Python) or TLS errors (Node) | Private CA / self-signed | Prefer installing your CA; or set `HTTPX_VERIFY_SSL=0` (insecure) |
| Jira `404` on **both** `/rest/api/3/field` and `/rest/api/2/field` | `ATLASSIAN_SITE` points at **Confluence**, not Jira | Set **`JIRA_SITE`** to the Jira root URL (see `.env.example`) |
| Jira error mentioning `watcher` / `participant` | DC / Server without those JQL features | Expected on API v2; use `EXTRA_JQL` / `RAW_JQL` if needed |
| Jira `400` with many “field does not exist / no permission” on DC | Long OR of user fields | Use **`JIRA_REST_API_VERSION=2`** (default auto picks v2 on DC) and `EXTRA_JQL`; or `USE_RAW_JQL_ONLY=1` |
| `410` on `/rest/api/3/search` | Deprecated search endpoint (external tool) | This project uses **`/search/jql`** on API v3 only |
| Confluence `404` on `/wiki/rest/api/space` | DC on dedicated host (empty `/wiki` context) | Set **`CONFLUENCE_REST_PREFIX=/rest/api`** or rely on **auto-probe** (both runtimes) |
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
| HTTP stack | `httpx` | Native `fetch` + `undici` `Agent` when `HTTPX_VERIFY_SSL=0` |
| HTML → Markdown | `html2text` | `html-to-text` |
| Type hints / IDE | Strong typing in source | JSDoc + plain JS |

Behaviour, environment variables, and output paths are intended to match (including **Jira API v2/v3**, **`JIRA_SITE`**, **Confluence REST auto-prefix**, and **TLS verify toggle**). If you find a discrepancy, compare `_last_jql.txt` and issue JSON side by side.

---

## Example `.env` snippets

**Atlassian Cloud (single site):**

```env
ATLASSIAN_SITE=https://your-site.atlassian.net
ATLASSIAN_EMAIL=you@company.com
ATLASSIAN_API_TOKEN=your_cloud_api_token
OUTPUT_DIR=output
CONFLUENCE_SPACE_KEYS=ENG,DOC
```

**Data Center — wiki and Jira on different subdomains:**

```env
ATLASSIAN_SITE=https://wiki.company.internal
JIRA_SITE=https://jira.company.internal
ATLASSIAN_EMAIL=jira_username
ATLASSIAN_API_TOKEN=password_or_pat
HTTPX_VERIFY_SSL=0
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

- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Jira Server / Data Center REST API v2](https://docs.atlassian.com/software/jira/docs/api/REST/9.17.0/)
- [Jira JQL](https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
- [Confluence Cloud REST](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/)
- [Confluence Server REST](https://docs.atlassian.com/atlassian-confluence/REST/9.2.0/)
- [CQL for Confluence](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/)

---

## Ukrainian documentation

See [README.uk.md](README.uk.md) for the same material in Ukrainian.
