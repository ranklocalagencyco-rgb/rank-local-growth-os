# Rank Local Growth OS — Agent & Workflow Specification

The word "agent" is used in the UI, but most units are controlled workflows with narrow permissions.

No workflow receives arbitrary access to every tool.

---

# 1. Department map

```text
RANK LOCAL BRAIN
│
├── DISCOVERY
│   ├── Territory Search
│   ├── Candidate Resolver
│   ├── Entity Resolver
│   └── Qualification
│
├── INTELLIGENCE
│   ├── Website Auditor
│   ├── Local Presence Analyzer
│   ├── Opportunity Scorer
│   ├── Research Synthesizer
│   └── Sales Angle Selector
│
├── OUTREACH
│   ├── Email Drafter
│   ├── Grounding Validator
│   ├── Sequence Scheduler
│   └── Send Controller
│
├── INBOX
│   ├── Reply Classifier
│   ├── Suppression Detector
│   └── Reply Drafter
│
├── SALES
│   ├── Meeting Brief
│   ├── Call Summary
│   └── Proposal Input Builder
│
└── OPERATIONS
    ├── Job Health
    ├── Cost Guard
    └── Provider Health
```

---

# 2. Workflow contract

Every AI workflow must define:

```text
Purpose
Trigger
Required inputs
Allowed tools
Required evidence
Output schema
Validation
Side effects
Human approval
Failure behavior
Metrics
```

---

# 3. Territory Search

**Type:** deterministic/provider workflow  
**Purpose:** discover candidate businesses matching campaign.

Inputs:

```json
{
  "campaign_id": "...",
  "category": "roofer",
  "location": "Uxbridge, UK",
  "search_cursor": null
}
```

Allowed integrations:
- compliant place/business discovery provider.

Output:

```json
{
  "candidates": [
    {
      "provider": "google_places",
      "external_ref": "place-id",
      "display_hint": "business name",
      "website_state_hint": "present|absent|unknown"
    }
  ],
  "next_cursor": null
}
```

Important: provider-returned content must follow provider storage policy. Candidate data may be ephemeral.

Side effects:
- candidate rows;
- event `candidate.discovered`.

---

# 4. Candidate Resolver

**Type:** deterministic + lookup workflow  
**Purpose:** turn discovery reference into a canonical CRM prospect using allowed durable sources.

Process:

1. obtain minimal source reference;
2. search for official site/company identity;
3. normalize domain/phone/name;
4. search Companies House where appropriate;
5. compare existing prospects;
6. create/attach canonical prospect or flag ambiguous.

Output:

```json
{
  "resolution": "created|matched|ambiguous|rejected",
  "prospect_id": "...",
  "confidence": 0.92,
  "matched_identifiers": ["domain", "company_number"],
  "warnings": []
}
```

No LLM may auto-merge ambiguous legal entities.

---

# 5. Qualification Workflow

**Purpose:** decide whether deeper audit spend is justified.

Inputs:
- category;
- geography;
- canonical website state;
- entity policy;
- high-level business-strength signals;
- suppression check.

Output:

```json
{
  "decision": "qualify|reject|manual_review",
  "reason_codes": [
    "CATEGORY_MATCH",
    "WEBSITE_WEAK_SIGNAL"
  ]
}
```

Use rules before AI.

---

# 6. Website Audit Workflow

**Type:** deterministic  
**Purpose:** create evidence.

Tools:
- safe HTTP crawler;
- rendered browser worker if required;
- PageSpeed/Lighthouse API;
- schema parser;
- link/parser utilities;
- CrUX API optionally.

Output is evidence + findings.

It does not draft sales copy.

Example evidence:

```json
{
  "key": "h1_count_home",
  "value": 0,
  "source": "crawler",
  "observed_at": "..."
}
```

Example finding:

```json
{
  "code": "HOME_NO_H1",
  "severity": "medium",
  "evidence_ids": ["..."],
  "recommended_action": "Add a clear primary page heading."
}
```

---

# 7. Local Presence Analyzer

V1 should be cautious.

Purpose:
- interpret approved local-business discovery evidence;
- combine it with website/local SEO evidence.

Do not persist/reproduce provider-restricted review content outside allowed usage.

Output:

```json
{
  "business_strength_band": "high",
  "digital_mismatch": true,
  "reason_codes": [
    "STRONG_REPUTATION_SIGNAL",
    "WEBSITE_GAP"
  ],
  "evidence_ids": ["..."]
}
```

---

# 8. Opportunity Scorer

**Type:** deterministic versioned scoring function.

AI may produce explanation but not secret unstructured score.

Inputs:

```json
{
  "score_version": "v1",
  "evidence": []
}
```

Output:

```json
{
  "total": 88,
  "components": {
    "commercial_strength": 22,
    "digital_gap": 31,
    "reachability": 12,
    "service_fit": 15,
    "timing": 8
  },
  "rule_contributions": []
}
```

---

# 9. Research Synthesizer

**Type:** AI  
**Purpose:** convert facts into concise sales intelligence.

Allowed input:
- prospect canonical data;
- approved audit findings;
- approved business-strength signals;
- Rank Local ICP/offer knowledge.

No unrestricted web browsing in V1 unless separately designed and source captured.

Structured output:

```json
{
  "summary": "Established local roofer with strong reputation signals and a weak mobile website.",
  "strengths": [],
  "gaps": [],
  "recommended_offer_id": "...",
  "recommended_angle": "reputation_mismatch",
  "avoid_claims": [],
  "evidence_ids": [],
  "confidence": 0.91
}
```

System instruction:

> Use only supplied evidence. If evidence does not support a claim, omit it. Do not infer revenue, rankings, penalties, customer demographics or business health.

---

# 10. Sales Angle Selector

Angle library:

- no_owned_website;
- reputation_mismatch;
- mobile_conversion_gap;
- local_search_structure;
- trust_signal_gap;
- service_page_gap;
- speed_gap;
- enquiry_path_gap.

Output:

```json
{
  "angle": "reputation_mismatch",
  "why": "...",
  "evidence_ids": ["..."],
  "offer_id": "...",
  "confidence": 0.88
}
```

---

# 11. Email Drafter

**Type:** AI  
**Side effect:** none. Creates draft only.

Inputs:

```json
{
  "prospect": {},
  "approved_research": {},
  "sales_angle": {},
  "sequence_step": {},
  "brand_voice": {},
  "prior_thread": []
}
```

Output:

```json
{
  "subject": "...",
  "body_text": "...",
  "claims": [
    {
      "text": "...",
      "evidence_ids": ["..."]
    }
  ],
  "cta_type": "reply|audit|meeting",
  "warnings": []
}
```

Prompt principles:

- concise;
- natural;
- evidence first;
- one main observation;
- no fake compliment;
- no "I was just browsing your website" if automation did the audit;
- no pretend manual effort;
- no invented numbers;
- no false urgency;
- one CTA.

A useful first-touch style:

1. context;
2. specific evidence-backed observation;
3. why it matters in plain language;
4. low-friction offer/CTA.

---

# 12. Grounding Validator

**Type:** deterministic + optional AI verifier.

Checks every claim:

- evidence ID exists;
- evidence belongs to prospect;
- value is current enough;
- numeric value matches;
- claim wording does not overstate evidence.

Validation output:

```json
{
  "status": "pass|fail|manual_review",
  "errors": [],
  "unsupported_claims": []
}
```

No outbound draft becomes approvable without pass/manual resolution.

---

# 13. Sequence Scheduler

**Type:** deterministic.

Responsibilities:

- compute `next_action_at`;
- respect mailbox/campaign caps;
- respect business-day/time policies;
- check stop conditions;
- check suppression immediately before enqueue.

No AI needed.

---

# 14. Send Controller

**Type:** deterministic privileged workflow.

Required preconditions:

```text
draft.status == approved
send_mode == live
suppression_check == clear
compliance_policy == allowed
mailbox == healthy
sequence == active
idempotency_key unused
```

Side effect:
- Gmail API send.

Write provider IDs immediately after success.

---

# 15. Reply Ingest

**Type:** deterministic provider sync/webhook.

Responsibilities:

- map thread/message to prospect;
- store normalized metadata;
- stop active sequence before AI analysis when a genuine prospect reply is detected;
- trigger classifier.

Sequence stop should not wait for LLM.

---

# 16. Suppression Detector

Use hard pattern/rule detection plus AI for nuance.

Hard signals include explicit:
- unsubscribe;
- remove me;
- stop emailing;
- don't contact;
- data/privacy complaint.

On explicit objection:
- suppress first;
- classify second;
- notify operator if needed.

False negatives are more costly than false positives here.

---

# 17. Reply Classifier

Output schema:

```json
{
  "intent": "positive|question|pricing|later|supplier|referral|negative|unsubscribe|system|ambiguous",
  "confidence": 0.93,
  "requires_human": true,
  "recommended_action": "draft_reply",
  "summary": "Prospect asks for examples and pricing."
}
```

The model must not autonomously send the reply.

---

# 18. Reply Drafter

Inputs:
- full thread;
- prospect facts;
- Rank Local offer/pricing guidance;
- classification.

Output:

```json
{
  "body_text": "...",
  "claims": [],
  "recommended_next_stage": "meeting",
  "warnings": []
}
```

Require approval for V1.

---

# 19. Meeting Brief Agent

Trigger:
- meeting created.

Output:

```json
{
  "company_summary": "...",
  "top_opportunities": [],
  "recommended_offer": "...",
  "proof_to_use": [],
  "questions": [],
  "likely_objections": [],
  "thread_summary": "...",
  "do_not_claim": []
}
```

Keep brief to one screen by default.

---

# 20. Call Summary Agent

Input:
- operator notes and/or transcript.

Output:

```json
{
  "goals": [],
  "pain_points": [],
  "requirements": [],
  "budget_signal": "unknown",
  "timing": "unknown",
  "decision_process": [],
  "objections": [],
  "next_steps": [],
  "proposal_recommended": true
}
```

Do not infer facts not stated.

---

# 21. Proposal Input Builder

Produces structured scope notes, not a final binding commercial proposal.

Inputs:
- call summary;
- approved offers;
- pricing guidance;
- audit;
- opportunity.

Output:
- problem;
- objectives;
- proposed scope;
- exclusions;
- assumptions;
- timeline notes;
- commercial notes;
- risks;
- next step.

Human sets/approves actual commercial terms.

---

# 22. Operations agents

These should largely be software monitors, not LLMs.

## Provider Health
Checks:
- auth;
- latency;
- error rate;
- quota.

## Cost Guard
Checks:
- spend/day;
- spend/campaign;
- spend/qualified prospect;
- anomaly.

## Quality Guard
Checks:
- draft rejection spike;
- unsupported claim spike;
- reply classifier correction spike;
- audit failures;
- bounce/opt-out spike.

Circuit breaker can automatically pause campaign sends.

---

# 23. Prompt/version management

Every AI call stores:

```text
workflow_name
prompt_version
model
input_hash
knowledge_versions[]
output
validation_result
latency
usage
cost_estimate
```

Never edit a production prompt in place.

Create version `v2`, test, then promote.

---

# 24. Human review policies

## Always human review in early V1
- first-touch email;
- reply drafts;
- compliance ambiguity;
- proposal inputs/pricing;
- entity merge ambiguity.

## Candidate for automation after evidence
- low-risk follow-up scheduling;
- audit generation;
- score calculation;
- positive/negative reply triage above tested confidence;
- simple housekeeping.

---

# 25. Evaluation corpus

Before scaling, assemble:

- 50 known UK trade sites;
- 20 sites with no/poor local SEO;
- 20 strong sites that should **not** be attacked with fake criticism;
- 10 broken/unavailable sites;
- 100 reply examples.

The product should correctly distinguish "good site" from "sales opportunity". It must be allowed to say:

> No strong website-rebuild angle found.

That is a feature, not a failure.
