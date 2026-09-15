import { promises as dns } from "node:dns";
import { isIP } from "node:net";

// Lightweight reachability probe used by the website verifier.
// Not a crawler: one GET per URL, bounded redirects, no HTML parsing.
// Includes a server-side request forgery guard: http(s) only, and every hop must resolve
// to a public address. Full DNS-rebinding protection is deferred to the crawler ticket (RL-050).

export type HttpProbeResult =
  | { ok: true; url: string; finalUrl: string; statusCode: number }
  | { ok: false; url: string; reason: string; statusCode?: number };

export type HttpProbeOptions = {
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
};

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".arpa"];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(address: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (baseInt & mask) >>> 0;
}

const BLOCKED_IPV4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return true;
    return BLOCKED_IPV4.some(([base, bits]) => inCidr(value, base, bits));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIpAddress(mapped[1]);
    // WHATWG URL parsing serialises IPv4-mapped addresses in hex form (::ffff:a00:1 for 10.0.0.1).
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return isBlockedIpAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix
    return false;
  }
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes(".") && isIP(host) === 0) return true;
  return false;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertSafeTarget(url: URL, lookup: (hostname: string) => Promise<string[]>): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsupported_scheme";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) return "blocked_host";
  if (isIP(hostname)) return isBlockedIpAddress(hostname) ? "blocked_address" : null;

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return "dns_error";
  }
  if (addresses.length === 0) return "dns_error";
  if (addresses.some((address) => isBlockedIpAddress(address))) return "blocked_address";
  return null;
}

export async function probeWebsite(inputUrl: string, options: HttpProbeOptions = {}): Promise<HttpProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? "RankLocalGrowthOS-WebsiteVerifier/1.0";

  let current: URL;
  try {
    current = new URL(inputUrl);
  } catch {
    return { ok: false, url: inputUrl, reason: "invalid_url" };
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const blocked = await assertSafeTarget(current, lookup);
    if (blocked) return { ok: false, url: inputUrl, reason: blocked };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      return { ok: false, url: inputUrl, reason: aborted ? "timeout" : "network_error" };
    }
    clearTimeout(timer);

    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, url: inputUrl, reason: "redirect_without_location", statusCode: status };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, url: inputUrl, reason: "invalid_redirect", statusCode: status };
      }
      continue;
    }

    if (status === 404 || status === 410) return { ok: false, url: inputUrl, reason: "not_found", statusCode: status };
    if (status >= 500) return { ok: false, url: inputUrl, reason: "server_error", statusCode: status };
    if (status >= 200 && status < 500) return { ok: true, url: inputUrl, finalUrl: current.toString(), statusCode: status };
    return { ok: false, url: inputUrl, reason: "unexpected_status", statusCode: status };
  }

  return { ok: false, url: inputUrl, reason: "too_many_redirects" };
}
