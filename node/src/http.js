import { Buffer } from "node:buffer";
import { Agent } from "undici";

/** @param {{ email: string, apiToken: string }} settings */
export function authHeader(settings) {
  const raw = `${settings.email}:${settings.apiToken}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/** @param {{ email: string, apiToken: string }} settings */
export function defaultHeaders(settings) {
  return {
    Authorization: authHeader(settings),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** @param {{ httpVerifySsl?: boolean }} settings */
function tlsDispatcher(settings) {
  if (settings.httpVerifySsl !== false) return {};
  return {
    dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
  };
}

/**
 * @param {Record<string, unknown>} settings
 * @param {RequestInit} [init]
 * @returns {RequestInit}
 */
export function baseFetchInit(settings, init = {}) {
  return {
    ...tlsDispatcher(settings),
    ...init,
    headers: { ...defaultHeaders(settings), ...init.headers },
  };
}

export async function raiseForStatus(res, context) {
  if (res.ok) return;
  let detail;
  try {
    detail = await res.json();
  } catch {
    detail = await res.text();
  }
  throw new Error(`${context}: HTTP ${res.status} - ${JSON.stringify(detail)}`);
}
