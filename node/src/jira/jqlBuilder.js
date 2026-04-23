import { raiseForStatus, defaultHeaders } from "../http.js";

/**
 * @param {Record<string, unknown>} field
 * @returns {string[]}
 */
function fieldClausesForCurrentUser(field) {
  if (!field.searchable) return [];

  const name = field.name || field.id;
  if (!name) return [];

  const quoted = JSON.stringify(String(name));
  const schema = /** @type {Record<string, string>} */ (field.schema || {});
  const ftype = schema.type;
  const items = (schema.items || "").toLowerCase();

  if (ftype === "user") return [`${quoted} = currentUser()`];
  if (ftype === "array" && (items === "user" || items === "sd-user")) {
    return [`${quoted} in (currentUser())`];
  }
  return [];
}

/** @param {Record<string, unknown>} settings */
export async function buildJqlFragments(settings) {
  const url = `${settings.site}/rest/api/3/field`;
  const res = await fetch(url, { headers: defaultHeaders(settings) });
  await raiseForStatus(res, "Jira GET /field");
  /** @type {Record<string, unknown>[]} */
  const fields = await res.json();

  const clauses = [
    "assignee = currentUser()",
    "reporter = currentUser()",
    "watcher = currentUser()",
    "participant in (currentUser())",
  ];
  const seen = new Set(clauses);

  for (const field of fields) {
    for (const c of fieldClausesForCurrentUser(field)) {
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

/** @param {Record<string, unknown>} settings */
export async function jiraJqlBatches(settings) {
  if (settings.useRawJqlOnly && settings.rawJql) {
    return [settings.rawJql];
  }

  const fragments = await buildJqlFragments(settings);
  let merged = mergeJqlOr(fragments);
  if (settings.extraJql) {
    merged = `(${merged}) OR (${settings.extraJql})`;
  }
  if (merged.length <= 7200) return [merged];

  const batches = chunkFragments(fragments).map((g) => mergeJqlOr(g));
  if (settings.extraJql) batches.push(settings.extraJql);
  return batches;
}
