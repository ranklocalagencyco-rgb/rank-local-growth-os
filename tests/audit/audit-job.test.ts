import { describe, expect, it } from "vitest";

import { auditJobIdempotencyKey, isAuditEligible, runWebsiteAudit, TransientAuditError } from "@/audit/jobs";
import { SafeFetcher, type FetchLike, type FetchLikeInit } from "@/audit/safe-fetch";
import type { AuditFindingInsert, AuditPageInsert, AuditProspect, AuditRunPatch, AuditStore } from "@/audit/store";
import type { WebsiteAuditPage, WebsiteAuditRun } from "@/db/types";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const prospectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-15T10:00:00.000Z";

type Route = { status?: number; headers?: Record<string, string>; body?: string };

function site(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string, _init: FetchLikeInit) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response("<html><title>Not found</title></html>", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) } });
  }) as unknown as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const html = (title: string, body: string, extra = "") => `<html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.co.uk/"><meta name="description" content="d">${extra}</head><body><h1>${title}</h1>${body}</body></html>`;

const roofingSite: Record<string, Route> = {
  "https://example.co.uk/": { body: html("Home", '<a href="/services/roofing">Roofing</a><a href="/contact">Contact</a><a href="/blog/post-1">Post</a><a href="/missing-page">Old</a><a href="https://facebook.com/x">FB</a><a href="/brochure.pdf">PDF</a>', '<script type="application/ld+json">{"@type":"RoofingContractor"}</script>') },
  "https://example.co.uk/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nSitemap: https://example.co.uk/sitemap.xml\n" },
  "https://example.co.uk/sitemap.xml": { headers: { "content-type": "application/xml" }, body: "<urlset><url><loc>https://example.co.uk/areas/uxbridge</loc></url><url><loc>https://example.co.uk/about</loc></url><url><loc>https://other.example.org/x</loc></url></urlset>" },
  "https://example.co.uk/services/roofing": { body: html("Roofing", "<p>We do roofs</p>") },
  "https://example.co.uk/contact": { body: html("Contact", '<form><input></form><a href="tel:+4418951">Call</a>') },
  "https://example.co.uk/areas/uxbridge": { body: html("Uxbridge", "<p>area</p>") },
  "https://example.co.uk/about": { status: 301, headers: { location: "/about-us" } },
  "https://example.co.uk/about-us": { body: html("About", "<p>about</p><a href='/about'>self</a>") },
  "https://example.co.uk/blog/post-1": { body: "<html><body><p>no title, no h1</p></body></html>" },
};

class MemoryAuditStore implements AuditStore {
  run: WebsiteAuditRun;
  prospect: AuditProspect;
  pages: WebsiteAuditPage[] = [];
  findings: AuditFindingInsert[] = [];
  activity: string[] = [];
  events: string[] = [];
  updates: AuditRunPatch[] = [];

  constructor(prospect: Partial<AuditProspect> = {}, run: Partial<WebsiteAuditRun> = {}) {
    this.prospect = { id: prospectId, workspace_id: workspaceId, display_name: "A&B Roofing", website_state: "verified_website", website_url: "https://example.co.uk", canonical_domain: "example.co.uk", ...prospect };
    this.run = { id: runId, workspace_id: workspaceId, prospect_id: prospectId, job_id: "job-1", requested_by: null, status: "queued", website_url: "https://example.co.uk", canonical_domain: "example.co.uk", crawler_version: "audit-crawler/v2", rules_version: "audit-rules/v2", started_at: null, completed_at: null, failed_at: null, pages_attempted: 0, pages_succeeded: 0, pages_failed: 0, error_summary: null, site_summary_json: {}, crawl_state_json: {}, retention_class: "audit_evidence", created_at: at, updated_at: at, ...run };
  }
  async getRun() { return this.run; }
  async getProspect() { return this.prospect; }
  async updateRun(_id: string, patch: AuditRunPatch) {
    this.updates.push(patch);
    if (patch.status !== undefined) this.run.status = patch.status;
    if (patch.startedAt !== undefined) this.run.started_at = patch.startedAt;
    if (patch.completedAt !== undefined) this.run.completed_at = patch.completedAt;
    if (patch.failedAt !== undefined) this.run.failed_at = patch.failedAt;
    if (patch.pagesAttempted !== undefined) this.run.pages_attempted = patch.pagesAttempted;
    if (patch.pagesSucceeded !== undefined) this.run.pages_succeeded = patch.pagesSucceeded;
    if (patch.pagesFailed !== undefined) this.run.pages_failed = patch.pagesFailed;
    if (patch.errorSummary !== undefined) this.run.error_summary = patch.errorSummary;
    if (patch.siteSummary !== undefined) this.run.site_summary_json = patch.siteSummary;
    if (patch.crawlState !== undefined) this.run.crawl_state_json = JSON.parse(JSON.stringify(patch.crawlState));
  }
  async insertPage(page: AuditPageInsert) {
    const existing = this.pages.find((row) => row.audit_run_id === page.audit_run_id && row.requested_url === page.requested_url);
    if (existing) return { id: existing.id };
    const id = `page-${this.pages.length + 1}`;
    this.pages.push({ id, created_at: at, ...page });
    return { id };
  }
  async listPages(id: string) { return this.pages.filter((row) => row.audit_run_id === id); }
  async insertFindings(rows: AuditFindingInsert[]) {
    for (const row of rows) if (!this.findings.some((f) => f.auditRunId === row.auditRunId && f.pageId === row.pageId && f.code === row.code)) this.findings.push(row);
  }
  async recordActivity(input: { eventType: string }) { this.activity.push(input.eventType); }
  async recordDomainEvent(input: { idempotencyKey: string }) { if (!this.events.includes(input.idempotencyKey)) this.events.push(input.idempotencyKey); }
}

const publicLookup = async () => ["93.184.216.34"];
const context = (deadlineOffsetMs = 60_000, attempts = 1) => ({
  job: { id: "job-1", workspace_id: workspaceId, type: "audit.run", idempotency_key: "k", payload: {}, status: "running" as const, attempts, max_attempts: 4, run_after: at, locked_at: at, locked_by: "t", last_error: null, trace_id: "trace", created_at: at, updated_at: at, finished_at: null },
  deadline: Date.now() + deadlineOffsetMs,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});
const deps = (store: AuditStore, fetchImpl: FetchLike, maxPages = 15) => ({ store, createFetcher: () => new SafeFetcher({ fetchImpl, lookup: publicLookup, timeoutMs: 500 }), config: { auditMaxPages: maxPages }, now: () => new Date(at) });

describe("website audit job", () => {
  it("derives the idempotency key from the run and checks eligibility", () => {
    expect(auditJobIdempotencyKey(runId)).toBe(`audit.run:${runId}`);
    expect(isAuditEligible({ website_state: "verified_website", website_url: "https://x.com" })).toBe(true);
    expect(isAuditEligible({ website_state: "unverified", website_url: "https://x.com" })).toBe(false);
    expect(isAuditEligible({ website_state: "verified_website", website_url: null })).toBe(false);
  });

  it("crawls homepage, sitemap and links in priority order, stores evidence per page, and completes with findings", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site(roofingSite);
    const outcome = await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));

    expect(outcome).toEqual({ status: "completed" });
    expect(store.run).toMatchObject({ status: "completed", pages_attempted: 7, pages_succeeded: 6, pages_failed: 1, error_summary: null });
    expect(store.run.started_at).toBe(at);
    expect(store.run.completed_at).toBe(at);
    // robots + sitemap are auxiliary requests, never pages
    expect(fetchImpl.calls).toContain("https://example.co.uk/robots.txt");
    expect(fetchImpl.calls).toContain("https://example.co.uk/sitemap.xml");
    expect(fetchImpl.calls).not.toContain("https://other.example.org/x");
    expect(fetchImpl.calls).not.toContain("https://facebook.com/x");
    expect(fetchImpl.calls).not.toContain("https://example.co.uk/brochure.pdf");

    const paths = store.pages.map((page) => page.path);
    expect(paths[0]).toBe("/");
    expect(paths.indexOf("/services/roofing")).toBeLessThan(paths.indexOf("/contact"));
    expect(paths.indexOf("/areas/uxbridge")).toBeLessThan(paths.indexOf("/contact"));
    expect(paths.indexOf("/contact")).toBeLessThan(paths.indexOf("/blog/post-1"));
    expect(store.pages.map((page) => page.requested_url)).not.toContain("https://example.co.uk/brochure.pdf");

    const home = store.pages.find((page) => page.page_role === "homepage")!;
    expect(home).toMatchObject({ discovered_via: "homepage", title: "Home", h1_count: 1, schema_types: ["RoofingContractor"], has_structured_data: true, internal_link_count: 5, external_link_count: 1, fetch_ok: true, http_status: 200 });
    expect(home.evidence_json).toMatchObject({ hasLocalBusinessSchema: true, externalHosts: ["facebook.com"] });
    const about = store.pages.find((page) => page.requested_url === "https://example.co.uk/about")!;
    expect(about).toMatchObject({ discovered_via: "sitemap", final_url: "https://example.co.uk/about-us", redirect_count: 1, path: "/about-us", page_role: "about" });
    const missing = store.pages.find((page) => page.requested_url === "https://example.co.uk/missing-page")!;
    expect(missing).toMatchObject({ fetch_ok: true, http_status: 404, discovered_from: "https://example.co.uk/" });

    expect(store.run.site_summary_json).toMatchObject({ homepageHttps: true, robotsTxtReachable: true, sitemapReachable: true, sitemapUrlsDiscovered: 3, sitemapUrlsSameSite: 2, pagesCrawled: 6, servicePagesFound: 1, locationPagesFound: 1, contactPageFound: true, aboutPageFound: true, pagesWithLocalBusinessSchema: 1, brokenInternalLinks: 1, schemaTypesSeen: ["RoofingContractor"] });

    const codes = store.findings.map((finding) => `${finding.scope}:${finding.code}`);
    expect(codes).toContain("page:broken_internal_link");
    expect(codes).toContain("page:missing_title");
    expect(codes).toContain("page:missing_h1");
    expect(codes).not.toContain("site:no_localbusiness_schema");
    expect(codes).not.toContain("site:no_contact_page_detected");
    expect(store.findings.every((finding) => finding.ruleVersion === "audit-rules/v3")).toBe(true);
    expect(store.pages.every((page) => page.evidence_json.evidenceVersion === 3 && page.evidence_json.crawlerVersion === "audit-crawler/v3")).toBe(true);
    expect(store.activity).toEqual(["audit.completed"]);
    expect(store.events).toEqual([`audit.completed:${runId}`]);
  });

  it("never exceeds the page cap and suppresses duplicate URLs", async () => {
    const many: Record<string, Route> = { ...roofingSite, "https://example.co.uk/": { body: html("Home", Array.from({ length: 40 }, (_, i) => `<a href="/services/s${i}">s${i}</a><a href="/services/s${i}?utm=x">dup</a><a href="/services/s${i}#frag">dup</a>`).join("")) } };
    for (let i = 0; i < 40; i += 1) many[`https://example.co.uk/services/s${i}`] = { body: html(`S${i}`, "x") };
    const store = new MemoryAuditStore();
    const fetchImpl = site(many);
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl, 5));
    expect(store.run).toMatchObject({ status: "completed", pages_attempted: 5 });
    expect(store.pages).toHaveLength(5);
    expect(new Set(store.pages.map((page) => page.requested_url)).size).toBe(5);
    const pageFetches = fetchImpl.calls.filter((url) => !/robots\.txt|sitemap\.xml/.test(url));
    expect(pageFetches).toHaveLength(5);
  });

  it("yields at the deadline with persisted crawl state and resumes without refetching or duplicating pages", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site(roofingSite);
    const first = await runWebsiteAudit({ auditRunId: runId, prospectId }, context(0), deps(store, fetchImpl));
    expect(first).toEqual({ status: "continue", delaySeconds: 1 });
    expect(store.run.status).toBe("running");
    const afterFirst = store.pages.length;
    expect(afterFirst).toBe(1); // homepage only, then yielded
    expect(store.run.crawl_state_json).toMatchObject({ phase: "crawl", siteDomain: "example.co.uk" });
    const callsAfterFirst = fetchImpl.calls.length;

    const second = await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(second).toEqual({ status: "completed" });
    expect(fetchImpl.calls.slice(callsAfterFirst)).not.toContain("https://example.co.uk/");
    expect(fetchImpl.calls.slice(callsAfterFirst)).not.toContain("https://example.co.uk/robots.txt");
    expect(store.pages.filter((page) => page.path === "/")).toHaveLength(1);
    expect(store.run.pages_attempted).toBe(7);
  });

  it("is idempotent: re-running a completed run does nothing and a retried finalisation does not duplicate findings", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site(roofingSite);
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    const findings = store.findings.length;
    const calls = fetchImpl.calls.length;
    expect(await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl))).toEqual({ status: "completed" });
    expect(fetchImpl.calls.length).toBe(calls);
    expect(store.findings.length).toBe(findings);

    // Simulate a crash after finalisation started but before the run was marked completed.
    store.run.status = "running";
    store.run.crawl_state_json = { ...store.run.crawl_state_json, phase: "finalize" };
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(store.findings.length).toBe(findings);
    expect(store.run.status).toBe("completed");
  });

  it("fails the run non-retryably when the homepage is blocked, not HTML, or an error status", async () => {
    for (const [url, routes, expected] of [
      ["http://127.0.0.1/", {}, /blocked_address/],
      ["https://example.co.uk", { "https://example.co.uk/": { status: 500, body: "<html></html>" } }, /HTTP 500/],
      ["https://example.co.uk", { "https://example.co.uk/": { headers: { "content-type": "application/pdf" }, body: "%PDF" } }, /not an HTML document/],
    ] as const) {
      const store = new MemoryAuditStore({ website_url: url }, { website_url: url });
      await expect(runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, site(routes as Record<string, Route>)))).rejects.toMatchObject({ name: "NonRetryableJobError" });
      expect(store.run.status).toBe("failed");
      expect(store.run.failed_at).toBe(at);
      expect(store.run.error_summary).toMatch(expected);
      expect(store.activity).toEqual(["audit.failed"]);
    }
  });

  it("retries transient homepage failures, then fails the run on the last attempt", async () => {
    const store = new MemoryAuditStore();
    const slow: FetchLike = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }));
    await expect(runWebsiteAudit({ auditRunId: runId, prospectId }, context(60_000, 1), deps(store, slow))).rejects.toBeInstanceOf(TransientAuditError);
    expect(store.run.status).toBe("running");
    expect(store.run.error_summary).toContain("Retrying after homepage timeout");

    await expect(runWebsiteAudit({ auditRunId: runId, prospectId }, context(60_000, 4), deps(store, slow))).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(store.run.status).toBe("failed");
  });

  it("refuses ineligible prospects and records the failure", async () => {
    const store = new MemoryAuditStore({ website_state: "likely_no_website", website_url: null });
    await expect(runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, site({})))).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(store.run.status).toBe("failed");
    expect(store.run.error_summary).toContain("not eligible");
  });

  it("a failed non-homepage page does not fail the audit", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site({ ...roofingSite, "https://example.co.uk/services/roofing": { status: 503, body: "<html>down</html>" } });
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(store.run.status).toBe("completed");
    expect(store.pages.find((page) => page.path === "/services/roofing")).toMatchObject({ fetch_ok: true, http_status: 503 });
    expect(store.run.pages_failed).toBe(2);
  });

  it("classifies a client-rendered app shell, suppresses content-dependent findings and says rendered content was not evaluated", async () => {
    const shell = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>BS Roof Services</title><meta name="description" content="Expert roofing services."><script type="module" crossorigin src="/assets/index-BQ3hONTC.js"></script></head><body><div id="root"></div></body></html>`;
    const store = new MemoryAuditStore();
    const fetchImpl = site({ "https://example.co.uk/": { body: shell }, "https://example.co.uk/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\n" } });
    const outcome = await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));

    expect(outcome).toEqual({ status: "completed" });
    expect(store.run).toMatchObject({ status: "completed", pages_attempted: 1, pages_succeeded: 1, pages_failed: 0 });
    expect(fetchImpl.calls.filter((url) => !/robots\.txt|sitemap\.xml/.test(url))).toEqual(["https://example.co.uk/"]);
    const home = store.pages[0];
    expect(home.evidence_json).toMatchObject({ renderingMode: "client_rendered_likely", renderingSignals: { wordCount: 0, moduleScriptCount: 1, appBundleScriptCount: 1, emptyAppRoot: true } });
    expect(store.run.site_summary_json).toMatchObject({ pagesCrawled: 1, clientRenderedPages: 1, homepageRenderingMode: "client_rendered_likely", renderedContentEvaluated: false });

    const codes = store.findings.map((finding) => `${finding.scope}:${finding.code}`).sort();
    // Head-level rules (canonical, title/meta length) stay evaluated on a shell; content rules (thin_page, h1, NAP, schema) do not.
    expect(codes).toEqual(["page:meta_description_too_short", "page:missing_canonical", "page:title_too_short", "site:client_rendered_site", "site:sitemap_missing"]);
    const shellFinding = store.findings.find((finding) => finding.code === "client_rendered_site")!;
    expect(shellFinding.evidence).toMatchObject({ renderedContentEvaluated: false, homepageRenderingMode: "client_rendered_likely", notEvaluated: expect.arrayContaining(["missing_h1", "no_contact_page_detected", "no_service_pages_detected", "no_localbusiness_schema", "no_structured_data"]) });
    expect(store.activity).toEqual(["audit.completed"]);
  });

  it("a server-rendered site with a client-rendered widget page is not classified as a client-rendered site", async () => {
    const widget = `<html><head><title>Book</title><script type="module" src="/assets/booking-9f8e7d6c.js"></script></head><body><div id="root"></div></body></html>`;
    const store = new MemoryAuditStore();
    const fetchImpl = site({ ...roofingSite, "https://example.co.uk/": { body: html("Home", '<a href="/services/roofing">Roofing</a><a href="/contact">Contact</a><a href="/blog/post-1">Post</a><a href="/book">Book</a>', '<script type="application/ld+json">{"@type":"RoofingContractor"}</script>') }, "https://example.co.uk/book": { body: widget } });
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(store.run.site_summary_json).toMatchObject({ clientRenderedPages: 1, homepageRenderingMode: "server_rendered", renderedContentEvaluated: true });
    const codes = store.findings.map((finding) => finding.code);
    expect(codes).not.toContain("client_rendered_site");
    expect(codes).toContain("missing_h1"); // /blog/post-1 is sparse server HTML, still judged
    expect(store.findings.filter((finding) => finding.code === "missing_h1").map((finding) => (finding.evidence as { path: string }).path)).not.toContain("/book");
  });

  // WordPress-style site: every link and sitemap entry carries a trailing slash and the server 301s the slash-less form.
  const wpHome = html("Home", `<nav><ul>
    <li><a href="/services/">Services</a><ul><li><a href="/new-roofs/">New Roofs</a></li><li><a href="http://example.co.uk/old-guttering/">Guttering</a></li></ul></li>
    <li><a href="/areas-we-cover/">Areas We Cover</a><ul><li><a href="/uxbridge/">Uxbridge</a></li><li><a href="/ruislip/">Ruislip</a></li></ul></li>
    <li><a href="/contact-us/">Contact Us</a></li><li><a href="/">Home</a></li><li><a href="/index.html">Home again</a></li><li><a href="/privacy-policy/">Privacy</a></li></ul></nav>
    <p>${"word ".repeat(200)}</p><footer><a href="tel:01895 123456">01895 123456</a><p>1 High Street, Uxbridge, UB8 1AA</p></footer>`,
    '<script type="application/ld+json">{"@type":"RoofingContractor","name":"A&B Roofing","telephone":"01895 123456","address":{"@type":"PostalAddress","streetAddress":"1 High Street","addressLocality":"Uxbridge","postalCode":"UB8 1AA"}}</script>');
  const wpSite: Record<string, Route> = {
    "https://example.co.uk/": { body: wpHome },
    "https://example.co.uk/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nSitemap: https://example.co.uk/sitemap.xml\n" },
    "https://example.co.uk/sitemap.xml": { headers: { "content-type": "application/xml" }, body: `<urlset>${["/", "/new-roofs/", "/areas-we-cover/", "/uxbridge/", "/ruislip/", "/hayes/", "/contact-us/", "/privacy-policy/"].map((path) => `<url><loc>https://example.co.uk${path}</loc></url>`).join("")}</urlset>` },
    "https://example.co.uk/new-roofs": { status: 301, headers: { location: "/new-roofs/" } },
    "https://example.co.uk/new-roofs/": { body: html("New Roofs in Uxbridge and Hillingdon", `<p>${"word ".repeat(200)}</p>`) },
    "http://example.co.uk/old-guttering/": { status: 301, headers: { location: "https://example.co.uk/guttering/" } },
    "https://example.co.uk/guttering/": { body: html("Guttering in Uxbridge", `<p>${"word ".repeat(200)}</p>`) },
    "https://example.co.uk/areas-we-cover/": { body: html("Areas We Cover", `<p>${"word ".repeat(200)}</p>`) },
    "https://example.co.uk/uxbridge/": { body: html("Roofers in Uxbridge", `<p>${"word ".repeat(200)}</p>`) },
    "https://example.co.uk/ruislip/": { body: html("Welcome", `<p>${"word ".repeat(200)}</p>`) },
    "https://example.co.uk/hayes/": { body: html("Roofers in Hayes", `<p>${"word ".repeat(200)}</p>`) },
    "https://example.co.uk/contact-us/": { body: html("Contact Us", '<form><input type="email" name="email"></form>') },
    "https://example.co.uk/privacy-policy/": { body: html("Privacy Policy", `<p>${"word ".repeat(200)}</p>`) },
  };

  it("fetches exactly the URLs the site links to: no artefact redirects, one row per page, homepage never refetched", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site(wpSite);
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(store.run.status).toBe("completed");
    expect(fetchImpl.calls).toContain("https://example.co.uk/uxbridge/");
    expect(fetchImpl.calls).not.toContain("https://example.co.uk/uxbridge");
    expect(fetchImpl.calls).not.toContain("https://example.co.uk/new-roofs");
    expect(fetchImpl.calls).not.toContain("https://example.co.uk/index.html");
    expect(fetchImpl.calls.filter((url) => url === "https://example.co.uk/")).toHaveLength(1);
    const paths = store.pages.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(store.pages.filter((page) => page.path === "/")).toHaveLength(1);
    const newRoofs = store.pages.find((page) => page.path === "/new-roofs")!;
    expect(newRoofs).toMatchObject({ requested_url: "https://example.co.uk/new-roofs/", final_url: "https://example.co.uk/new-roofs/", redirect_count: 0, page_role: "service" });
    expect(store.pages.every((page) => page.path === "/guttering" || page.redirect_count === 0)).toBe(true);
    // The real redirect (http → https, different path) is kept as evidence and flagged; the guttering page is one row.
    const guttering = store.pages.find((page) => page.path === "/guttering")!;
    expect(guttering).toMatchObject({ requested_url: "http://example.co.uk/old-guttering/", final_url: "https://example.co.uk/guttering/", redirect_count: 1, page_role: "service" });
    expect(guttering.evidence_json).toMatchObject({ meaningfulRedirect: true });
    expect(store.findings.map((finding) => finding.code)).toContain("internal_link_redirect");
    expect(store.run.site_summary_json).toMatchObject({ internalRedirects: [{ requestedUrl: "http://example.co.uk/old-guttering/", finalUrl: "https://example.co.uk/guttering/", linkedFrom: ["/"] }] });
  });

  it("classifies single-segment location pages from evidence and crawls navigation-listed locations before other pages", async () => {
    const store = new MemoryAuditStore();
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, site(wpSite)));
    const byPath = new Map(store.pages.map((page) => [page.path, page]));
    expect(byPath.get("/uxbridge")).toMatchObject({ page_role: "location", evidence_json: expect.objectContaining({ roleSignals: ["h1_in_place:uxbridge"], locality: "Uxbridge" }) });
    expect(byPath.get("/ruislip")).toMatchObject({ page_role: "location", evidence_json: expect.objectContaining({ roleSignals: ["nav_parent:areas-we-cover"], locality: "Ruislip" }) });
    expect(byPath.get("/hayes")).toMatchObject({ page_role: "location", discovered_via: "sitemap" });
    expect(byPath.get("/areas-we-cover")).toMatchObject({ page_role: "location" });
    expect(byPath.get("/privacy-policy")).toMatchObject({ page_role: "other", evidence_json: expect.objectContaining({ roleSignals: [] }) });
    expect(byPath.get("/new-roofs")?.evidence_json).toMatchObject({ service: "New Roofs", headingPattern: { source: "h1", subject: "New Roofs", preposition: "in", places: ["Uxbridge", "Hillingdon"] } });
    const paths = store.pages.map((page) => page.path);
    expect(paths.indexOf("/ruislip")).toBeLessThan(paths.indexOf("/contact-us"));
    expect(paths.indexOf("/uxbridge")).toBeLessThan(paths.indexOf("/contact-us"));
    expect(paths.indexOf("/privacy-policy")).toBe(paths.length - 1);
    expect(store.run.crawl_state_json).toMatchObject({ linkContext: expect.objectContaining({ "example.co.uk/uxbridge": { anchors: ["Uxbridge"], navParent: "Areas We Cover" }, "example.co.uk/new-roofs": { anchors: ["New Roofs"], navParent: "Services" } }) });

    const summary = store.run.site_summary_json as { locationPagesFound: number; locationPages: { path: string; locality: string | null; hub: boolean }[]; serviceLocationCombos: unknown[]; nap: { phones: { digits: string; sources: string[] }[]; addressCandidates: unknown[] }; schema: { localBusinessMissingFields: string[] } };
    expect(summary.locationPagesFound).toBe(4);
    expect(summary.locationPages).toEqual(expect.arrayContaining([{ path: "/uxbridge", locality: "Uxbridge", hub: false }, { path: "/areas-we-cover", locality: null, hub: true }]));
    expect(summary.serviceLocationCombos).toEqual(expect.arrayContaining([{ path: "/new-roofs", service: "New Roofs", locality: "Uxbridge" }]));
    expect(summary.nap.phones[0]).toMatchObject({ digits: "01895123456", sources: expect.arrayContaining(["tel_link", "text:footer", "schema"]) });
    expect(summary.nap.addressCandidates).toHaveLength(1);
    expect(summary.schema.localBusinessMissingFields).toEqual([]);

    const codes = store.findings.map((finding) => `${finding.code}@${store.pages.find((page) => page.id === finding.pageId)?.path ?? "site"}`);
    expect(codes).toContain("location_page_not_linked_from_homepage@/hayes");
    expect(codes).not.toContain("location_page_not_linked_from_homepage@/uxbridge");
    expect(codes).not.toContain("service_page_not_linked_from_homepage@/new-roofs");
    for (const absent of ["nap_phone_missing", "nap_address_missing", "location_pages_missing", "localbusiness_schema_incomplete", "no_localbusiness_schema"]) expect(codes.join(" ")).not.toContain(absent);
    expect(codes).toContain("title_too_short@/contact-us"); // "Contact Us" is 10 characters
    expect(codes).not.toContain("thin_page@/contact-us"); // contact pages are exempt from thin_page
  });

  it("persists the homepage link context at the deadline so a resumed job classifies and dedupes exactly as an uninterrupted one", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site(wpSite);
    expect(await runWebsiteAudit({ auditRunId: runId, prospectId }, context(0), deps(store, fetchImpl))).toEqual({ status: "continue", delaySeconds: 1 });
    expect(store.pages).toHaveLength(1);
    expect(store.run.crawl_state_json).toMatchObject({ phase: "crawl", linkContext: expect.objectContaining({ "example.co.uk/ruislip": { anchors: ["Ruislip"], navParent: "Areas We Cover" } }) });
    const callsAfterFirst = fetchImpl.calls.length;
    expect(await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl))).toEqual({ status: "completed" });
    const later = fetchImpl.calls.slice(callsAfterFirst);
    expect(later).not.toContain("https://example.co.uk/");
    expect(later).not.toContain("https://example.co.uk/uxbridge");
    expect(later.filter((url) => url === "https://example.co.uk/uxbridge/")).toHaveLength(1);
    expect(store.pages.find((page) => page.path === "/ruislip")).toMatchObject({ page_role: "location", evidence_json: expect.objectContaining({ roleSignals: ["nav_parent:areas-we-cover"] }) });
    expect(new Set(store.pages.map((page) => page.path)).size).toBe(store.pages.length);
    expect(store.run.pages_attempted).toBe(store.pages.length);
  });

  it("never refetches the homepage when the sitemap or a page links back to it", async () => {
    const store = new MemoryAuditStore();
    const fetchImpl = site({
      ...roofingSite,
      "https://example.co.uk/": { body: html("Home", '<a href="/">Home</a><a href="/services/roofing">Roofing</a><a href="/contact">Contact</a>') },
      "https://example.co.uk/sitemap.xml": { headers: { "content-type": "application/xml" }, body: "<urlset><url><loc>https://example.co.uk/</loc></url><url><loc>https://example.co.uk/areas/uxbridge</loc></url></urlset>" },
      "https://example.co.uk/services/roofing": { body: html("Roofing", '<p>We do roofs</p><a href="https://example.co.uk/?utm_source=nav">Back home</a>') },
    });
    await runWebsiteAudit({ auditRunId: runId, prospectId }, context(), deps(store, fetchImpl));
    expect(store.run.status).toBe("completed");
    expect(fetchImpl.calls.filter((url) => url === "https://example.co.uk/")).toHaveLength(1);
    expect(store.pages.filter((page) => page.path === "/")).toHaveLength(1);
    expect(store.run.pages_attempted).toBe(store.pages.length);
    expect(store.run.pages_succeeded + store.run.pages_failed).toBe(store.pages.length);
    expect(store.run.crawl_state_json).toMatchObject({ visited: expect.arrayContaining(["example.co.uk/"]) });
  });
});
