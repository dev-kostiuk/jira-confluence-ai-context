import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { convert } from "html-to-text";
import { defaultHeaders, raiseForStatus } from "../http.js";

/** @param {string} s @param {number} [maxLen] */
function slug(s, maxLen = 100) {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (t || "page").slice(0, maxLen);
}

/** @param {Response} res */
async function respectRateLimit(res) {
  if (res.status !== 429) return;
  const ra = res.headers.get("Retry-After");
  let wait = 2;
  if (ra) {
    const n = parseFloat(ra);
    if (!Number.isNaN(n)) wait = n;
  }
  await delay(Math.min(wait * 1000, 60000));
}

/** @param {Record<string, unknown>} settings @param {string} url @param {string} ctx */
async function getWithRetry(settings, url, ctx) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: defaultHeaders(settings) });
    if (res.status === 429) {
      await respectRateLimit(res);
      continue;
    }
    await raiseForStatus(res, ctx);
    return res;
  }
  throw new Error(`${ctx}: too many HTTP 429 responses`);
}

/** @param {Record<string, unknown>} settings */
async function listSpaces(settings) {
  /** @type {Record<string, unknown>[]} */
  const spaces = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const url = `${settings.site}/wiki/rest/api/space?start=${start}&limit=${limit}&expand=description.view`;
    const res = await getWithRetry(settings, url, "Confluence GET /space");
    const data = await res.json();
    const batch = data.results || [];
    spaces.push(...batch);
    if (batch.length < limit) break;
    start += limit;
  }
  return spaces;
}

/** @param {Record<string, unknown>} settings */
async function spaceKeysToSync(settings) {
  if (settings.confluenceSpaceKeys?.length) {
    return settings.confluenceSpaceKeys.map((k) => String(k).toUpperCase());
  }
  const spaces = await listSpaces(settings);
  return spaces.map((s) => s.key).filter(Boolean).map(String);
}

/** @param {Record<string, unknown>} settings @param {string} pageId */
async function fetchPageDetail(settings, pageId) {
  const url = `${settings.site}/wiki/rest/api/content/${pageId}?expand=body.storage,version`;
  const res = await getWithRetry(settings, url, "Confluence GET /content/{id}");
  return res.json();
}

/** @param {Record<string, unknown>} settings @param {string} spaceKey */
async function searchPagesInSpace(settings, spaceKey) {
  const cap = settings.confluenceMaxPagesPerSpace;
  /** @type {Record<string, unknown>[]} */
  const pages = [];
  let start = 0;
  const limit = 50;
  const sk = spaceKey;
  const cql = /^[A-Za-z0-9_]+$/.test(sk)
    ? `type=page AND space=${sk}`
    : `type=page AND space="${sk}"`;

  while (pages.length < cap) {
    const q = new URLSearchParams({
      cql,
      start: String(start),
      limit: String(limit),
      expand: "body.storage,version",
    });
    const url = `${settings.site}/wiki/rest/api/content/search?${q}`;
    const res = await getWithRetry(settings, url, "Confluence GET /content/search");
    const data = await res.json();
    const batch = data.results || [];
    if (!batch.length) break;
    pages.push(...batch);
    if (batch.length < limit) break;
    start += limit;
  }
  return pages.slice(0, cap);
}

/** @param {string} title @param {string} htmlBody */
function pageToMarkdown(title, htmlBody) {
  const mdBody = convert(htmlBody || "", { wordwrap: false });
  return `# ${title}\n\n${mdBody}`.trim() + "\n";
}

/** @param {Record<string, unknown>} settings */
export async function syncConfluence(settings) {
  const outRoot = path.join(String(settings.outputDir), "confluence");
  await fs.mkdir(outRoot, { recursive: true });

  const keys = await spaceKeysToSync(settings);
  await fs.writeFile(
    path.join(outRoot, "_spaces.txt"),
    keys.join("\n") + "\n",
    "utf8"
  );

  let saved = 0;
  for (const spaceKey of keys) {
    const folder = path.join(outRoot, slug(spaceKey, 16).toUpperCase());
    await fs.mkdir(folder, { recursive: true });
    let pages;
    try {
      pages = await searchPagesInSpace(settings, spaceKey);
    } catch (e) {
      await fs.writeFile(
        path.join(folder, "_sync_error.txt"),
        String(e),
        "utf8"
      );
      continue;
    }

    const usedNames = new Set();
    for (let page of pages) {
      const pid = page.id;
      let title = page.title || `page-${pid}`;
      let body = (page.body && page.body.storage) || {};
      let htmlVal = body.value || "";
      if (pid && !htmlVal) {
        try {
          page = await fetchPageDetail(settings, String(pid));
          body = (page.body && page.body.storage) || {};
          htmlVal = body.value || "";
        } catch {
          // keep empty body
        }
      }

      let base = slug(String(title), 80);
      let name = base;
      let n = 2;
      while (usedNames.has(name)) {
        name = `${base}-${n}`;
        n += 1;
      }
      usedNames.add(name);

      await fs.writeFile(
        path.join(folder, `${name}.md`),
        pageToMarkdown(String(title), String(htmlVal)),
        "utf8"
      );
      await fs.writeFile(
        path.join(folder, `${name}.json`),
        JSON.stringify(page, null, 2),
        "utf8"
      );
      saved += 1;
    }
  }
  return saved;
}
