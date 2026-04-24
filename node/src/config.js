import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer repo-root `.env`, then current working directory (same layout as the Python CLI).
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });
dotenv.config();

function truthy(val) {
  if (val == null) return false;
  return ["1", "true", "yes", "on"].includes(String(val).trim().toLowerCase());
}

function sslVerifyEnabled() {
  const v = (process.env.HTTPX_VERIFY_SSL || "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}

/** @returns {2 | 3 | null} */
function parseJiraRestApiVersion(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const v = parseInt(String(raw).trim(), 10);
  if (v !== 2 && v !== 3) {
    console.error("JIRA_REST_API_VERSION must be 2 or 3 when set.");
    process.exit(1);
  }
  return v;
}

/** @returns {string | null} */
function normalizeConfluenceRestPrefix(raw) {
  if (raw == null || !String(raw).trim()) return null;
  let p = String(raw).trim().replace(/\/+$/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  return p;
}

/**
 * @returns {{
 *   site: string,
 *   jiraSite: string,
 *   email: string,
 *   apiToken: string,
 *   outputDir: string,
 *   extraJql: string | null,
 *   useRawJqlOnly: boolean,
 *   rawJql: string | null,
 *   confluenceSpaceKeys: string[],
 *   confluenceMaxPagesPerSpace: number,
 *   jiraPageSize: number,
 *   httpVerifySsl: boolean,
 *   jiraRestApiVersion: 2 | 3 | null,
 *   confluenceRestPrefix: string | null,
 * }}
 */
export function loadSettings() {
  const site = (process.env.ATLASSIAN_SITE || "").trim().replace(/\/+$/, "");
  const jiraSiteRaw = (process.env.JIRA_SITE || "").trim().replace(/\/+$/, "");
  const jiraSite = jiraSiteRaw || site;
  const email = (process.env.ATLASSIAN_EMAIL || "").trim();
  const apiToken = (process.env.ATLASSIAN_API_TOKEN || "").trim();

  if (!site || !email || !apiToken) {
    console.error(
      "Set ATLASSIAN_SITE, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN in your environment or .env (see repo .env.example)."
    );
    process.exit(1);
  }

  const spacesRaw = (process.env.CONFLUENCE_SPACE_KEYS || "").trim();
  const confluenceSpaceKeys = spacesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const outputDir = (process.env.OUTPUT_DIR || "output").trim() || "output";
  const extra = (process.env.EXTRA_JQL || "").trim() || null;
  const raw = (process.env.RAW_JQL || "").trim() || null;

  return {
    site,
    jiraSite,
    email,
    apiToken,
    outputDir,
    extraJql: extra,
    useRawJqlOnly: truthy(process.env.USE_RAW_JQL_ONLY),
    rawJql: raw,
    confluenceSpaceKeys,
    confluenceMaxPagesPerSpace: Math.max(
      1,
      parseInt(process.env.CONFLUENCE_MAX_PAGES_PER_SPACE || "500", 10) || 500
    ),
    jiraPageSize: Math.min(
      100,
      Math.max(1, parseInt(process.env.JIRA_PAGE_SIZE || "100", 10) || 100)
    ),
    httpVerifySsl: sslVerifyEnabled(),
    jiraRestApiVersion: parseJiraRestApiVersion(process.env.JIRA_REST_API_VERSION),
    confluenceRestPrefix: normalizeConfluenceRestPrefix(
      process.env.CONFLUENCE_REST_PREFIX
    ),
  };
}
