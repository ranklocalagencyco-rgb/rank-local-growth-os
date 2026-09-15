# Example: pinning a connection to a validated address with undici

Verified in this repository on Node 24 with undici 8: the `connect.lookup` option is honoured by `net.connect`/`tls.connect`, so the socket goes to the address we validated while SNI and the Host header still use the hostname. A hostname absent from the allow-list is refused at connect time.

```ts
import { promises as dns } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { isBlockedIpAddress, isBlockedHostname } from "@/discovery/website/http-probe";

type Family = 4 | 6;
const allowed = new Map<string, { address: string; family: Family }>();

const agent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      const pinned = allowed.get(hostname.toLowerCase());
      if (!pinned) return callback(new Error(`host not allow-listed: ${hostname}`), "", 4);
      if (options && (options as { all?: boolean }).all) {
        return (callback as unknown as (err: null, addresses: { address: string; family: Family }[]) => void)(null, [pinned]);
      }
      callback(null, pinned.address, pinned.family);
    },
  },
});

/** Resolve, validate every address, and register the first valid one for pinning. Throws on any blocked address. */
async function allowHost(hostname: string): Promise<void> {
  if (isBlockedHostname(hostname)) throw new Error("blocked_host");
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((r) => isBlockedIpAddress(r.address))) throw new Error("blocked_address");
  const first = records[0];
  allowed.set(hostname.toLowerCase(), { address: first.address, family: first.family as Family });
}

export async function fetchPinned(url: URL, signal: AbortSignal): Promise<Response> {
  await allowHost(url.hostname);
  return undiciFetch(url.toString(), { dispatcher: agent, redirect: "manual", signal, headers: { "user-agent": "RankLocalGrowthOS-Auditor/1.0" } }) as unknown as Promise<Response>;
}
```

Notes
- Call `allowHost` for every hop of a redirect chain; clear the map when the crawl ends.
- Keep the Agent per crawl (or per job) so keep-alive connections cannot outlive the allow-list.
- Tests inject a `fetchImpl` and a `lookup`, which bypasses pinning by design; the guard functions are tested directly.
