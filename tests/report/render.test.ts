import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { buildAuditReport, type AuditReportModel } from "@/report/model";
import { clientRenderedShell, shellPerformance, strongPerformance, strongTradesSite } from "../audit/score-fixtures";
import { tradeSiteV2Run } from "./fixtures/trade-site-v2-run";
import { blockedReportData, reportData } from "./report-fixtures";

// Renders the real report components to static HTML. The project compiles TSX for Next.js (tsconfig `jsx: preserve`), so under Vitest
// the components use the classic runtime and expect `React` in scope; it is provided here, for this file only, instead of changing
// the shared Vitest or TypeScript configuration.
(globalThis as { React?: typeof React }).React = React;

let render: (model: AuditReportModel) => string;
beforeAll(async () => {
  const { AuditReport } = await import("@/ui/audit-report/audit-report");
  render = (model) => renderToStaticMarkup(React.createElement(AuditReport, { model }));
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("rendered client report", () => {
  it("complete: the real v2 run shows its stored values", () => {
    const html = render(buildAuditReport(tradeSiteV2Run));
    const body = text(html);
    for (const expected of ["Example Roofing", "example-roofing.co.uk", "Audited 19 September 2026", "83.88 / 100", "Complete", "Evidence coverage", "96%", "24.93 / 25", "16 / 25", "20 / 20", "12.95 / 20", "10 / 10", "LocalBusiness structured data was not detected", "What is working well", "The website is served over HTTPS", "Mobile 66 / 100", "Desktop 80 / 100", "10.4 s", "Poor", "Real-user (CrUX) data was not available for this URL", "Every page the crawler discovered was evaluated", "Score breakdown", "audit-score/v2"]) expect(body, expected).toContain(expected);
    expect(body).not.toContain("Audit blocked");
    expect(body).not.toContain("earlier audit version");
    // Privacy: counts and states only; the fixture's phone numbers, email, street address and postcode never reach the page.
    expect(body).toContain("3 phone numbers detected, on 15 of 15 pages.");
    for (const rawValue of ["07700 900111", "07700900111", "01632 960111", "07700 900222", "office@example-roofing.co.uk", "UB9 9ZZ", "1 Example Yard"]) expect(html, rawValue).not.toContain(rawValue);
    expect(html).toContain('class="audit-report"');
    // Without the route's toolbar there is no screen-only chrome, and the document never links out or offers sharing.
    expect(html).not.toContain("ar-toolbar");
    expect(html).not.toMatch(/<a\s|<button|<script|<form/);
  });

  it("provisional: the score is labelled provisional next to its coverage, and withheld categories show no number", () => {
    const body = text(render(buildAuditReport(reportData(clientRenderedShell(), shellPerformance()))));
    expect(body).toContain("66.15 / 100 (provisional)");
    expect(body).toContain("Some audit evidence was unavailable, so this score is provisional.");
    expect(body).toContain("45%");
    expect(body).not.toMatch(/\b0 \/ 25\b|\b0 \/ 20\b/);
  });

  it("blocked: a distinct state with provenance, no fake zero scores and no SEO framing", () => {
    const html = render(buildAuditReport(blockedReportData(strongPerformance(false))));
    const body = text(html);
    for (const expected of ["Audit blocked", "The site returned a browser verification or challenge page, so content-based checks could not be evaluated reliably.", "Bot challenge / browser verification", "https://example-roofing.co.uk/", "title:one_moment_please", "19 September 2026, 10:00 UTC", "Not scored", "There was not enough reliable evidence to produce an overall score.", "They are not scored as zero.", "19.36 / 20", "Mobile 92 / 100"]) expect(body, expected).toContain(expected);
    expect(body).not.toMatch(/\b0 \/ (?:25|20|10)\b/);
    expect(body).not.toContain("Not found");
    expect(body).not.toContain("Key findings");
    expect(body).not.toContain("was not detected");
    expect(html).not.toContain("ar-state-missing");
  });

  it("historical run: shows the version notice and the stored result unchanged", () => {
    const body = text(render(buildAuditReport(reportData(strongTradesSite(), strongPerformance(true), {}, { run: { crawler_version: "audit-crawler/v3", rules_version: "audit-rules/v3" }, score: { scoring_version: "audit-score/v1" } }))));
    expect(body).toContain("This report was produced using an earlier audit version. Some safeguards available in newer audits were not present for this run.");
    expect(body).toContain("99.49 / 100");
    expect(body).not.toContain("Audit blocked");
  });
});
