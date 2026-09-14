# Rank Local Growth OS — Master Build Specification

**Status:** Product blueprint / source of truth  
**Product owner:** Rank Local  
**Initial market:** UK local-service businesses, especially trades  
**Initial operator:** Internal Rank Local team  
**Future option:** Multi-tenant SaaS for agencies and consultants

---

# 1. Product thesis

Rank Local currently needs a repeatable acquisition channel that is not dependent on referrals.

The system should transform local-business discovery into qualified sales conversations without becoming a generic bulk cold-email platform.

The core loop is:

```text
CAMPAIGN
  ↓
DISCOVERY
  ↓
QUALIFICATION
  ↓
DETERMINISTIC AUDIT
  ↓
OPPORTUNITY SCORE
  ↓
PROSPECT RESEARCH
  ↓
PERSONALISED MESSAGE
  ↓
HUMAN APPROVAL / SEND
  ↓
FOLLOW-UP
  ↓
REPLY CLASSIFICATION
  ↓
MEETING
  ↓
CALL PREP
  ↓
OPPORTUNITY / PROPOSAL
```

The product should feel like an "AI growth department", but internally it must be a reliable event-driven application with explicit data contracts.

---

# 2. Product principles

## 2.1 Deterministic before generative

Use software to establish facts.

Examples:

- HTTP status is measured.
- page title is parsed.
- H1 count is parsed.
- LocalBusiness schema is parsed.
- mobile performance comes from a measurement source.
- website presence/absence comes from a compliant discovery workflow.
- company legal status comes from an authoritative or licensed source where possible.

Use AI to:

- prioritise;
- interpret evidence;
- select sales angles;
- summarise;
- classify replies;
- draft copy;
- prepare calls.

The model must not invent audit findings.

## 2.2 Evidence-led outbound

Every claim in an email must link internally to an `evidence_item`.

Example:

```text
Claim:
"Your mobile homepage is taking more than five seconds to become usable."

Evidence:
source = pagespeed
metric = LCP
value = 5.4
captured_at = timestamp
target_url = https://...
```

## 2.3 Operator control first

V1 defaults to:

```text
AI DRAFTS
→ HUMAN APPROVES
→ SYSTEM SENDS
```

Autonomous sending is an optional policy later, not the default.

## 2.4 Narrow ICP first

V1 targets Rank Local's strongest existing niche: UK trades/local services.

Suggested initial categories:

- roofing;
- plumbing/heating;
- electricians;
- builders;
- landscaping;
- plastering;
- painting/decorating;
- waste clearance;
- driveways/paving;
- kitchens/bathrooms;
- windows/doors;
- drainage.

## 2.5 No fake precision

An opportunity score is an internal prioritisation tool, not a promise of revenue.

## 2.6 Suppression is permanent by default

Any clear opt-out creates a suppression record checked before all future outbound.

---

# 3. Goals and non-goals

## 3.1 V1 goals

V1 must let one operator:

1. create a prospecting campaign by service/category and geography;
2. discover candidate businesses;
3. deduplicate candidates;
4. establish persistent prospect records from compliant sources;
5. classify company/entity type sufficiently for outreach policy;
6. locate website/contact channels where permitted;
7. audit websites deterministically;
8. score commercial fit and digital opportunity;
9. generate an evidence-backed prospect brief;
10. draft personalised first-touch and follow-up emails;
11. approve/edit/reject drafts;
12. send through an authenticated mailbox;
13. sync and classify replies;
14. automatically stop sequences on replies/opt-outs;
15. surface interested leads and book/record meetings;
16. generate a pre-call intelligence brief;
17. show funnel analytics and operational health.

## 3.2 Explicit non-goals for V1

Do not build:

- 137 generic chat agents;
- social media management;
- client SEO fulfilment;
- invoicing/accounting;
- project management;
- employee HR;
- a consumer data broker;
- unrestricted Google Maps scraping;
- fully autonomous negotiation;
- automatic proposal pricing without approval;
- multi-tenant public SaaS billing.

---

# 4. V1 success criteria

The first meaningful milestone is not "app completed". It is:

> Rank Local can create a campaign, discover 100 businesses, identify the best 20, produce defensible audits, approve personalised outreach, send it, and correctly process replies without using external spreadsheets.

Track:

- discovered prospects;
- qualified prospects;
- audits completed;
- audit failure rate;
- average opportunity score;
- drafts generated;
- drafts approved;
- sent;
- delivery failures;
- replies;
- positive replies;
- opt-outs;
- meetings booked;
- opportunities created;
- deals won;
- revenue attributed;
- time saved per qualified lead.

Initial operational targets should be measured rather than guessed. The first 200–500 manually reviewed outbound messages should establish baseline rates.

---

# 5. User roles

## Owner/Admin

Can:

- configure workspace;
- connect mailboxes;
- edit services/offers;
- edit scoring;
- manage compliance policies;
- manage suppression;
- view all prospects/campaigns;
- approve outbound;
- manage integrations.

## Sales Operator

Can:

- create campaigns;
- review leads;
- approve/edit drafts;
- work replies;
- update pipeline;
- create notes/tasks.

## Read-only Analyst

Later role:

- dashboards;
- reports;
- no sends/mutations.

---

# 6. Core navigation

```text
Overview
Opportunities
Campaigns
Prospects
Audits
Outreach
Inbox
Pipeline
Meetings
Brain
Agents & Jobs
Analytics
Suppression
Settings
```

---

# 7. Key UX screens

## 7.1 Overview / Growth Command Centre

Cards:

- new prospects today;
- qualified today;
- high-opportunity;
- audits waiting;
- drafts waiting approval;
- follow-ups due;
- replies;
- positive replies;
- meetings;
- current pipeline value.

Primary panel:

`Today's Best Opportunities`

Columns:

- prospect;
- category;
- location;
- reviews/business-strength signal;
- website state;
- opportunity score;
- recommended offer;
- status;
- action.

Secondary panel:

`Needs Attention`

Examples:

- audit failed;
- mailbox disconnected;
- rate limit;
- entity type unknown;
- reply needs human;
- suppression conflict;
- enrichment failed.

## 7.2 Campaign Builder

Fields:

- campaign name;
- country;
- regions/towns/postcodes;
- category/trade;
- radius/territory rules;
- minimum business-strength threshold;
- website filters:
  - no website;
  - any website;
  - website exists and score below X;
- rating/review filters where source usage permits;
- corporate-only / review-required mode;
- daily qualification cap;
- outreach sequence;
- connected mailbox;
- approval mode.

Campaign preview should show estimated search jobs, not fabricate lead counts.

## 7.3 Prospect Record

Tabs:

### Summary
- business identity;
- source references;
- entity status;
- location;
- contact channels;
- pipeline status;
- opportunity score;
- recommended angle.

### Evidence
Raw evidence grouped by:

- website;
- technical;
- local presence;
- company/entity;
- content;
- contact;
- competitor context.

### Audit
Structured findings with severity and source.

### Research
AI synthesis based only on approved evidence.

### Outreach
Drafts, sent messages, follow-ups, reply thread.

### Activity
Immutable event timeline.

### Compliance
- source;
- lawful-processing note;
- entity classification;
- privacy-notice status;
- suppression;
- opt-out;
- manual review.

## 7.4 Audit Viewer

Sections:

- executive summary;
- website fundamentals;
- mobile/performance;
- SEO foundation;
- local SEO;
- conversion;
- content/trust;
- accessibility/best practice;
- AEO/GEO readiness;
- highest-value fixes.

Every finding displays:

- finding;
- severity;
- confidence;
- evidence source;
- observed value;
- captured time.

## 7.5 Outreach Approval Queue

Each card contains:

- prospect;
- why selected;
- recommended angle;
- subject;
- email body;
- evidence used;
- warnings;
- approve;
- edit;
- reject;
- regenerate with reason.

Bulk approval should be disabled until the system has a proven quality baseline.

## 7.6 Inbox

Classification:

- positive;
- question;
- price request;
- timing/later;
- already has supplier;
- referral;
- not interested;
- unsubscribe;
- bounce/system;
- ambiguous.

Show:

- source thread;
- AI classification;
- confidence;
- suggested response;
- next action.

## 7.7 Agent & Job Map

Visual inspiration can follow the "company brain with departments" concept, but nodes represent actual workflows.

Departments:

- Discovery;
- Intelligence;
- Outreach;
- Sales;
- Compliance;
- Operations.

Node details:

- status;
- run count;
- success/failure;
- queue;
- average latency;
- cost estimate;
- latest error;
- last job;
- retry action.

This is an observability surface, not decorative agent theatre.

---

# 8. System architecture

```text
┌─────────────────────────────────────────────┐
│               NEXT.JS WEB APP               │
│ UI • API/BFF • Auth • Operator Actions      │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│                POSTGRES                     │
│ CRM • Evidence • Audits • Outreach • Events │
└───────────────────┬─────────────────────────┘
                    │
            domain events / jobs
                    │
                    ▼
┌─────────────────────────────────────────────┐
│          DURABLE WORKFLOW / JOB LAYER       │
│ Trigger.dev / workers                       │
├──────────────┬──────────────┬───────────────┤
│ Discovery    │ Audit        │ Outreach      │
│ Enrichment   │ AI Synthesis │ Reply Sync    │
└──────┬───────┴──────┬───────┴──────┬────────┘
       │              │              │
       ▼              ▼              ▼
 External APIs   Web/Crawl APIs   Gmail/Email
```

## 8.1 Why background jobs are mandatory

Do not perform long audits or research inside synchronous web requests.

All expensive work should be:

- idempotent;
- retryable;
- observable;
- rate-limited;
- cancellable where practical.

---

# 9. Discovery architecture

## 9.1 Critical Google Places constraint

Treat Google Places as a discovery/reference system, not automatically as a permanent CRM data warehouse.

Google's Places policies restrict caching/storage of Places content with specific exceptions such as place IDs. Therefore:

1. store Google `place_id` as a durable source reference where permitted;
2. do not assume all returned Places fields can be persisted indefinitely;
3. establish canonical CRM fields from:
   - the business's own website;
   - Companies House;
   - licensed enrichment/data providers;
   - direct operator input;
   - other sources with suitable terms;
4. retain source provenance per field;
5. display required Google attribution when displaying Google-derived content;
6. review final implementation against current Google Maps Platform terms before production.

This architecture avoids building the CRM on data that the application may not be entitled to store permanently.

## 9.2 Discovery strategies

### Strategy A — No website attached
Find local businesses where current discovery data indicates no website URI.

Then:

- create candidate record;
- perform entity resolution;
- search for an official website independently;
- only label `verified_no_website` after secondary verification.

### Strategy B — Weak website
Find business → obtain official URL → audit → select if score below threshold.

### Strategy C — Reputation/digital mismatch
High business-strength signals plus low digital maturity.

### Strategy D — Territory sweep
Trade + town/postcode grid, deduplicated by canonical entity/source IDs.

---

# 10. Entity resolution

A prospect may appear multiple times or across multiple providers.

Entity resolver uses weighted identifiers:

1. canonical company number;
2. normalized domain;
3. normalized phone;
4. address;
5. source place ID;
6. normalized business name + locality.

Never merge solely because names are similar.

Ambiguous merges enter a human-review queue.

---

# 11. Audit engine

The audit engine produces facts, findings and evidence.

## 11.1 Crawl safety

Crawler must:

- respect configured request limits;
- identify itself appropriately;
- avoid authenticated/private areas;
- avoid form submission;
- not bypass access controls;
- cap pages per site;
- handle robots policy according to product policy/legal review;
- timeout gracefully;
- record redirect chains.

## 11.2 V1 page selection

Audit:

- homepage;
- contact page;
- primary service pages;
- about page;
- up to N discovered local/service pages.

Cap V1 around 10–20 pages/site.

## 11.3 Deterministic checks

### Availability/security
- URL reachable;
- HTTPS;
- redirect consistency;
- broken internal links;
- mixed-content indicators.

### Metadata
- title present/length;
- meta description;
- canonical;
- robots meta;
- lang;
- favicon.

### Semantic structure
- H1 count;
- heading hierarchy;
- address/contact signals;
- phone CTA;
- contact CTA.

### Indexability
- robots.txt;
- sitemap;
- canonical conflicts;
- noindex;
- status codes.

### Structured data
Parse schema types:

- LocalBusiness;
- Organization;
- Service;
- FAQPage where applicable;
- BreadcrumbList;
- Review/AggregateRating where present.

Validate presence/shape; do not claim Google eligibility solely from presence.

### Performance
Use PageSpeed/Lighthouse-derived lab results plus CrUX API when field data is needed and available.

Store:

- performance score;
- LCP;
- CLS;
- INP when source provides it;
- FCP;
- TBT/lab diagnostics;
- mobile/desktop strategy;
- source timestamp.

### Local SEO
Deterministic signals:

- clear service area/location;
- NAP presence;
- embedded map/contact location;
- unique service/location pages;
- internal links;
- title/locality usage;
- local schema.

### Conversion
Some checks can be deterministic:
- phone link on mobile;
- contact link;
- CTA count;
- CTA above first viewport (requires rendered-page logic);
- forms;
- trust/review blocks;
- visible business identity.

AI may interpret these, but evidence comes from rendered DOM/screenshot/HTML.

### AEO/GEO
Avoid fake "AI ranking scores".

V1 checks supporting fundamentals:
- clear service explanations;
- question/answer structures;
- entity clarity;
- structured data;
- author/business identity;
- citations/proof;
- crawlability;
- unique factual content.

Label this section `AI Search Readiness`, not "ChatGPT ranking".

---

# 12. Opportunity scoring

Score is configurable and versioned.

## 12.1 Suggested 100-point V1 framework

### Commercial strength — 25
Signals may include:
- active/established company;
- reputation volume/quality;
- service category value;
- trading footprint.

### Digital gap — 35
- verified no website;
- severe website quality issues;
- poor mobile performance;
- missing conversion fundamentals;
- weak local architecture.

### Reachability — 15
- compliant contact route;
- verified email;
- phone;
- named company contact where lawfully sourced.

### Rank Local service fit — 15
- maps to available offer;
- geography;
- project size likelihood;
- category fit.

### Timing/signals — 10
- recent business activity;
- current site problem;
- fresh listing/review activity;
- other non-sensitive, lawful signals.

## 12.2 Scoring rules

- every subscore has evidence;
- score version stored;
- human may override with reason;
- AI cannot directly mutate raw score without structured rule output;
- do not use protected/sensitive personal traits;
- score business opportunity, not personal vulnerability.

---

# 13. Rank Local Brain

The Brain is structured knowledge, not just vector search.

Collections:

```text
offers
services
pricing_guidance
ideal_customer_profiles
disqualifiers
territories
case_studies
portfolio
brand_voice
email_rules
sales_playbook
objections
discovery_questions
proposal_rules
seo_methodology
web_methodology
local_seo_methodology
aeo_geo_methodology
compliance_policies
```

Each document has:

- version;
- active flag;
- valid_from;
- valid_until optional;
- owner;
- tags;
- source.

Retrieval must include the version IDs used in generated output so messages can be reproduced.

---

# 14. Outreach engine

## 14.1 Send states

```text
draft
needs_review
approved
scheduled
sending
sent
delivered_unknown
bounced
replied
stopped
suppressed
failed
```

## 14.2 Default sequence

Do not hard-code marketing folklore. Make cadence configurable.

Example initial test sequence:

- touch 1: evidence-led observation;
- touch 2: concise audit link/summary;
- touch 3: alternate commercial angle;
- touch 4: polite close-the-loop.

Keep volume conservative while domain/mailbox reputation and copy quality are established.

## 14.3 Stop conditions

Immediately stop future sends when:

- reply detected;
- unsubscribe/objection detected;
- hard bounce;
- prospect suppressed;
- manual stop;
- legal/entity policy changes to blocked;
- mailbox/account issue.

## 14.4 Draft policy

Outbound generator receives:

- approved prospect facts;
- approved audit findings;
- service fit;
- brand voice;
- sequence step;
- prior thread;
- prohibited claims.

It must return:

- subject;
- plain text;
- optional HTML;
- evidence IDs used;
- sales angle;
- confidence;
- warnings.

Draft fails validation if it contains unsupported quantified claims.

---

# 15. UK outreach compliance architecture

This is product architecture, not legal advice. Obtain professional review before scaling.

## 15.1 Entity classification

PECR treatment differs between corporate subscribers and individual subscribers such as sole traders and certain partnerships.

The system therefore needs:

```text
entity_type:
  limited_company
  llp
  scottish_partnership
  sole_trader
  unincorporated_partnership
  public_body
  unknown
```

And:

```text
outreach_policy:
  allowed
  blocked
  manual_review
  consent_required
```

V1 conservative default:

- `limited_company` / clear corporate body: eligible for configured B2B workflow subject to data-protection obligations;
- sole trader/individual subscriber: block cold electronic-mail automation unless an approved legal basis/consent policy says otherwise;
- unknown: manual review.

## 15.2 Transparency

For personal business-contact data obtained indirectly, the system must support privacy-information obligations and record:

- date obtained;
- source;
- privacy notice version;
- notification deadline/status;
- first-contact timestamp.

## 15.3 Objection/suppression

Any objection:

- stop marketing;
- create suppression identity hashes/keys sufficient to avoid re-import;
- preserve only what is necessary for suppression and legal records;
- propagate suppression checks across all campaigns.

The suppression check occurs:

1. at import;
2. before enrichment;
3. before draft approval;
4. immediately before send.

## 15.4 Audit log

Record:

- who approved;
- what was sent;
- source/evidence;
- policy version;
- entity classification;
- opt-out events;
- suppression decisions.

---

# 16. Email integration

Initial recommendation: authenticated Google Workspace mailbox through Gmail API.

Capabilities:

- create draft;
- send;
- thread mapping;
- sync replies;
- ingest headers/message IDs;
- detect bounces/system replies;
- label or classify where desired.

Do not make the Gmail inbox itself the CRM.

Store normalized communication metadata in the application and retain provider IDs for retrieval.

---

# 17. Reply intelligence

Reply classifier outputs:

```json
{
  "intent": "positive|question|pricing|later|supplier|referral|negative|unsubscribe|system|ambiguous",
  "confidence": 0.0,
  "requires_human": true,
  "recommended_next_action": "...",
  "entities": {},
  "reason_summary": "..."
}
```

Hard rules override AI:

- unsubscribe phrases → suppression workflow;
- bounce → stop;
- legal complaint → stop + escalation;
- ambiguous low confidence → human.

---

# 18. Meeting and sales prep

When a lead is marked interested:

1. freeze current research snapshot;
2. generate pre-call brief;
3. create meeting record;
4. optionally connect calendar later;
5. show agenda and discovery questions;
6. record call notes/transcript if supplied;
7. create opportunity.

Pre-call brief:

- company summary;
- source links;
- audit top findings;
- likely pain/benefit;
- recommended Rank Local service;
- relevant case study;
- questions to validate;
- likely objections;
- prior email thread;
- claims not to make.

---

# 19. Proposal hand-off

V1 does not need a full proposal builder.

Output structured proposal inputs:

```json
{
  "prospect_id": "...",
  "problem_summary": [],
  "agreed_goals": [],
  "scope_recommendation": [],
  "commercial_notes": [],
  "timeline_notes": [],
  "risks": [],
  "next_step": ""
}
```

A later module can populate Better Proposals/Docs/templates.

---

# 20. Public audit pages

Optional V1.1 feature, useful for conversion.

Pattern:

`/audit/{opaque_token}`

Rules:

- unguessable token;
- expiry;
- no indexing by default;
- no sensitive/contact data;
- only approved audit findings;
- clear timestamp;
- CTA to book/reply;
- view analytics.

Do not expose internal score weights or enrichment data.

---

# 21. Analytics

## Funnel

```text
Discovered
→ Resolved
→ Qualified
→ Audited
→ Outreach-ready
→ Sent
→ Replied
→ Positive
→ Meeting
→ Opportunity
→ Won
```

Metrics by:

- campaign;
- category;
- geography;
- mailbox;
- sequence;
- score band;
- sales angle;
- audit issue;
- time period.

## AI quality metrics

- unsupported-claim validator failures;
- draft reject rate;
- edit distance between AI draft and final message;
- reply-classification corrections;
- audit summary corrections;
- per-workflow cost;
- latency;
- model/version.

---

# 22. Observability

Every background run gets:

- job ID;
- workflow type;
- prospect/campaign ID;
- attempt;
- started/finished;
- input checksum;
- output checksum;
- status;
- error class;
- provider;
- token/API usage;
- estimated cost;
- trace ID.

Operator UI must surface failed jobs with safe retry.

---

# 23. AI model strategy

Use the OpenAI Responses API/tool calling architecture rather than inventing an "agent framework" prematurely.

Have thin domain-specific AI services:

- `synthesiseProspectResearch`
- `selectSalesAngle`
- `draftOutbound`
- `classifyReply`
- `draftReply`
- `prepareCallBrief`
- `summariseCall`
- `recommendProposalInputs`

Each receives structured input and emits schema-validated output.

No AI service gets unrestricted database access.

---

# 24. AI safety/quality guardrails

Before accepting model output:

1. JSON/schema validate.
2. Validate referenced evidence IDs.
3. Validate all numbers against source evidence.
4. Reject prohibited claim patterns.
5. Check suppression/outreach policy.
6. Store model/version/prompt version.
7. If confidence below threshold, require human.

Prohibited behavior:

- inventing rankings;
- claiming revenue loss without defensible model;
- claiming a site is penalised by Google;
- asserting competitor revenue;
- falsely implying a prior relationship;
- pretending a human manually inspected something if they did not;
- fake scarcity;
- fake customer testimonials.

---

# 25. Security

## Secrets
All API keys server-side.

Use:

- provider secret manager/environment secrets;
- OAuth token encryption at rest;
- token rotation;
- least-privilege scopes.

## Auth
- secure session/auth provider;
- MFA for admin strongly recommended;
- role-based permissions.

## Data
- Postgres row-level protections as appropriate;
- encrypted transport;
- backups;
- retention policy;
- deletion/export tooling.

## SSRF protection
Website auditing is a high-risk URL-fetch surface.

Crawler must block:

- localhost;
- private RFC1918 ranges;
- link-local;
- cloud metadata endpoints;
- non-http(s) schemes;
- redirects into blocked networks.

DNS rebinding protections are required.

---

# 26. Reliability

All workflows should be idempotent.

Examples:

- sending uses idempotency lock to prevent duplicate message;
- audit keyed by prospect + URL + audit version + time window;
- suppression mutation is monotonic;
- campaign discovery has source cursor/state;
- retry does not duplicate CRM records.

Dead-letter failed jobs after bounded retries.

---

# 27. Performance strategy

UI should remain fast even when background pipelines are busy.

- paginate prospect lists;
- precompute dashboard aggregates;
- index status/campaign/score fields;
- separate raw audit payload storage where large;
- use object storage for screenshots/artifacts;
- avoid rendering raw crawl documents in lists.

---

# 28. Recommended repository structure

```text
/apps
  /web
/packages
  /db
  /domain
  /ui
  /ai
  /crawler
  /audit
  /email
  /integrations
  /compliance
  /observability
  /schemas
  /config
/workers
  /discovery
  /audit
  /enrichment
  /outreach
  /inbox
/docs
  architecture.md
  data-sources.md
  compliance.md
  scoring.md
  runbooks.md
```

Use a monorepo only if it improves shared schemas/types; do not create service sprawl.

---

# 29. Environments

```text
local
staging
production
```

Separate:

- database;
- OAuth credentials;
- API keys;
- email mailboxes;
- Google projects if practical;
- webhook endpoints.

Staging must never send real prospect email by accident.

Add a `SEND_MODE=disabled|sandbox|live` control.

---

# 30. Testing strategy

## Unit tests
- scoring;
- normalization;
- dedupe;
- compliance decisions;
- suppression;
- evidence validators;
- parser logic.

## Integration tests
- provider clients mocked/recorded;
- crawl pipeline;
- Gmail thread ingest;
- audit persistence;
- outbound state machine.

## End-to-end
Golden flow:

```text
campaign
→ candidate
→ prospect
→ audit
→ score
→ draft
→ approve
→ send sandbox
→ ingest reply
→ classify
→ stop sequence
→ create meeting
```

## AI evaluations
Create frozen fixtures for:

- 50 websites;
- 100 research records;
- 100 outbound drafts;
- 100 reply types.

Score:

- factuality;
- supported claims;
- tone;
- classification accuracy;
- false-positive opt-out rate;
- unsafe/autonomous action rate.

Do not rely on anecdotal prompt testing.

---

# 31. Cost controls

Every campaign has optional budgets:

- max discovery requests;
- max audits/day;
- max enrichment spend;
- max AI spend;
- max sends/day.

Global circuit breakers:

- provider errors;
- abnormal bounce rate;
- abnormal opt-out rate;
- AI validation failures;
- mailbox auth issues;
- cost spike.

Dashboard should show estimated spend per qualified lead.

---

# 32. Delivery phases

## Phase 0 — Foundation
- repo;
- auth;
- DB;
- design shell;
- event/job framework;
- logging;
- feature flags;
- sandbox send mode.

## Phase 1 — CRM + Campaigns
- prospects;
- campaigns;
- source references;
- activity timeline;
- dedupe;
- suppression.

## Phase 2 — Discovery
- territory/category jobs;
- Google reference integration;
- compliant source abstraction;
- entity resolver;
- candidate review.

## Phase 3 — Audit
- safe crawler;
- PageSpeed;
- parsers;
- evidence store;
- findings;
- audit UI.

## Phase 4 — Opportunity Intelligence
- score;
- research synthesis;
- service fit;
- recommended angle;
- opportunity queue.

## Phase 5 — Outreach
- brain;
- templates;
- AI draft;
- evidence validator;
- approval queue;
- Gmail send.

## Phase 6 — Inbox
- reply sync;
- intent classification;
- stop logic;
- suggested replies;
- suppression.

## Phase 7 — Sales
- pipeline;
- meeting;
- pre-call brief;
- notes;
- proposal-input summary.

## Phase 8 — Analytics + Hardening
- funnel;
- cost;
- AI quality;
- job health;
- rate limits;
- load/security tests.

---

# 33. Milestone plan

A realistic first internal product should be built as vertical slices rather than waiting for every feature.

## Milestone A — "Find + Audit"
User can create one campaign and get a ranked list of audited prospects.

## Milestone B — "Audit + Draft"
User can open a prospect and generate a grounded email.

## Milestone C — "Approve + Send"
User can approve and send through a connected mailbox.

## Milestone D — "Reply + Stop"
Replies sync, classify and automatically halt future sequence sends.

## Milestone E — "Meeting + Brief"
Interested prospect becomes a meeting with a pre-call brief.

At Milestone E, the product has a complete revenue loop.

---

# 34. What to postpone until product-market proof

- autonomous bulk sending;
- LinkedIn automation;
- WhatsApp automation;
- voice agents;
- proposal auto-send;
- billing;
- client portal;
- white label;
- multi-tenancy;
- mobile app;
- 100+ agent visualisations;
- automatic website generation.

---

# 35. Future SaaS architecture

Design IDs with `workspace_id` from the beginning, even if only one internal workspace exists.

Future hierarchy:

```text
workspace
  users
  mailboxes
  knowledge
  campaigns
  prospects
  audits
  communications
  opportunities
```

Tenant isolation becomes enforceable without re-keying the database later.

Do not build public billing/tenant admin now.

---

# 36. Reference constraints verified during planning

At planning time:

- Google Places API policies restrict pre-fetching/caching/storage of Places content, with place IDs specifically exempted from caching restrictions. Architecture must respect current terms and attribution requirements.
- Google Text Search supports text-based place discovery and field masks.
- PageSpeed Insights API v5 can provide Lighthouse-derived performance analysis; Google recommends CrUX APIs when field data is required as PSI's inclusion of CrUX data is changing.
- Gmail API supports programmatic draft/send workflows and message/thread handling.
- ICO guidance distinguishes corporate subscribers from sole traders/certain partnerships for PECR electronic-mail rules, and states that direct-marketing objections must be respected.
- Companies House provides a REST API for public company information.
- OpenAI's Responses API supports tool calling and structured application workflows.

Terms and guidance can change. Re-check provider rules and obtain legal review before production scale.

---

# 37. Build decision

The product should **not** begin as an "AI agent platform".

Build it as:

> A local-business opportunity engine with evidence-backed auditing, controlled AI-assisted outreach, and a lightweight sales CRM.

The agent-map interface is added on top of real workflows once the workflows exist.

That is the shortest path from concept to something Rank Local can use to generate revenue.
