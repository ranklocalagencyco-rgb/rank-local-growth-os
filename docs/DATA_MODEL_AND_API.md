# Rank Local Growth OS — Data Model & API Specification

This document defines the initial logical schema. Exact SQL types/index names can be produced during implementation.

All major tenant-owned tables include `workspace_id`, even though V1 is single-workspace.

---

# 1. Core conventions

Use:

- UUID/ULID primary keys;
- UTC timestamps;
- `created_at`, `updated_at`;
- soft delete only where required;
- immutable event/audit tables;
- JSONB only for provider/raw payloads or genuinely variable structures;
- normalized relational columns for query-critical fields.

Every externally sourced field should be able to answer:

> Where did this value come from, when was it observed, and are we allowed to keep/use it?

---

# 2. Workspace/auth

## workspaces

```text
id
name
slug
timezone
country_code
send_mode
created_at
updated_at
```

## workspace_users

```text
workspace_id
user_id
role
status
created_at
```

## integrations

```text
id
workspace_id
provider
status
scopes
encrypted_credentials_ref
connected_by
connected_at
last_health_at
metadata
```

---

# 3. Campaigns

## campaigns

```text
id
workspace_id
name
status
country_code
target_categories[]
target_locations[]
website_filter
minimum_score
entity_policy
daily_candidate_cap
daily_send_cap
mailbox_id
sequence_id
approval_mode
settings_json
created_by
created_at
updated_at
```

## campaign_runs

```text
id
campaign_id
status
started_at
finished_at
cursor_json
candidates_seen
prospects_created
qualified_count
error_summary
```

---

# 4. Prospect identity

## prospects

```text
id
workspace_id
display_name
normalized_name
canonical_domain
primary_phone
primary_email
company_number
entity_type
entity_confidence
country_code
region
city
postcode
status
pipeline_stage
owner_user_id
current_opportunity_score
current_score_version
recommended_offer_id
created_at
updated_at
```

Do not treat every discovery-provider field as durable CRM data. Canonical fields should be backed by allowed source records.

## prospect_source_refs

```text
id
prospect_id
provider
external_id
source_url
first_seen_at
last_seen_at
retention_class
metadata
unique(provider, external_id)
```

Examples:
- Google place ID;
- Companies House number;
- enrichment-provider ID.

## prospect_field_evidence

Useful for canonical field provenance.

```text
id
prospect_id
field_name
value_hash
display_value
source_type
source_ref_id
observed_at
confidence
retention_class
is_current
```

---

# 5. Discovery candidates

Keep discovery candidate lifecycle separate from canonical prospects.

## discovery_candidates

```text
id
workspace_id
campaign_id
provider
provider_ref
status
candidate_name
candidate_location
candidate_website_state
candidate_summary_json
first_seen_at
expires_at
resolution_status
resolved_prospect_id
```

Provider content subject to short-lived storage restrictions should expire/purge according to policy.

`provider` is `dataforseo` (primary; Google Maps SERP via DataForSEO) or `google_places` (optional fallback). `provider_ref` is the Google place ID in both cases (DataForSEO falls back to `cid:<id>`). DataForSEO candidates arrive with website/phone in the search result, so `candidate_summary_json` is already enriched and carries `rank`, `rating` and `coordinates` alongside the identity fields until purge.

## campaign_runs (discovery fields)

```text
provider            dataforseo | google_places
provider_mode       standard | priority | live (DataForSEO execution mode), null for Google
provider_requests   billable provider requests made by the run (free task retrievals excluded)
provider_cost_usd   sum of provider-reported task cost
cursor_json         { unitIndex, pageToken, pagesFetched, pendingTask?: { taskRef, postedAt, polls } }
```

`pendingTask` holds a queued DataForSEO task (standard/priority mode) between job invocations; it is cleared once the result is retrieved.

## local_rank_observations

Where a listing ranked in the provider's local results for one campaign search unit. Our own measurement: retained, not purged with candidate content, linked to the prospect after resolution. Intended for a later local-SERP-visibility intelligence job; not used by the Opportunity Score yet.

```text
id
workspace_id
campaign_id
campaign_run_id
candidate_id
prospect_id            (set when the candidate resolves)
provider
provider_ref
search_category
search_location
country_code
rank_position          (organic position among local listings, 1-based)
rank_absolute          (position including ads, nullable)
rating                 (listing rating value, nullable)
review_count           (nullable)
observed_at
unique (campaign_run_id, provider, provider_ref, search_category, search_location)
```


## website_audit_runs / website_audit_pages / website_audit_findings (implemented, migrations 006–007)

The first audit slice implements the crawl/evidence layer with these three tables (the logical `crawl_runs` / `evidence_items` / `audits` split above remains the target for scoring and AI layers):

```text
website_audit_runs      id, workspace_id, prospect_id, job_id, requested_by, status (queued|running|completed|failed),
                        website_url, canonical_domain, crawler_version, rules_version, started_at, completed_at, failed_at,
                        pages_attempted, pages_succeeded, pages_failed, error_summary, site_summary_json, crawl_state_json,
                        retention_class (audit_evidence)
                        unique partial index on (prospect_id) where status in ('queued','running')
website_audit_pages     one row per fetched URL: requested_url, final_url, path, discovered_via (homepage|sitemap|link),
                        discovered_from, page_role, fetch_ok, fetch_error, http_status, content_type, redirect_count,
                        response_ms, response_bytes, title, meta_description, h1_count, h1_text[], h2_count, canonical_url,
                        meta_robots, noindex, nofollow, lang, has_viewport, word_count, internal/external/tel/mailto link counts,
                        form_count, cta_count, json_ld_count, schema_types[], has_structured_data, evidence_json, fetched_at
                        unique (audit_run_id, requested_url); no HTML stored
website_audit_findings  scope (site|page), page_id, code, severity (info|low|medium|high), evidence_json, rule_version
```

`page_role` values: `homepage`, `service`, `location`, `about`, `contact`, `testimonials`, `gallery`, `blog`, `other` (migration 007 added `gallery` and `blog`).

`evidence_json` (page) — v1/v2 keys: `redirectChain`, `externalHosts`, `ctaSamples`, `jsonLdParseErrors`, `hasLocalBusinessSchema`, `canonicalMatchesFinal`, `renderingMode`, `renderingSignals`. `audit-crawler/v3` adds optional keys: `evidenceVersion` (3), `crawlerVersion`, `meaningfulRedirect`, `roleSignals[]`, `locality`, `service`, `headingPattern`, `titleLength`, `metaDescriptionLength`, `h1EmptyCount`, `h2Text[]`, `breadcrumbNames[]`, `links[] {url, text, region, group}`, `linksTruncated`, `socialProfileLinks[]`, `nap {phones, emails, postcodes, addressCandidates, businessNames, hasContactForm}`, `schema {localBusiness, organization, aggregateRating, reviewCount, hasService, breadcrumbNames}`, `headingFingerprint`.

`site_summary_json` (run) — v1/v2 keys unchanged; v3 adds optional `evidenceVersion`, `galleryPagesFound`, `blogPagesFound`, `locationPages[]`, `servicePages[]`, `serviceLocationCombos[]`, `nap`, `schema`, `duplicateTitleGroups[]`, `duplicateMetaGroups[]`, `duplicateTitleMetaPairs[]`, `homepageLinkCount`, `pagesWithoutInboundLinks[]`, `internalRedirects[]`, `linksTruncatedOnAnyPage`. Full shapes, thresholds and the finding catalogue: `docs/AUDIT_RULES.md`.

Events: `audit.requested`, `audit.completed`, `audit.failed`. Job type: `audit.run` with idempotency key `audit.run:<runId>`.

---

# 6. Contacts

## prospect_contacts

```text
id
prospect_id
full_name
job_title
email
phone
contact_type
source_type
source_ref
business_capacity
verification_status
confidence
obtained_at
privacy_notice_due_at
privacy_notice_status
is_primary
created_at
updated_at
```

Avoid collecting unnecessary personal information.

---

# 7. Compliance

## compliance_profiles

```text
id
prospect_id
entity_type
entity_source
entity_confidence
electronic_mail_policy
policy_reason_code
lawful_basis_note
privacy_notice_version
privacy_notice_status
last_reviewed_at
reviewed_by
```

## suppressions

```text
id
workspace_id
scope
email_hash
domain_hash
phone_hash
prospect_id nullable
reason
source
created_at
created_by
```

`scope` may be:
- contact;
- prospect;
- domain;
- global identity.

## compliance_events

Immutable.

```text
id
workspace_id
prospect_id
contact_id
event_type
policy_version
details_json
created_at
actor_type
actor_id
```

---

# 8. Crawl/audit

## crawl_runs

```text
id
prospect_id
root_url
audit_version
status
started_at
finished_at
page_count
failure_code
artifact_prefix
```

## crawl_pages

```text
id
crawl_run_id
url
normalized_url
status_code
content_type
title
meta_description
canonical_url
robots_meta
h1_count
word_count
rendered
fetch_ms
content_hash
observed_at
```

Large HTML/screenshot payloads should live in object storage, not hot relational rows.

## evidence_items

Central grounding table.

```text
id
prospect_id
audit_id
category
key
value_type
numeric_value
text_value
boolean_value
unit
severity
confidence
source_type
source_locator
observed_at
expires_at nullable
metadata
```

Examples:

```text
category=performance
key=lcp_mobile
numeric_value=5.4
unit=seconds
source_type=pagespeed
```

## audits

```text
id
prospect_id
audit_version
status
started_at
finished_at
website_url
overall_digital_score
summary_status
created_at
```

## audit_findings

```text
id
audit_id
finding_code
category
title
description
severity
confidence
recommended_action
commercial_relevance
created_at
```

## finding_evidence

```text
finding_id
evidence_item_id
```

---

# 9. Scores

## opportunity_scores

```text
id
prospect_id
score_version
total_score
commercial_strength
digital_gap
reachability
service_fit
timing
explanation_json
created_at
```

## score_evidence

```text
score_id
evidence_item_id
weight
contribution
rule_code
```

---

# 10. Rank Local Brain

## knowledge_documents

```text
id
workspace_id
collection
title
body_markdown
version
status
tags[]
valid_from
valid_until
created_by
created_at
updated_at
```

## knowledge_chunks

Optional retrieval index:

```text
id
document_id
chunk_index
content
embedding
metadata
```

---

# 11. Research

## prospect_research

```text
id
prospect_id
research_version
summary
business_strength_summary
digital_gap_summary
recommended_angle
recommended_offer_id
warnings[]
model
prompt_version
created_at
```

## research_evidence

```text
research_id
evidence_item_id
```

---

# 12. Offers

## offers

```text
id
workspace_id
name
status
description
price_guidance
eligibility_rules_json
created_at
updated_at
```

---

# 13. Sequences/outreach

## sequences

```text
id
workspace_id
name
status
created_at
updated_at
```

## sequence_steps

```text
id
sequence_id
step_number
delay_after_previous_minutes
purpose
template_policy
requires_approval
created_at
```

## prospect_sequences

```text
id
prospect_id
campaign_id
sequence_id
status
current_step
next_action_at
started_at
stopped_at
stop_reason
```

## outbound_drafts

```text
id
prospect_id
prospect_sequence_id
sequence_step_id
mailbox_id
subject
body_text
body_html
sales_angle
status
model
prompt_version
validation_status
validation_errors[]
created_at
updated_at
approved_by
approved_at
```

## draft_evidence

```text
draft_id
evidence_item_id
claim_key
```

## messages

Normalized communication log.

```text
id
workspace_id
prospect_id
contact_id
mailbox_id
direction
provider
provider_message_id
provider_thread_id
subject
body_text_ref
sent_at
received_at
message_type
status
created_at
```

Bodies can be stored according to retention/security policy.

---

# 14. Reply intelligence

## reply_classifications

```text
id
message_id
intent
confidence
requires_human
recommended_next_action
reason_summary
model
prompt_version
created_at
corrected_intent nullable
corrected_by nullable
```

---

# 15. Pipeline/sales

## opportunities

```text
id
workspace_id
prospect_id
owner_user_id
stage
estimated_value
currency
recommended_offer_id
source_campaign_id
created_at
updated_at
won_at
lost_at
loss_reason
```

## meetings

```text
id
opportunity_id
prospect_id
start_at
end_at
timezone
provider_event_id
status
meeting_url
notes
created_at
updated_at
```

## call_briefs

```text
id
meeting_id
prospect_id
summary
top_findings_json
questions_json
objections_json
recommended_offer
model
prompt_version
created_at
```

## call_notes

```text
id
meeting_id
author_user_id
notes
transcript_ref
created_at
```

## proposal_inputs

```text
id
opportunity_id
problem_summary_json
goals_json
scope_json
commercial_notes_json
timeline_notes_json
risks_json
next_step
created_at
```

---

# 16. Activities/events

## activity_events

Immutable user-facing timeline.

```text
id
workspace_id
prospect_id
campaign_id nullable
event_type
actor_type
actor_id
summary
metadata
created_at
```

## domain_events

For async processing/outbox pattern.

```text
id
workspace_id
aggregate_type
aggregate_id
event_type
payload
occurred_at
published_at
attempts
```

Use a transactional outbox so DB changes and queued work do not drift apart.

---

# 17. Jobs/observability

## workflow_runs

```text
id
workspace_id
workflow_type
entity_type
entity_id
status
attempt
input_hash
output_hash
provider
started_at
finished_at
error_code
error_message_safe
usage_json
cost_estimate
trace_id
```

---

# 18. API design

Prefer server actions/internal BFF for first-party UI where suitable, but preserve domain endpoints/services.

Illustrative REST-style contract:

## Campaigns

```text
POST   /api/campaigns
GET    /api/campaigns
GET    /api/campaigns/:id
PATCH  /api/campaigns/:id
POST   /api/campaigns/:id/run
POST   /api/campaigns/:id/pause
```

## Prospects

```text
GET    /api/prospects
GET    /api/prospects/:id
PATCH  /api/prospects/:id
POST   /api/prospects/:id/qualify
POST   /api/prospects/:id/audit
POST   /api/prospects/:id/research
POST   /api/prospects/:id/score
```

## Audits

```text
GET    /api/audits/:id
POST   /api/audits/:id/retry
GET    /api/prospects/:id/audits
```

## Outreach

```text
POST   /api/prospects/:id/drafts
PATCH  /api/drafts/:id
POST   /api/drafts/:id/approve
POST   /api/drafts/:id/reject
POST   /api/drafts/:id/send
POST   /api/prospect-sequences/:id/stop
```

## Inbox

```text
GET    /api/inbox
GET    /api/threads/:providerThreadId
POST   /api/messages/:id/classify
POST   /api/messages/:id/suggest-reply
```

## Compliance

```text
GET    /api/prospects/:id/compliance
POST   /api/prospects/:id/compliance/review
POST   /api/suppressions
GET    /api/suppressions/check
```

## Sales

```text
POST   /api/opportunities
PATCH  /api/opportunities/:id
POST   /api/meetings
POST   /api/meetings/:id/call-brief
POST   /api/opportunities/:id/proposal-inputs
```

---

# 19. Event catalogue

Core domain events:

```text
campaign.created
campaign.run_requested
candidate.discovered
candidate.resolution_requested
prospect.created
prospect.updated
prospect.suppressed
prospect.qualified
audit.requested
audit.completed
audit.failed
score.completed
research.requested
research.completed
draft.requested
draft.created
draft.approved
message.send_requested
message.sent
message.send_failed
reply.received
reply.classified
sequence.stopped
meeting.created
opportunity.created
opportunity.won
opportunity.lost
```

Handlers must be idempotent.

---

# 20. Indexes

At minimum:

```text
prospects(workspace_id, status)
prospects(workspace_id, pipeline_stage)
prospects(workspace_id, current_opportunity_score desc)
prospects(canonical_domain)
prospects(company_number)
prospect_source_refs(provider, external_id)
campaigns(workspace_id, status)
discovery_candidates(campaign_id, status)
evidence_items(prospect_id, category, key)
audits(prospect_id, created_at desc)
messages(provider, provider_message_id)
messages(prospect_id, sent_at/received_at)
suppressions(workspace_id, email_hash)
prospect_sequences(next_action_at, status)
workflow_runs(status, workflow_type, started_at)
```

---

# 21. Retention classes

Every source/integration should map fields into a retention class:

```text
canonical_business_data
temporary_discovery_data
personal_contact_data
provider_restricted_data
audit_evidence
communication_record
suppression_record
operational_log
```

Retention behavior is configuration/policy driven.

This is essential for a system combining Google-origin content, public web content, contact data and email.
