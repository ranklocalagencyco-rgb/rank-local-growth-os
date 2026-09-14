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

## RL-031 Google Places discovery adapter
- Text Search/field-mask support;
- provider attribution/policy notes;
- retain place ID correctly;
- candidate TTL/purge.

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

## RL-051 Crawl scheduler
## RL-052 HTML metadata parser
## RL-053 Heading/content parser
## RL-054 robots/sitemap parser
## RL-055 internal-link graph
## RL-056 structured-data parser
## RL-057 CTA/contact detector
## RL-058 PageSpeed adapter
## RL-059 optional CrUX adapter
## RL-060 rendered screenshot worker
## RL-061 evidence-item writer
## RL-062 finding rules engine
## RL-063 audit summary UI
## RL-064 evidence inspector
## RL-065 audit retry/failure UI

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
## RL-071 Score versioning
## RL-072 Score explanation UI
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
