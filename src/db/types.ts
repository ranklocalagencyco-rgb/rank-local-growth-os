export type SendMode = "disabled" | "sandbox" | "live";
export type WorkflowStatus = "queued" | "running" | "completed" | "failed" | "dead_letter";

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
			activity_events: TableDefinition<ActivityEvent>;
			suppressions: TableDefinition<Suppression>;
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
};
