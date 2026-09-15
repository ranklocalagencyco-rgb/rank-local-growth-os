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
    this.run = { id: runId, workspace_id: workspaceId, prospect_id: prospectId, job_id: "job-1", requested_by: null, status: "queued", website_url: "https://example.co.uk", canonical_domain: "example.co.uk", crawler_version: "audit-crawler/v1", rules_version: "audit-rules/v1", started_at: null, completed_at: null, failed_at: null, pages_attempted: 0, pages_succeeded: 0, pages_failed: 0, error_summary: null, site_summary_json: {}, crawl_state_json: {}, retention_class: "audit_evidence", created_at: at, updated_at: at, ...run };
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
    expect(store.findings.every((finding) => finding.ruleVersion === "audit-rules/v1")).toBe(true);
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
});
