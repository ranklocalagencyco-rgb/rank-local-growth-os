import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

import { isBlockedHostname, isBlockedIpAddress } from "@/discovery/website/http-probe";
import { normalizeDomain } from "@/domain/identifiers";

// SSRF-safe HTTP fetcher for the website audit crawler (RL-050). Follows ai/skills/ssrf-safe-http/SKILL.md.
//
// Controls, in order, for every hop:
//   1. scheme http/https only; no embedded credentials; default ports only;
//   2. hostname blocklist (localhost, metadata hosts, single-label, internal suffixes);
//   3. IP literals and every DNS-resolved address checked against the private/loopback/link-local/multicast tables;
//   4. the connection is pinned to the validated address through an undici Agent whose `connect.lookup` only answers
//      for hosts in this fetcher's allow-list, so a second resolution cannot rebind to an internal address;
//   5. redirects are followed manually, each hop repeating 1-4, capped, and optionally confined to the audited site;
//   6. AbortController timeout covers headers and body; content-length is pre-checked and the body is streamed under a byte cap;
//   7. only HTML bodies are read; other content types are recorded without reading.
//
// Residual limitations: tests inject `fetchImpl`, which bypasses pinning by design (the guards are unit-tested directly);
// a public host that proxies to internal services is the target's responsibility; IPv6 zone identifiers are rejected; the
// fetcher never consults HTTP_PROXY. No LLM is involved anywhere in this path (ai/rules/no-llm-in-crawler.md).

export const AUDIT_USER_AGENT = "RankLocalGrowthOS-Auditor/1.0 (+https://ranklocal.co.uk/bot)";

export type SafeFetchReason =
  | "invalid_url"
  | "unsupported_scheme"
  | "credentials_in_url"
  | "blocked_port"
  | "blocked_host"
  | "blocked_address"
  | "dns_error"
  | "timeout"
  | "network_error"
  | "too_many_redirects"
  | "redirect_without_location"
  | "invalid_redirect"
  | "redirect_off_site"
  | "response_too_large"
  | "body_read_error";

export type SafeFetchResult = {
  /** A response was received and handled within the limits (any HTTP status). */
  ok: boolean;
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  isHtml: boolean;
  /** Decoded body, only for HTML responses within the byte cap. */
  body: string | null;
  bytes: number;
  redirectChain: string[];
  durationMs: number;
  reason: SafeFetchReason | null;
};

export type FetchLikeResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};

export type FetchLikeInit = { method: "GET"; headers: Record<string, string>; signal: AbortSignal; redirect: "manual" };
export type FetchLike = (url: string, init: FetchLikeInit) => Promise<FetchLikeResponse>;
export type HostLookup = (hostname: string) => Promise<string[]>;

export type SafeFetcherOptions = {
  fetchImpl?: FetchLike;
  lookup?: HostLookup;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
};

export type SafeFetchRequestOptions = {
  /** When set, redirects leaving this registrable domain stop the fetch with `redirect_off_site`. */
  sameSiteDomain?: string | null;
  /** Additional content types whose bodies may be read (under the same byte cap), e.g. robots.txt and sitemaps. HTML is always read. */
  readContentTypes?: RegExp;
};

type PinnedAddress = { address: string; family: 4 | 6 };

/** Synchronous checks that need no I/O. Returns the reason the URL is unsafe, or null. */
export function validateAuditUrl(url: URL): SafeFetchReason | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsupported_scheme";
  if (url.username || url.password) return "credentials_in_url";
  if (url.port && url.port !== "") return "blocked_port";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) return "invalid_url";
  if (hostname.includes("%")) return "blocked_host"; // IPv6 zone identifiers are not supported
  if (isBlockedHostname(hostname)) return "blocked_host";
  if (isIP(hostname) && isBlockedIpAddress(hostname)) return "blocked_address";
  return null;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

export class SafeFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly lookup: HostLookup;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly allowed = new Map<string, PinnedAddress>();
  private agent: Agent | null = null;

  constructor(options: SafeFetcherOptions = {}) {
    this.lookup = options.lookup ?? defaultLookup;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.userAgent = options.userAgent ?? AUDIT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => undiciFetch(url, { ...init, dispatcher: this.pinnedAgent() }) as unknown as Promise<FetchLikeResponse>);
  }

  /** Undici agent that only connects to hosts validated in this fetcher, at the address that was validated. */
  private pinnedAgent(): Agent {
    if (this.agent) return this.agent;
    this.agent = new Agent({
      connect: {
        lookup: (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
          const pinned = this.allowed.get(hostname.toLowerCase());
          if (!pinned) return callback(new Error(`host not allow-listed for audit fetch: ${hostname}`));
          if (options && typeof options === "object" && (options as { all?: boolean }).all) return callback(null, [{ address: pinned.address, family: pinned.family }]);
          return callback(null, pinned.address, pinned.family);
        },
      },
    } as ConstructorParameters<typeof Agent>[0]);
    return this.agent;
  }

  /** Releases pooled connections and forgets every validated host. Call when the crawl ends. */
  async close(): Promise<void> {
    this.allowed.clear();
    if (this.agent) {
      const agent = this.agent;
      this.agent = null;
      await agent.close();
    }
  }

  /** Resolves and validates every address for the host, then pins the first one. Returns a reason when blocked. */
  private async allowHost(url: URL): Promise<SafeFetchReason | null> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(hostname)) {
      if (isBlockedIpAddress(hostname)) return "blocked_address";
      this.allowed.set(hostname, { address: hostname, family: isIP(hostname) === 6 ? 6 : 4 });
      return null;
    }
    let addresses: string[];
    try {
      addresses = await this.lookup(hostname);
    } catch {
      return "dns_error";
    }
    if (addresses.length === 0) return "dns_error";
    if (addresses.some((address) => isBlockedIpAddress(address))) return "blocked_address";
    const first = addresses[0];
    this.allowed.set(hostname, { address: first, family: isIP(first) === 6 ? 6 : 4 });
    return null;
  }

  async fetch(inputUrl: string, options: SafeFetchRequestOptions = {}): Promise<SafeFetchResult> {
    const startedAt = Date.now();
    const chain: string[] = [];
    const finish = (partial: Partial<SafeFetchResult> & { reason: SafeFetchReason | null }): SafeFetchResult => ({
      ok: false,
      requestedUrl: inputUrl,
      finalUrl: null,
      status: null,
      contentType: null,
      isHtml: false,
      body: null,
      bytes: 0,
      redirectChain: chain,
      durationMs: Date.now() - startedAt,
      ...partial,
    });

    let current: URL;
    try {
      current = new URL(inputUrl);
    } catch {
      return finish({ reason: "invalid_url" });
    }

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const invalid = validateAuditUrl(current);
      if (invalid) return finish({ reason: invalid, finalUrl: hop === 0 ? null : current.toString() });
      if (options.sameSiteDomain && hop > 0 && normalizeDomain(current.toString()) !== options.sameSiteDomain) {
        return finish({ reason: "redirect_off_site", finalUrl: current.toString() });
      }
      const blocked = await this.allowHost(current);
      if (blocked) return finish({ reason: blocked, finalUrl: hop === 0 ? null : current.toString() });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: FetchLikeResponse;
      try {
        response = await this.fetchImpl(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": this.userAgent, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en-GB,en;q=0.8" },
        });
      } catch (error) {
        clearTimeout(timer);
        return finish({ reason: controller.signal.aborted || (error instanceof Error && error.name === "AbortError") ? "timeout" : "network_error", finalUrl: current.toString() });
      }

      const status = response.status;
      if (status >= 300 && status < 400) {
        clearTimeout(timer);
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location) return finish({ reason: "redirect_without_location", status, finalUrl: current.toString() });
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return finish({ reason: "invalid_redirect", status, finalUrl: current.toString() });
        }
        chain.push(current.toString());
        current = next;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const isHtml = isHtmlContentType(contentType);
      const declaredLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
        clearTimeout(timer);
        controller.abort();
        await response.body?.cancel().catch(() => undefined);
        return finish({ reason: "response_too_large", status, contentType, isHtml, finalUrl: current.toString(), bytes: declaredLength });
      }

      const readable = isHtml || (options.readContentTypes !== undefined && options.readContentTypes.test((contentType ?? "").split(";")[0].trim().toLowerCase()));
      if (!readable) {
        clearTimeout(timer);
        await response.body?.cancel().catch(() => undefined);
        return finish({ ok: true, reason: null, status, contentType, isHtml: false, finalUrl: current.toString(), bytes: Number.isFinite(declaredLength) ? declaredLength : 0 });
      }

      const read = await this.readBody(response, controller);
      clearTimeout(timer);
      if (read.reason) return finish({ reason: read.reason, status, contentType, isHtml, finalUrl: current.toString(), bytes: read.bytes });
      return finish({ ok: true, reason: null, status, contentType, isHtml, finalUrl: current.toString(), body: read.text, bytes: read.bytes });
    }

    return finish({ reason: "too_many_redirects", finalUrl: current.toString() });
  }

  /** Streams the body, aborting as soon as the byte cap is exceeded. */
  private async readBody(response: FetchLikeResponse, controller: AbortController): Promise<{ text: string | null; bytes: number; reason: SafeFetchReason | null }> {
    if (!response.body) return { text: "", bytes: 0, reason: null };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > this.maxBytes) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          return { text: null, bytes, reason: "response_too_large" };
        }
        chunks.push(value);
      }
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      return { text: null, bytes, reason: aborted ? "timeout" : "body_read_error" };
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), bytes, reason: null };
  }
}
