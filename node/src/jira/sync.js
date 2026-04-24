import fs from "node:fs/promises";
import path from "node:path";
import { baseFetchInit, raiseForStatus } from "../http.js";
import { adfToPlain } from "../adfToPlain.js";
import { jiraJqlBatches, resolveJiraApiMajor } from "./jqlBuilder.js";

/** @param {string} s @param {number} [maxLen] */
function safeDirSegment(s, maxLen = 64) {
  const t = (s || "UNKNOWN").trim();
  return t.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, maxLen) || "UNKNOWN";
}

/** @param {Record<string, unknown> | null | undefined} u */
function userLine(u) {
  if (!u) return "";
  const o = /** @type {Record<string, string>} */ (u);
  return String(o.displayName || o.emailAddress || o.accountId || "");
}

/** @param {Record<string, unknown>} issue */
function formatIssueMd(issue) {
  const fields = /** @type {Record<string, unknown>} */ (issue.fields || {});
  const key = String(issue.key || "");
  const summary = String(fields.summary || "");
  const status = /** @type {Record<string, string>} */ (fields.status || {});
  const itype = /** @type {Record<string, string>} */ (fields.issuetype || {});
  const proj = /** @type {Record<string, string>} */ (fields.project || {});
  const assignee = userLine(
    /** @type {Record<string, unknown> | null} */ (fields.assignee)
  );
  const reporter = userLine(
    /** @type {Record<string, unknown> | null} */ (fields.reporter)
  );
  const desc = fields.description;
  let descText = "";
  if (desc && typeof desc === "object") descText = adfToPlain(desc);
  else if (typeof desc === "string") descText = desc;

  const lines = [
    `# ${key}: ${summary}`,
    "",
    `- **Project:** ${proj.key || ""}`,
    `- **Type:** ${itype.name || ""}`,
    `- **Status:** ${status.name || ""}`,
    `- **Assignee:** ${assignee || "-"}`,
    `- **Reporter:** ${reporter || "-"}`,
    "",
    "## Description",
    descText || "_none_",
    "",
    "## All fields (JSON)",
    "```json",
    JSON.stringify(fields, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} settings
 * @param {string} jql
 * @param {string | null} nextPageToken
 */
async function searchPageV3(settings, jql, nextPageToken) {
  const base = String(settings.jiraSite).replace(/\/+$/, "");
  const url = `${base}/rest/api/3/search/jql`;
  const body = {
    jql,
    maxResults: settings.jiraPageSize,
    fields: ["*all"],
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const res = await fetch(url, {
    ...baseFetchInit(settings),
    method: "POST",
    body: JSON.stringify(body),
  });
  await raiseForStatus(res, "Jira POST /search/jql");
  return res.json();
}

/**
 * @param {Record<string, unknown>} settings
 * @param {string} jql
 * @param {number} startAt
 */
async function searchPageV2(settings, jql, startAt) {
  const base = String(settings.jiraSite).replace(/\/+$/, "");
  const url = `${base}/rest/api/2/search`;
  const body = {
    jql,
    startAt,
    maxResults: settings.jiraPageSize,
    fields: ["*all"],
  };
  const res = await fetch(url, {
    ...baseFetchInit(settings),
    method: "POST",
    body: JSON.stringify(body),
  });
  await raiseForStatus(res, "Jira POST /rest/api/2/search");
  return res.json();
}

/** @param {Record<string, unknown>} settings */
export async function syncJira(settings) {
  const outRoot = path.join(String(settings.outputDir), "jira");
  await fs.mkdir(outRoot, { recursive: true });

  const apiMajor = await resolveJiraApiMajor(settings);
  const batches = await jiraJqlBatches(settings, apiMajor);
  await fs.writeFile(
    path.join(outRoot, "_last_jql.txt"),
    batches.join("\n\n--- BATCH ---\n\n") + "\n",
    "utf8"
  );

  const seenKeys = new Set();
  let saved = 0;

  for (const jql of batches) {
    if (apiMajor === 3) {
      let token = null;
      for (let i = 0; i < 50000; i++) {
        const data = await searchPageV3(settings, jql, token);
        const issues = data.issues || [];
        if (!issues.length) break;

        for (const issue of issues) {
          const key = issue.key;
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          const fields = issue.fields || {};
          const pkey =
            (fields.project && fields.project.key) || "UNKNOWN";
          const folder = path.join(outRoot, safeDirSegment(String(pkey)));
          await fs.mkdir(folder, { recursive: true });

          await fs.writeFile(
            path.join(folder, `${key}.md`),
            formatIssueMd(issue),
            "utf8"
          );
          await fs.writeFile(
            path.join(folder, `${key}.json`),
            JSON.stringify(issue, null, 2),
            "utf8"
          );
          saved += 1;
        }

        if (data.isLast) break;
        token = data.nextPageToken || null;
        if (!token) break;
      }
    } else {
      let startAt = 0;
      for (let j = 0; j < 50000; j++) {
        const data = await searchPageV2(settings, jql, startAt);
        const issues = data.issues || [];
        if (!issues.length) break;

        for (const issue of issues) {
          const key = issue.key;
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          const fields = issue.fields || {};
          const pkey =
            (fields.project && fields.project.key) || "UNKNOWN";
          const folder = path.join(outRoot, safeDirSegment(String(pkey)));
          await fs.mkdir(folder, { recursive: true });

          await fs.writeFile(
            path.join(folder, `${key}.md`),
            formatIssueMd(issue),
            "utf8"
          );
          await fs.writeFile(
            path.join(folder, `${key}.json`),
            JSON.stringify(issue, null, 2),
            "utf8"
          );
          saved += 1;
        }

        startAt += issues.length;
        const total = parseInt(String(data.total ?? 0), 10) || 0;
        if (startAt >= total) break;
      }
    }
  }

  return saved;
}
