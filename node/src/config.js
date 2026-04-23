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

/**
 * @returns {{
 *   site: string,
 *   email: string,
 *   apiToken: string,
 *   outputDir: string,
 *   extraJql: string | null,
 *   useRawJqlOnly: boolean,
 *   rawJql: string | null,
 *   confluenceSpaceKeys: string[],
 *   confluenceMaxPagesPerSpace: number,
 *   jiraPageSize: number
 * }}
 */
export function loadSettings() {
  const site = (process.env.ATLASSIAN_SITE || "").trim().replace(/\/+$/, "");
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
  };
}
