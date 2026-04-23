import { Buffer } from "node:buffer";

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
