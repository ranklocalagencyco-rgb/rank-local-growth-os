import Link from "next/link";

import { getRuntimeConfig } from "@/config/env";
import { getCampaignDetail } from "@/data/discovery";
import { getDiscoveryProviderReadiness } from "@/discovery/providers/registry";
import { campaignStatusLabel, formatDate } from "@/domain/crm";
import { candidateHintLabel, countByResolution, resolutionStatusLabel, resolutionTone, summariseDiscoveryStatus, websiteStateLabel, websiteStateTone } from "@/domain/discovery";
import { getWorkspaceContext } from "@/domain/workspaces";
import { processJobsNowAction, runDiscoveryAction } from "./actions";

type CampaignDetailPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> };

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function CampaignDetailPage({ params, searchParams }: CampaignDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const config = getRuntimeConfig();
  const workspaceId = getWorkspaceContext().workspaceId;
  const detail = await getCampaignDetail(workspaceId, id);
  const readiness = getDiscoveryProviderReadiness();

  if (!detail.databaseConfigured) {
    return <main className="page-shell"><Link className="back-link" href="/campaigns">← Back to campaigns</Link><div className="empty-state warning"><h2>Database not configured</h2><p>Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load campaigns and run discovery.</p></div></main>;
  }

  if (!detail.campaign) {
    return <main className="page-shell"><Link className="back-link" href="/campaigns">← Back to campaigns</Link><div className="empty-state"><h2>Campaign not found</h2><p>This campaign does not exist in the current workspace.</p></div></main>;
  }

  const campaign = detail.campaign;
  const latestRun = detail.runs[0] ?? null;
  const latestJob = latestRun?.job_id ? detail.runJobsById.get(latestRun.job_id) ?? null : null;
  const status = summariseDiscoveryStatus(latestRun, latestJob);
  const counts = countByResolution(detail.candidates);
  const prospectsLinked = counts.created + counts.matched;
  const runInFlight = status.phase === "queued" || status.phase === "running";
  const canRun = readiness.configured && !runInFlight && campaign.target_categories.length > 0 && campaign.target_locations.length > 0;
  const hasProviderContent = detail.candidates.some((candidate) => candidate.provider === "google_places" && !candidate.content_purged_at);
  const pendingWork = detail.resolveJobs.queued + detail.resolveJobs.running + detail.resolveJobs.failed;

  return <main className="page-shell">
    <Link className="back-link" href="/campaigns">← Back to campaigns</Link>
    <div className="page-heading">
      <div><div className="eyebrow">Campaign</div><h1>{campaign.name}</h1><p>{campaign.target_categories.join(", ") || "No categories"} · {campaign.target_locations.join(", ") || "No locations"} · {campaign.country_code}</p></div>
      <span className="status-pill">{campaignStatusLabel(campaign.status)}</span>
    </div>

    {query.notice ? <div className="notice success" role="status">{query.notice}</div> : null}
    {query.error ? <div className="notice danger" role="alert">{query.error}</div> : null}
    {!readiness.configured ? <div className="notice warning" role="alert"><strong>Discovery provider not configured.</strong> Add {readiness.missing.join(", ")} to the server environment to enable the {readiness.provider.replace(/_/g, " ")} adapter. The key is only ever read server-side.</div> : null}

    <section className="stats">
      <div className="stat"><span>Discovery status</span><strong>{status.headline}</strong>{status.detail ? <p className="muted">{status.detail}</p> : null}</div>
      <div className="stat"><span>Candidates</span><strong>{detail.candidates.length}</strong><p className="muted">{counts.pending} pending · {counts.ambiguous} need review · {counts.rejected} rejected</p></div>
      <div className="stat"><span>Prospects linked</span><strong>{prospectsLinked}</strong><p className="muted">{counts.created} created · {counts.matched} matched existing</p></div>
    </section>

    <section className="panel">
      <div className="panel-header">
        <div><h2>Run discovery</h2><p>Searches every category × location pair through the {readiness.provider.replace(/_/g, " ")} adapter in a durable background job, then verifies websites and resolves prospects.</p></div>
        <div className="actions">
          <form action={runDiscoveryAction}><input type="hidden" name="campaignId" value={campaign.id} /><button type="submit" className="button primary" disabled={!canRun}>{runInFlight ? "Run in progress" : "Run discovery"}</button></form>
          {config.appEnv === "local" ? <form action={processJobsNowAction}><input type="hidden" name="campaignId" value={campaign.id} /><button type="submit" className="button">Process queued jobs (local)</button></form> : null}
        </div>
      </div>
      {pendingWork > 0 ? <div className="panel-body muted">Resolution jobs: {detail.resolveJobs.queued} queued · {detail.resolveJobs.running} running · {detail.resolveJobs.failed} retrying · {detail.resolveJobs.deadLetter} dead-lettered. Refresh this page to see progress.</div> : null}
      {detail.resolveJobs.deadLetter > 0 && pendingWork === 0 ? <div className="panel-body muted">{detail.resolveJobs.deadLetter} resolution job{detail.resolveJobs.deadLetter === 1 ? "" : "s"} dead-lettered. Inspect the jobs table for details.</div> : null}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Candidates</h2><p>{detail.candidates.length === 0 ? "Nothing discovered yet." : `Showing the latest ${detail.candidates.length} candidate${detail.candidates.length === 1 ? "" : "s"}.`}</p></div>{hasProviderContent ? <span className="attribution">Business listings powered by Google</span> : null}</div>
      {detail.candidates.length === 0 ? (
        <div className="empty-state">
          <h3>No candidates yet</h3>
          <p>{status.phase === "never_run" ? "Run discovery to search for businesses matching this campaign." : status.phase === "failed" ? "The last run failed before any candidates were stored. Fix the error above and run again." : "The run is in progress. Candidates appear here as each search page completes."}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Category</th><th>Location</th><th>Website state</th><th>Source</th><th>Resolution</th></tr></thead>
            <tbody>
              {detail.candidates.map((candidate) => {
                const prospect = candidate.resolved_prospect_id ? detail.prospectsById.get(candidate.resolved_prospect_id) ?? null : null;
                const websiteState = prospect?.website_state ?? null;
                const notes = candidate.resolution_notes_json as { websiteState?: string; websiteUrl?: string | null; reason?: string; candidateProspectIds?: string[] };
                const displayedState = websiteState ?? (typeof notes.websiteState === "string" ? (notes.websiteState as typeof websiteState) : null);
                return (
                  <tr key={candidate.id}>
                    <td>
                      {prospect ? <Link className="primary-link" href={`/prospects/${prospect.id}`}>{prospect.display_name}</Link> : <strong>{candidate.candidate_name ?? (candidate.content_purged_at ? "Provider content expired" : "Name unavailable")}</strong>}
                      <div className="muted">{prospect?.website_url ?? prospect?.canonical_domain ?? notes.websiteUrl ?? candidateHintLabel(candidate.candidate_website_state)}</div>
                    </td>
                    <td>{candidate.candidate_category ?? "—"}</td>
                    <td>{candidate.candidate_location ?? "—"}</td>
                    <td>{displayedState ? <span className={`status-pill tone-${websiteStateTone(displayedState)}`}>{websiteStateLabel(displayedState)}</span> : <span className="status-pill tone-neutral">{candidate.resolution_status === "pending" ? "Verifying…" : candidateHintLabel(candidate.candidate_website_state)}</span>}</td>
                    <td><div>{candidate.provider.replace(/_/g, " ")}</div><div className="muted">ref {candidate.provider_ref.slice(0, 12)}… · seen {formatDate(candidate.last_seen_at)}</div></td>
                    <td>
                      <span className={`status-pill tone-${resolutionTone(candidate.resolution_status)}`}>{resolutionStatusLabel(candidate.resolution_status)}</span>
                      {candidate.resolution_status === "rejected" && notes.reason ? <div className="muted">{notes.reason.replace(/_/g, " ")}</div> : null}
                      {candidate.resolution_status === "ambiguous" && notes.candidateProspectIds?.length ? <div className="muted">{notes.candidateProspectIds.length} possible match{notes.candidateProspectIds.length === 1 ? "" : "es"}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Run history</h2><p>Latest {detail.runs.length} run{detail.runs.length === 1 ? "" : "s"}.</p></div></div>
      {detail.runs.length === 0 ? <div className="empty-state"><p>No runs yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Started</th><th>Status</th><th>Progress</th><th>Candidates</th><th>Provider requests</th><th>Notes</th></tr></thead>
            <tbody>
              {detail.runs.map((run) => {
                const job = run.job_id ? detail.runJobsById.get(run.job_id) ?? null : null;
                return (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.started_at ?? run.created_at)}</td>
                    <td><span className={`status-pill tone-${run.status === "completed" ? "good" : run.status === "failed" ? "bad" : "neutral"}`}>{run.status}</span>{job ? <div className="muted">job {job.status}{job.attempts ? ` · attempt ${job.attempts}` : ""}</div> : null}</td>
                    <td>{run.search_units_completed} / {run.search_units_total} units</td>
                    <td>{run.candidates_seen}</td>
                    <td>{run.provider_requests}</td>
                    <td className="muted">{run.error_summary ?? job?.last_error ?? (run.finished_at ? `Finished ${formatDateTime(run.finished_at)}` : "—")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </main>;
}
