import { isIP } from "node:net";

export type FetchedPage = {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  html: string;
};

export type FetchFailure = {
  ok: false;
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  /** dns/connection failures and non-2xx are "definitive"; timeouts and blocked targets are not. */
  failure: "blocked_target" | "timeout" | "network" | "http_error" | "not_html";
  message: string;
};

export type FetchOutcome = FetchedPage | FetchFailure;

export interface WebsiteFetcher {
  fetchPage(url: string): Promise<FetchOutcome>;
}

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Minimal SSRF guard for verification fetches. The full RL-050 fetcher (DNS pinning, redirect re-validation)
 * replaces this; until then we refuse obvious private targets and non-http(s) schemes.
 */
export function isBlockedTarget(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (ipVersion === 6) {
    return host === "::1" || host === "::" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("::ffff:");
  }
  return false;
}

export class HttpWebsiteFetcher implements WebsiteFetcher {
  constructor(private readonly options: { timeoutMs?: number; userAgent?: string } = {}) {}

  async fetchPage(requestedUrl: string): Promise<FetchOutcome> {
    let parsed: URL;
    try {
      parsed = new URL(requestedUrl);
    } catch {
      return { ok: false, requestedUrl, finalUrl: null, status: null, failure: "blocked_target", message: "Invalid URL" };
    }
    if (isBlockedTarget(parsed)) {
      return { ok: false, requestedUrl, finalUrl: null, status: null, failure: "blocked_target", message: "Target is not a public host" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const response = await fetch(parsed.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": this.options.userAgent ?? "RankLocalGrowthOS-Verifier/1.0 (+website verification)", Accept: "text/html,application/xhtml+xml" },
      });
      const finalUrl = response.url || parsed.toString();
      try {
        if (isBlockedTarget(new URL(finalUrl))) {
          return { ok: false, requestedUrl, finalUrl, status: response.status, failure: "blocked_target", message: "Redirected to a non-public host" };
        }
      } catch {
        /* keep the response's own URL if it cannot be parsed */
      }
      if (!response.ok) {
        return { ok: false, requestedUrl, finalUrl, status: response.status, failure: "http_error", message: `HTTP ${response.status}` };
      }
      const contentType = response.headers.get("content-type");
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        return { ok: false, requestedUrl, finalUrl, status: response.status, failure: "not_html", message: `Unexpected content type ${contentType}` };
      }
      const html = await readLimited(response, MAX_BODY_BYTES);
      return { ok: true, requestedUrl, finalUrl, status: response.status, contentType, html };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, requestedUrl, finalUrl: null, status: null, failure: "timeout", message: "Request timed out" };
      }
      return { ok: false, requestedUrl, finalUrl: null, status: null, failure: "network", message: error instanceof Error ? error.message.slice(0, 200) : "Network error" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (received < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}
