import Link from "next/link";

import { getProspectDetail } from "@/data/crm";
import { formatDate, formatLocation, prospectStatusLabel } from "@/domain/crm";
import { getWorkspaceContext } from "@/domain/workspaces";

type ProspectDetailPageProps = { params: Promise<{ id: string }> };

export default async function ProspectDetailPage({ params }: ProspectDetailPageProps) {
  const { id } = await params;
  const detail = await getProspectDetail(getWorkspaceContext().workspaceId, id);

  if (!detail.prospect) return <main className="page-shell"><Link className="back-link" href="/prospects">← Back to prospects</Link><div className="empty-state"><h2>Prospect not found</h2><p>This record does not exist in the current workspace.</p></div></main>;

  const prospect = detail.prospect;
  return <main className="page-shell">
    <Link className="back-link" href="/prospects">← Back to prospects</Link>
    <div className="page-heading"><div><div className="eyebrow">Prospect record</div><h1>{prospect.display_name}</h1><p>{formatLocation(prospect)}{prospect.canonical_domain ? ` · ${prospect.canonical_domain}` : ""}</p></div><span className="status-pill">{prospectStatusLabel(prospect.status)}</span></div>
    <div className="detail-grid"><div className="detail-main"><section className="panel detail-card"><h2>Summary</h2><div className="field-grid"><div className="field"><label>Entity type</label><p>{prospect.entity_type.replace(/_/g, " ")}</p></div><div className="field"><label>Pipeline stage</label><p>{prospect.pipeline_stage}</p></div><div className="field"><label>Primary email</label><p>{prospect.primary_email || "Not recorded"}</p></div><div className="field"><label>Primary phone</label><p>{prospect.primary_phone || "Not recorded"}</p></div><div className="field"><label>Company number</label><p>{prospect.company_number || "Not recorded"}</p></div><div className="field"><label>Opportunity score</label><p>{prospect.current_opportunity_score ?? "Not scored"}</p></div></div></section><section className="panel detail-card"><h2>Activity</h2>{detail.activity.length === 0 ? <p className="muted">No activity recorded yet.</p> : <div className="timeline">{detail.activity.map((event) => <div className="timeline-item" key={event.id}><strong>{event.summary}</strong><time>{event.event_type} · {formatDate(event.created_at)}</time></div>)}</div>}</section></div><aside className="detail-side"><section className="panel detail-card"><h2>Source references</h2>{detail.sourceRefs.length === 0 ? <p className="muted">No source references recorded yet.</p> : <div className="source-list">{detail.sourceRefs.map((source) => <div className="source-item" key={source.id}><strong>{source.provider}</strong><span>{source.external_id} · first seen {formatDate(source.first_seen_at)}</span></div>)}</div>}</section><section className={`panel detail-card ${detail.suppressions.length ? "danger" : ""}`}><h2>Compliance</h2>{detail.suppressions.length ? <div><strong>Suppressed</strong><p>{detail.suppressions[0].reason}</p><span className="muted">Recorded {formatDate(detail.suppressions[0].created_at)}</span></div> : <p className="muted">No suppression record for this prospect.</p>}</section></aside></div>
  </main>;
}
