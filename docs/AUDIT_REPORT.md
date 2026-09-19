# Client-facing website audit report

Route: `/audits/[auditRunId]/report` (`app/audits/[auditRunId]/report/page.tsx`). A server-rendered, printable document that presents one stored website audit in client-readable form. It is a **view** over existing evidence: it writes nothing, runs no audit, calls no provider and recalculates no score.

Everything on the page comes from stored rows through static lookups. There is no LLM, no generated explanation, no recommendation and no sales copy anywhere in this path; `src/report/`, `src/ui/audit-report/` and `app/audits/` are protected paths of `ai/rules/no-llm-in-crawler.md` and are checked by the quality gate.

## 1. Access and privacy

- **Internal route.** The report is part of the internal application. It is not a public page, and nothing in it is described or offered as a shareable link: there is no "share" or "copy link" control, no token, no signed URL and no public variant.
- **The application has no hard production login gate today.** `middleware.ts` refreshes the Supabase session but does not block a request, and the workspace comes from the local session stub (`src/auth/session.ts`). The report inherits exactly that posture and adds nothing to it. Until the hardening ticket below is done, the URL must not be sent to anyone outside Rank Local; to give a prospect a copy, print it to PDF.
- **Workspace scoping.** `getAuditReportData(workspaceId, auditRunId)` filters every query by the current workspace. A run id from another workspace is indistinguishable from a missing one ("Audit not found").
- **`noindex`.** The page sets `robots: noindex, nofollow`. This only asks search engines not to list the page. **It is not an access-control mechanism** and protects nothing.
- **Contact details are never printed.** The report states phone, email, address and postcode evidence as detected / not detected / not evaluated, with counts ("3 phone numbers detected, on 15 of 15 pages"). It never shows a raw phone number, email address, street address or postcode, even though they were read from the business's own public website. Besides the Local SEO wording, the model drops any evidence value that looks like an email address, a phone-length run of digits or a UK postcode, whichever key carries it. Locality names (towns served) are shown.
- Before any external sharing is enabled: RL-196 (report authentication and sharing hardening), then Epic 10 (RL-190–195: opaque share token, expiry/revoke, public renderer, privacy defaults).

## 2. Data sources

One loader (`src/data/audit-report.ts`), two round trips: the run, then five reads in parallel. Components never query.

| Report content | Source |
|---|---|
| Business name, domain | `prospects.display_name`, `website_audit_runs.canonical_domain` |
| Audit date, versions, run status | `website_audit_runs` (`completed_at` / `blocked_at`, `crawler_version`, `rules_version`, `status`) |
| Overall score, status, coverage, category scores | `website_audit_scores` (newest row of the run, any scoring version), read as stored |
| Category summaries, strengths, score breakdown | `website_audit_scores.breakdown_json` (rule status, points, maximum, measured evidence) |
| Findings | `website_audit_findings` (code, severity, scope, whitelisted evidence keys) |
| Local SEO, structure, crawl scope | `website_audit_runs.site_summary_json` (`schema`, `nap`, `locationPages`, `serviceLocationCombos`, `crawlScope`, sitemap facts) and the page rows' role, fetch status and `evidence_json.challenge` |
| Performance | `website_performance_observations` (homepage, mobile and desktop) |
| Blocked state | `website_audit_runs.status = blocked`, `site_summary_json.challenge` |

The pure model (`src/report/model.ts`, `buildAuditReport`) turns those rows into plain data; it has no I/O, no clock and no randomness, so the same rows always give the same report. Wording lives in `src/report/labels.ts`; performance ratings in `src/report/metrics.ts`.

## 3. Sections

Header (Rank Local wordmark, business, domain, audit date, overall score, status) → version notice (§5) → blocked notice (§4) → evidence coverage → score summary (five categories) → key findings and full findings by category → what is working well → Local SEO → website structure → performance → score breakdown (collapsed) → footer with versions and run id.

- **Category summary.** For a scored category: the failed or partial rule that lost the most points (ties: documented rule order) gives "Key gap: …" from its static text; if nothing lost points, "All evaluated checks passed." A category whose stored score is `null` shows "Not evaluated" and the most frequent stored reason; it never shows a number or a bar.
- **Findings.** Rows are grouped by code (one entry per code with the affected pages). Order: severity (high, medium, low, note), site-wide before page-level, pages affected, code. The first six are the key findings; the full list is grouped by report category. Only whitelisted numeric evidence is shown (lengths, word counts, limits, counts); free text captured from the website (titles, descriptions, anchor text) is not. Findings are explanatory only: no rule carries a recommendation, so none is shown. The operational codes `challenge_page_detected` / `challenge_page_suspected` are never listed as findings; they appear as notes about the audit.
- **What is working well.** Rules with status `pass` only, in scored categories only, in static wording. Partial, failed, not-evaluated and withheld-category rules never appear.
- **Local SEO.** Each line's state comes from its score rule: `not_evaluated` is shown as "Not evaluated" with the stored reason, never as "Not found".
- **Structure.** Role counts over evaluated HTML pages, and a scope sentence from `crawlScope`: all discovered pages evaluated; or stopped at the page limit with N discovered pages not evaluated ("This report does not cover the whole website"); or scope not recorded.
- **Performance.** Mobile and desktop separately. Good / Needs improvement / Poor is shown only where the scoring engine has a documented threshold pair (`PERFORMANCE_THRESHOLDS`: LCP 2500/4000 ms, CLS 0.10/0.25, TBT 200/600 ms, INP 200/500 ms), compared exactly as the score does. The Lighthouse performance score, FCP, Speed Index and TTI are shown as measured values with no rating, because no threshold is defined for them. A failed or absent measurement is "Not measured". Without field data: "Real-user (CrUX) data was not available for this URL. These field-data checks were not evaluated."
- **Score breakdown.** Every rule with status, points, maximum and its stored evidence values, in the order of `RULE_POINTS` (Postgres `jsonb` does not keep key order).

## 4. Score states

One state drives the whole page: `blocked` (run status) → `unscored` (no score row yet) → `insufficient` → `provisional` → `complete` (stored `score_status`).

| State | Overall | Status | Coverage sentence |
|---|---|---|---|
| complete | `83.88 / 100` | Complete | Every category was scored and enough of the audit was measured… |
| provisional | `66.15 / 100 (provisional)`; the word is part of the number, so even 100 is never shown bare | Provisional | Some audit evidence was unavailable, so this score is provisional. |
| insufficient | Not scored | Insufficient evidence | There was not enough reliable evidence to produce an overall score. |
| unscored | Score pending | Score pending | The score for this audit has not been calculated yet. |
| blocked | Not scored | Audit blocked | There was not enough reliable evidence to produce an overall score. |

Evidence coverage is shown directly under the header in every state, with the categories that were withheld and why.

**Blocked audit.** "Audit blocked. The site returned a browser verification or challenge page, so content-based checks could not be evaluated reliably." with the challenge type, URL, HTTP status and page title, detection time and signal codes. The four crawl-derived categories show "Not evaluated", never `0`. Findings, Local SEO and structure state "Not evaluated"; nothing is reported as missing, and the detection is described as a limit of the audit, not as an SEO problem. PageSpeed evidence, measured by the provider, is shown normally.

Runs that are `queued`, `running` or `failed` have no report ("Report not available yet"). The prospect page shows **View client report** only for `completed` and `blocked` runs.

## 5. Historical audit versions

When the stored `crawler_version`, `rules_version` or `scoring_version` is an older generation (`…/vN`) than the version in force, the report shows: "This report was produced using an earlier audit version. Some safeguards available in newer audits were not present for this run." with the stored and current version strings. It is derived from those stored fields alone. No run is special-cased, stored scores and findings are shown exactly as written (rows are immutable), and an older run is never presented as blocked or rescored. To get a report under current safeguards, run a new audit.

## 6. Print / PDF

Browser **Print / Save as PDF** only; there is no server-side PDF generation. `report.css`: A4 `@page` with 14 mm margins; the app navigation, toolbar and button are hidden; white background and black text, with colour kept only for the coverage bar, status chip and tinted notices; cards, findings, table rows and notices avoid page breaks inside; headings are not stranded; no sticky or fixed elements; the score breakdown prints as an appendix on a new page (the print button opens the collapsed section for printing and closes it afterwards). On screen the internal app navigation is hidden on this route, so the page reads as a document when screen-shared.

**Exporting the client PDF (required step).** Browsers add their own print header and footer: the date, the page title, the page URL and a page number. For this internal route the URL is the local or forwarded application address, which must not appear on a client document. In Chrome's print dialog choose **Destination: Save as PDF**, open **More settings** and **untick "Headers and footers"** before saving (Edge: same option; Firefox: set the header and footer fields to blank under Page Setup; Safari: untick "Print headers and footers"). Keep "Background graphics" on so the coverage bar and status chip print. These headers are generated by the browser, not by the page, so the application's CSS does not and must not try to suppress them. Layout verified manually in Chrome print preview (A4) on 2026-09-19.

## 7. Limitations

- English only; static wording. Evidence display is limited to whitelisted keys.
- Key findings are ordered by fixed severity, not by estimated business impact (none is measured).
- One report per audit run; there is no comparison between runs.
- Visual print layout is verified manually in the browser's print preview; tests cover the model and the rendered HTML.
- A clean client PDF depends on the operator disabling the browser's own print headers and footers (§6); the application cannot do it.
