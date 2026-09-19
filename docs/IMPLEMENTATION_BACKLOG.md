# Rank Local Growth OS — Implementation Backlog

This backlog is ordered by dependency and revenue value.

Ticket IDs are stable planning identifiers.

---

# EPIC 0 — Engineering Foundation

## RL-001 Repository + TypeScript standards
**DoD**
- app boots locally;
- lint/typecheck/test commands;
- environment validation.

## RL-002 Environment separation
- local/staging/prod config;
- `SEND_MODE`;
- provider sandbox settings.

## RL-003 Auth + workspace
- login;
- one workspace;
- owner role;
- future `workspace_id` architecture.

## RL-004 Database migrations
- migration framework;
- seed data;
- rollback strategy.

## RL-005 Structured logging + Sentry
- trace IDs;
- safe error messages;
- background-job correlation.

## RL-006 Durable job framework
- enqueue;
- retry;
- idempotency;
- dead-letter behavior.

## RL-007 Domain-event outbox
- transactional event write;
- publisher worker;
- exactly-once effect strategy via idempotency.

---

# EPIC 1 — CRM, Campaigns & Compliance Core

## RL-010 Prospect schema
## RL-011 Prospect list UI
## RL-012 Prospect detail shell
## RL-013 Campaign schema
## RL-014 Campaign builder UI
## RL-015 Source-reference model
## RL-016 Field provenance
## RL-017 Deduplication service
## RL-018 Entity-merge review queue
## RL-019 Suppression store
## RL-020 Suppression preflight service
## RL-021 Compliance profile + policy engine
## RL-022 Activity timeline

**Milestone check:** manually create prospects/campaigns and suppress a prospect.

---

# EPIC 2 — Discovery

## RL-030 Provider abstraction
Interface:
```text
searchCandidates()
getReferenceDetails()
```

## RL-031 Google Places discovery adapter (optional fallback)
- Text Search/field-mask support;
- provider attribution/policy notes;
- retain place ID correctly;
- candidate TTL/purge.

## RL-031a DataForSEO discovery adapter (primary)
- Google Maps SERP endpoints, one task per search unit, contact fields included;
- `DATAFORSEO_MODE` standard (queued task_post + task_get, default) / priority / live, same normalised output;
- ranking position, rating and coordinates captured separately from identity; `local_rank_observations` per run;
- request cap per run, candidate cap, provider cost and mode recorded on `campaign_runs`;
- My Business Info lookup only for purge re-fetch;
- no website crawling through the provider;
- provider selected by `DISCOVERY_PROVIDER` (default `dataforseo`); Google key optional.

## RL-032 Territory search planner
- towns/postcodes;
- category expansion;
- pagination/cursors;
- caps.

## RL-033 Discovery run worker
## RL-034 Candidate review UI
## RL-035 Candidate resolver
## RL-036 Official website verifier
## RL-037 Companies House adapter
## RL-038 Corporate-entity classifier
## RL-039 Discovery quality metrics

**Milestone check:** campaign produces deduplicated canonical prospects without relying on permanent storage of restricted discovery payloads.

---

# EPIC 3 — Website Audit

## RL-050 SSRF-safe URL fetcher
Critical security ticket.
- implemented in `src/audit/safe-fetch.ts`: scheme/credential/port/host/IP checks, DNS validation with connection pinning, per-hop redirect revalidation, timeout, byte cap, HTML-only parsing (see `ai/skills/ssrf-safe-http`).

## RL-051 Crawl scheduler
- implemented: bounded frontier (homepage → sitemap → links), role prioritisation, persisted crawl state, `audit.run` job.
## RL-052 HTML metadata parser
- implemented in `src/audit/extract.ts` (cheerio).
## RL-053 Heading/content parser
- implemented (H1/H2, word count).
## RL-054 robots/sitemap parser
- implemented in `src/audit/sitemap.ts`.
## RL-055 internal-link graph
- implemented within crawl scope (audit-crawler/v3): per-page stored links with anchor text, region and menu parent (`evidence_json.links`), inbound-link graph at finalisation (`src/audit/site-evidence.ts`), homepage coverage of service/location pages, meaningful internal redirects, pages without inbound links; whole-site graph still out of scope.
## RL-056 structured-data parser
- implemented (JSON-LD @graph/@type, microdata itemtype, RDFa typeof); v3 adds LocalBusiness/Organization detail (name, telephone, PostalAddress, areaServed, geo, sameAs, opening hours, price range), AggregateRating/Review counts, BreadcrumbList names and `@id` reference resolution (`src/audit/schema.ts`).
## RL-057 CTA/contact detector
- implemented (tel/mailto/form/CTA counts, contact page role); v3 adds NAP observations with provenance (`src/audit/nap.ts`): phones, emails, UK postcodes, address candidates, business-name signals, contact-form presence.
## RL-057a multi-signal page classification
- implemented (`src/audit/classify.ts`): path keywords, page schema type, H1/title "X in PLACE" pattern, breadcrumb parent, homepage navigation parent; roles `gallery` and `blog` added (migration 007).
## RL-058 PageSpeed adapter
- implemented: provider-neutral `PerformanceProvider` (`src/performance/provider.ts`), PageSpeed Insights v5 adapter with an optional key, `audit.performance` job (homepage only, mobile + desktop, one request per invocation, bounded retries), `website_performance_observations` (migration 008). Field data is stored when returned; a dedicated CrUX adapter remains RL-059.
## RL-059 optional CrUX adapter
## RL-060 rendered screenshot worker
## RL-061 evidence-item writer
- implemented as `website_audit_pages` + `site_summary_json` (migration 006).
## RL-062 finding rules engine
- implemented in `src/audit/findings.ts` (`audit-rules/v3`): 31 codes with fixed severity, static text and stored evidence; thresholds in `src/audit/thresholds.ts`; catalogue and limitations in `docs/AUDIT_RULES.md`. Near-duplicate body-content detection is documented as not implemented.
## RL-063 audit summary UI
- minimal panel on the prospect page (status, pages, findings).
## RL-064 evidence inspector
## RL-065 audit retry/failure UI
## RL-066 recover audits stranded by a dead-lettered `audit.performance` job (future reliability ticket, not started)
- known gap (`docs/AUDIT_SCORE.md` §7): if `audit.performance` dead-letters on an infrastructure error rather than a provider error, its observation rows stay `pending`, `audit.score` is never enqueued and the audit has no score until an operator re-queues the job.
- wanted: a deterministic, idempotent recovery path, e.g. on dead-letter mark the run's still-`pending` observations `failed` with a safe `error_code` and enqueue `audit.score` (which then reports `provisional` with Performance withheld), plus an operator-visible signal. Must follow `ai/rules/jobs-contract.md`; terminal rows are still never rewritten.
## RL-067 Detect bot/challenge/interstitial pages during audit crawl
- implemented: deterministic detector `challenge-detector/v1` (`src/audit/challenge-detection.ts`), terminal run status `blocked` + `blocked_at` (migration 009), homepage challenge stops the crawl after one request, secondary challenge pages excluded and never followed, operational findings `challenge_page_detected` / `challenge_page_suspected` (`audit-rules/v4`, `audit-crawler/v4`), `audit-score/v2` (blocked run = Performance only, always `insufficient_evidence`; ordinary sites score exactly as under v1), minimal "Audit blocked" panel on the prospect page. Rules and limitations: `docs/AUDIT_RULES.md` §7, `docs/AUDIT_SCORE.md` §5.6. Detection only: no solving, no evasion, no automatic retry.
- validated 2026-09-19: migration 009 deployed through the CLI flow; one live audit of a real 15-page trade site that had previously been challenged completed normally under `audit-crawler/v4` with no detection at any confidence and an `audit-score/v2` result whose crawl-derived categories equal its earlier `audit-score/v1` row; the blocked path is covered by the mocked-fetch job tests (`tests/audit/audit-job.test.ts`). No audit was repeated to provoke a challenge. Follow-ups: RL-068, RL-069.
- original problem statement:
- known gap, seen live on 2026-09-19: a host's anti-bot layer answered the crawler with an HTTP 200 interstitial ("One moment, please...", 8 words, no links, sitemap unreachable). The crawler stored it as the homepage, the run completed with 1 page, and `audit-score/v1` correctly scored that evidence as `complete`, which misrepresents the site. PageSpeed, fetched by Google, measured the real page in the same run.
- wanted: deterministic detection in the crawler (no LLM): known challenge titles/markers and vendor headers, a near-empty body with no links, a sitemap that stops answering, contradiction with an earlier run's page count. A detected challenge marks the run blocked/not evaluated with a safe reason instead of completing, produces no findings from the interstitial, and leaves the score `insufficient_evidence` or unwritten. No challenge solving or evasion; respect the host's decision and report it.

## RL-068 Site-wide escalation and retry policy for challenged crawls (future reliability ticket, not started)
- out of scope for RL-067 by decision: only the homepage can change a run to `blocked`. Ideas to evaluate later, each needing its own false-positive analysis: stop the crawl or mark it degraded when several consecutive or a large share of secondary pages are challenge documents (a WAF that engages mid-crawl); vendor response headers (`cf-mitigated`, `x-sucuri-*`), which need `SafeFetchResult` to expose a bounded header allow-list; a bounded, scheduled retry with backoff for blocked runs (today a retry is a new manual audit); comparing with an earlier run's page count.

## RL-069 Detect challenge/interstitial responses served with HTTP 403/503 (future reliability ticket, not started)
- current limitation (`docs/AUDIT_RULES.md` §7.4): RL-067 only inspects HTTP 2xx HTML. An anti-bot challenge returned with a non-200 status (commonly 403 or 503) ends the run as `failed` ("Homepage returned HTTP 403") on the homepage, or is stored as a failed page elsewhere, which reads as a site fault.
- scope: detect anti-bot / challenge responses returned as non-200 statuses, and distinguish them from genuine origin or server failures where possible (the same challenge-only markers on the error body; a plain 403/503 without them stays a failure). A detected homepage challenge would end as `blocked`, not `failed`. Detection only, deterministic, no evasion. Not implemented in RL-067.

**Milestone A:** `Find + Audit`.

Acceptance:
- run a trade/location campaign;
- choose a prospect;
- audit finishes;
- top findings have source evidence;
- failures do not block app.

---

# EPIC 4 — Scoring & Research

## RL-070 Score v1 rules
- implemented: `audit-score/v1` (`src/audit/score/`), a website-quality score from stored evidence with pass / partial / fail / not-evaluated rules, denominator normalization and evidence-sufficiency states; documented in `docs/AUDIT_SCORE.md`. This is the audit score, not the Opportunity Score of spec §12.
## RL-071 Score versioning
- implemented for the audit score: `scoring_version` on immutable `website_audit_scores` rows, unique per (audit run, version).
## RL-072 Score explanation UI
- minimal internal panel on the prospect page (overall, status, categories, mobile/desktop performance, field-data availability, coverage, version). The per-rule explanation view and any client-facing report are not built.
## RL-073 Offer catalogue
## RL-074 Rank Local Brain schema
## RL-075 Brain editor
## RL-076 Retrieval service
## RL-077 AI gateway
## RL-078 Research synthesizer
## RL-079 Sales-angle selector
## RL-080 AI provenance logging
## RL-081 Research review UI

Acceptance:
- top-opportunity list is rankable;
- score can be explained from evidence;
- research cannot cite unknown evidence IDs.

---

# EPIC 5 — Drafting & Grounding

## RL-090 Sequence schema/editor
## RL-091 Email-draft service
## RL-092 Structured claim output
## RL-093 Grounding validator
## RL-094 Unsupported-number validator
## RL-095 Draft approval queue
## RL-096 Draft editor
## RL-097 Regenerate-with-feedback action
## RL-098 Draft quality metrics

**Milestone B:** `Audit + Draft`.

Acceptance:
- one click creates a grounded draft;
- unsupported claim blocks approval;
- operator sees exact evidence.

---

# EPIC 6 — Gmail Send

## RL-110 OAuth mailbox connection
## RL-111 Mailbox health
## RL-112 Gmail draft/send adapter
## RL-113 Idempotent send controller
## RL-114 Provider message/thread persistence
## RL-115 Daily send caps
## RL-116 Sequence scheduler
## RL-117 Pre-send compliance/suppression check
## RL-118 Send audit log
## RL-119 Send failure/retry UI

**Milestone C:** `Approve + Send`.

Acceptance:
- staging cannot live-send;
- production approved message sends once only;
- provider IDs map back to prospect.

---

# EPIC 7 — Inbox & Replies

## RL-130 Gmail inbound sync
## RL-131 Thread mapper
## RL-132 Immediate sequence stop on genuine reply
## RL-133 Bounce/system detector
## RL-134 Hard opt-out detector
## RL-135 Suppression propagation
## RL-136 Reply classifier
## RL-137 Classification review UI
## RL-138 Reply draft generator
## RL-139 Reply approval/send
## RL-140 Classification evaluation harness

**Milestone D:** `Reply + Stop`.

Acceptance:
- explicit unsubscribe is suppressed before another send;
- positive reply appears in inbox queue;
- wrong classification can be corrected and logged.

---

# EPIC 8 — Pipeline & Meetings

## RL-150 Opportunity table
## RL-151 Pipeline board
## RL-152 Meeting record
## RL-153 Calendar-link/manual meeting workflow
## RL-154 Call brief generator
## RL-155 Call brief UI
## RL-156 Call notes/transcript input
## RL-157 Call summary generator
## RL-158 Proposal-input builder
## RL-159 Next-action task

**Milestone E:** `Meeting + Brief`.

At this point V1 has a complete lead-to-meeting loop.

---

# EPIC 9 — Analytics & Operations

## RL-170 Funnel aggregation
## RL-171 Campaign analytics
## RL-172 Category/geography breakdown
## RL-173 Score-band conversion
## RL-174 Draft rejection/edit metrics
## RL-175 Provider/API cost metrics
## RL-176 Job-health dashboard
## RL-177 Agent-map visualization
## RL-178 Circuit breakers
## RL-179 Audit/bounce/opt-out alerts

---

# EPIC 10 — Public Audit Pages (V1.1)

## RL-190 Opaque share token
## RL-191 Expiry/revoke
## RL-192 Public audit renderer
## RL-193 Noindex/privacy defaults
## RL-194 CTA tracking
## RL-195 Audit-view events

---

# EPIC 11 — Hardening

## RL-200 Security review
## RL-201 SSRF penetration tests
## RL-202 OAuth scope review
## RL-203 retention/purge jobs
## RL-204 GDPR/PECR workflow review
## RL-205 Google data-policy review
## RL-206 backup/restore test
## RL-207 load test
## RL-208 queue recovery test
## RL-209 outbound emergency kill switch
## RL-210 incident runbook

---

# Suggested development order

```text
Week/Sprint 1:
Foundation + prospect/campaign core

Sprint 2:
Discovery + canonical resolution

Sprint 3:
Crawler + deterministic evidence

Sprint 4:
Audit UI + scoring

Sprint 5:
Brain + research + drafting

Sprint 6:
Grounding + approval queue

Sprint 7:
Gmail send + scheduler

Sprint 8:
Inbound reply + stop/suppression

Sprint 9:
Pipeline + meeting brief

Sprint 10:
Analytics + agent/job control centre + hardening
```

This is sequencing, not a promise of calendar duration. Actual velocity depends on developer capacity, provider onboarding and QA.

---

# First build slice — recommended

Do not start by building the full dashboard.

Build one end-to-end vertical slice:

```text
1 campaign
→ 1 discovery provider
→ canonical prospect
→ 1 website
→ deterministic audit
→ opportunity score
→ AI research
→ one email draft
→ grounding validation
→ human approval screen
```

Do not integrate live sending until the draft/evidence quality is good.

Then add Gmail.

This gives the fastest route to proving that the system finds genuinely useful sales opportunities.

---

# Definition of V1 Done

V1 is done when Rank Local can operate this loop without spreadsheets:

1. create target campaign;
2. discover and resolve prospects;
3. automatically audit;
4. rank opportunities;
5. inspect evidence;
6. create grounded personalised outreach;
7. approve/send;
8. automatically stop on reply/opt-out;
9. triage reply;
10. create sales opportunity;
11. view meeting brief;
12. track funnel from discovered to meeting/won.

Anything outside that loop is secondary.
