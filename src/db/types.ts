export type SendMode = "disabled" | "sandbox" | "live";
export type WorkflowStatus = "queued" | "running" | "completed" | "failed" | "dead_letter";
export type WebsiteState = "unknown" | "verified_website" | "unverified" | "likely_no_website" | "verified_no_website";
export type CandidateWebsiteHint = "present" | "absent" | "unknown";
export type CandidateStatus = "new" | "resolving" | "resolved" | "failed" | "expired";
export type CandidateResolutionStatus = "pending" | "created" | "matched" | "ambiguous" | "rejected" | "failed";

export type Campaign = {
	id: string;
	workspace_id: string;
	name: string;
	status: "draft" | "active" | "paused" | "completed";
	country_code: string;
	target_categories: string[];
	target_locations: string[];
	website_filter: string;
	minimum_score: number | null;
	entity_policy: string;
	daily_candidate_cap: number | null;
	daily_send_cap: number | null;
	approval_mode: string;
	settings_json: Record<string, unknown>;
	created_by: string | null;
	created_at: string;
	updated_at: string;
};

export type CampaignRun = {
	id: string;
	campaign_id: string;
	workspace_id: string | null;
	run_type: string;
	requested_by: string | null;
	job_id: string | null;
	provider: string | null;
	/** Provider execution mode used for the run (e.g. DataForSEO standard/priority/live), when the provider reports one. */
	provider_mode: string | null;
	provider_requests: number;
	/** Accumulated provider-reported cost for the run in USD. */
	provider_cost_usd: number;
	search_units_total: number;
	search_units_completed: number;
	status: "queued" | "running" | "completed" | "failed";
	started_at: string | null;
	finished_at: string | null;
	cursor_json: Record<string, unknown>;
	candidates_seen: number;
	prospects_created: number;
	qualified_count: number;
	error_summary: string | null;
	created_at: string;
};

export type Prospect = {
	id: string;
	workspace_id: string;
	display_name: string;
	normalized_name: string;
	canonical_domain: string | null;
	primary_phone: string | null;
	primary_email: string | null;
	company_number: string | null;
	entity_type: string;
	entity_confidence: number | null;
	country_code: string;
	region: string | null;
	city: string | null;
	postcode: string | null;
	status: "new" | "qualified" | "audited" | "outreach_ready" | "suppressed" | "archived";
	pipeline_stage: "new" | "qualified" | "opportunity" | "meeting" | "won" | "lost";
	owner_user_id: string | null;
	current_opportunity_score: number | null;
	current_score_version: string | null;
	recommended_offer_id: string | null;
	website_state: WebsiteState;
	website_url: string | null;
	website_verified_at: string | null;
	created_at: string;
	updated_at: string;
};

export type ProspectSourceRef = {
	id: string;
	workspace_id: string;
	prospect_id: string;
	provider: string;
	external_id: string;
	source_url: string | null;
	first_seen_at: string;
	last_seen_at: string;
	retention_class: string;
	metadata: Record<string, unknown>;
};

export type ProspectFieldEvidence = {
	id: string;
	workspace_id: string;
	prospect_id: string;
	field_name: string;
	value_hash: string;
	display_value: string | null;
	source_type: string;
	source_ref_id: string | null;
	observed_at: string;
	confidence: number | null;
	retention_class: string;
	is_current: boolean;
	created_at: string;
};

export type ProspectWebsiteVerification = {
	id: string;
	workspace_id: string;
	prospect_id: string;
	candidate_id: string | null;
	state: Exclude<WebsiteState, "unknown">;
	website_url: string | null;
	canonical_domain: string | null;
	confidence: number;
	signals_json: unknown[];
	verifier_version: string;
	verified_at: string;
	is_current: boolean;
	created_at: string;
};

export type DiscoveryCandidate = {
	id: string;
	workspace_id: string;
	campaign_id: string;
	campaign_run_id: string | null;
	provider: string;
	provider_ref: string;
	status: CandidateStatus;
	candidate_name: string | null;
	candidate_category: string | null;
	candidate_location: string | null;
	candidate_website_state: CandidateWebsiteHint;
	candidate_summary_json: Record<string, unknown>;
	dedupe_key: string | null;
	source_query_json: Record<string, unknown>;
	retention_class: string;
	first_seen_at: string;
	last_seen_at: string;
	expires_at: string | null;
	content_purged_at: string | null;
	resolution_status: CandidateResolutionStatus;
	resolution_confidence: number | null;
	resolution_notes_json: Record<string, unknown>;
	resolved_prospect_id: string | null;
	created_at: string;
	updated_at: string;
};

/** One observation of where a listing ranked in a provider's local search results for a campaign search unit. Retained; not provider content. */
export type LocalRankObservation = {
	id: string;
	workspace_id: string;
	campaign_id: string;
	campaign_run_id: string | null;
	candidate_id: string | null;
	prospect_id: string | null;
	provider: string;
	provider_ref: string;
	search_category: string;
	search_location: string;
	country_code: string;
	rank_position: number;
	rank_absolute: number | null;
	rating: number | null;
	review_count: number | null;
	observed_at: string;
	created_at: string;
};

export type JobRow = {
	id: string;
	workspace_id: string;
	type: string;
	idempotency_key: string;
	payload: Record<string, unknown>;
	status: WorkflowStatus;
	attempts: number;
	max_attempts: number;
	run_after: string;
	locked_at: string | null;
	locked_by: string | null;
	last_error: string | null;
	trace_id: string;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
};

export type DomainEventRow = {
	id: string;
	workspace_id: string;
	aggregate_type: string;
	aggregate_id: string;
	event_type: string;
	idempotency_key: string;
	payload: Record<string, unknown>;
	occurred_at: string;
	published_at: string | null;
	attempts: number;
};

export type ActivityEvent = {
	id: string;
	workspace_id: string;
	prospect_id: string | null;
	campaign_id: string | null;
	event_type: string;
	actor_type: string;
	actor_id: string | null;
	summary: string;
	metadata: Record<string, unknown>;
	created_at: string;
};

export type Suppression = {
	id: string;
	workspace_id: string;
	scope: "contact" | "prospect" | "domain" | "global_identity";
	email_hash: string | null;
	domain_hash: string | null;
	phone_hash: string | null;
	prospect_id: string | null;
	reason: string;
	source: string;
	created_at: string;
	created_by: string | null;
};

type TableDefinition<Row> = {
	Row: Row;
	Insert: Partial<Row>;
	Update: Partial<Row>;
	Relationships: [];
};

export type Database = {
	public: {
		Tables: {
			campaigns: TableDefinition<Campaign>;
			campaign_runs: TableDefinition<CampaignRun>;
			prospects: TableDefinition<Prospect>;
			prospect_source_refs: TableDefinition<ProspectSourceRef>;
			prospect_field_evidence: TableDefinition<ProspectFieldEvidence>;
			prospect_website_verifications: TableDefinition<ProspectWebsiteVerification>;
			discovery_candidates: TableDefinition<DiscoveryCandidate>;
			local_rank_observations: TableDefinition<LocalRankObservation>;
			jobs: TableDefinition<JobRow>;
			domain_events: TableDefinition<DomainEventRow>;
			activity_events: TableDefinition<ActivityEvent>;
			suppressions: TableDefinition<Suppression>;
		};
		Views: Record<string, never>;
		Functions: {
			claim_jobs: {
				Args: { p_worker_id: string; p_limit?: number; p_stale_after?: string };
				Returns: JobRow[];
			};
			purge_expired_discovery_content: {
				Args: Record<string, never>;
				Returns: number;
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
};
