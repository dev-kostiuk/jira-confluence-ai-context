import { raiseForStatus, baseFetchInit } from "../http.js";

/**
 * @param {Record<string, unknown>} field
 * @returns {string | null}
 */
function jqlFieldReference(field) {
  const fid = field.id;
  if (typeof fid === "string" && fid.startsWith("customfield_")) {
    const suffix = fid.slice("customfield_".length);
    if (/^\d+$/.test(suffix)) return `cf[${suffix}]`;
  }
  if (typeof fid === "string" && fid && !fid.includes(" ")) return fid;
  const name = field.name;
  if (name) return JSON.stringify(String(name));
  return null;
}

/**
 * @param {Record<string, unknown>} field
 * @param {number} apiMajor
 * @returns {string[]}
 */
function fieldClausesForCurrentUser(field, apiMajor) {
  if (!field.searchable) return [];
  if (apiMajor === 2) return [];

  const quoted = jqlFieldReference(field);
  if (!quoted) return [];

  const schema = /** @type {Record<string, string>} */ (field.schema || {});
  const ftype = schema.type;
  const items = (schema.items || "").toLowerCase();

  if (ftype === "user") return [`${quoted} = currentUser()`];
  if (ftype === "array" && (items === "user" || items === "sd-user")) {
    return [`${quoted} in (currentUser())`];
  }
  return [];
}

/**
 * @param {Record<string, unknown>} settings
 * @returns {Promise<2 | 3>}
 */
export async function resolveJiraApiMajor(settings) {
  const forced = settings.jiraRestApiVersion;
  if (forced === 2 || forced === 3) return forced;

  const base = String(settings.jiraSite).replace(/\/+$/, "");
  const r3 = await fetch(`${base}/rest/api/3/field`, baseFetchInit(settings));
  if (r3.status === 200) return 3;
  if (r3.status === 404) {
    const r2 = await fetch(`${base}/rest/api/2/field`, baseFetchInit(settings));
    if (r2.status === 200) return 2;
    if (r2.status === 404) {
      console.error(
        "Jira REST returned 404 for both /rest/api/3/field and /rest/api/2/field. " +
          "If ATLASSIAN_SITE is your Confluence URL, set JIRA_SITE to the Jira base URL " +
          "(browser address bar on the Jira dashboard, no trailing slash)."
      );
      process.exit(1);
    }
    await raiseForStatus(r2, "Jira GET /rest/api/2/field (v3 unavailable)");
    return 2;
  }
  await raiseForStatus(r3, "Jira GET /rest/api/3/field");
  return 3;
}

/**
 * @param {Record<string, unknown>} settings
 * @param {2 | 3} apiMajor
 * @returns {Promise<string[]>}
 */
export async function buildJqlFragments(settings, apiMajor) {
  const base = String(settings.jiraSite).replace(/\/+$/, "");
  const url = `${base}/rest/api/${apiMajor}/field`;
  const res = await fetch(url, baseFetchInit(settings));
  await raiseForStatus(res, `Jira GET /rest/api/${apiMajor}/field`);
  /** @type {Record<string, unknown>[]} */
  const fields = await res.json();

  const clauses = [
    "assignee = currentUser()",
    "reporter = currentUser()",
  ];
  if (apiMajor === 3) {
    clauses.push("watcher = currentUser()");
    clauses.push("participant in (currentUser())");
  }

  const seen = new Set(clauses);
  for (const field of fields) {
    for (const c of fieldClausesForCurrentUser(field, apiMajor)) {
      if (!seen.has(c)) {
        seen.add(c);
        clauses.push(c);
      }
    }
  }
  return clauses;
}

/** @param {string[]} fragments */
export function mergeJqlOr(fragments) {
  const parts = fragments.filter((f) => f.trim()).map((f) => `(${f})`);
  return parts.join(" OR ");
}

/** @param {string[]} fragments @param {number} [maxChars] */
export function chunkFragments(fragments, maxChars = 6500) {
  /** @type {string[][]} */
  const groups = [];
  let buf = [];
  let size = 0;
  for (let frag of fragments) {
    frag = frag.trim();
    if (!frag) continue;
    const piece = `(${frag})`;
    const add = piece.length + (buf.length ? 4 : 0);
    if (buf.length && size + add > maxChars) {
      groups.push(buf);
      buf = [frag];
      size = piece.length;
    } else {
      buf.push(frag);
      size += add;
    }
  }
  if (buf.length) groups.push(buf);
  return groups;
}

/**
 * @param {Record<string, unknown>} settings
 * @param {2 | 3} apiMajor
 * @returns {Promise<string[]>}
 */
export async function jiraJqlBatches(settings, apiMajor) {
  if (settings.useRawJqlOnly && settings.rawJql) {
    return [settings.rawJql];
  }

  const fragments = await buildJqlFragments(settings, apiMajor);
  let merged = mergeJqlOr(fragments);
  if (settings.extraJql) {
    merged = `(${merged}) OR (${settings.extraJql})`;
  }
  if (merged.length <= 7200) return [merged];

  const batches = chunkFragments(fragments).map((g) => mergeJqlOr(g));
  if (settings.extraJql) batches.push(settings.extraJql);
  return batches;
}
