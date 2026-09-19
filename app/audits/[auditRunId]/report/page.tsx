import type { Metadata } from "next";
import Link from "next/link";

import { getAuditReportData } from "@/data/audit-report";
import { getWorkspaceContext } from "@/domain/workspaces";
import { buildAuditReport, isReportAvailable } from "@/report/model";
import { AuditReport } from "@/ui/audit-report/audit-report";
import { PrintButton } from "@/ui/audit-report/print-button";

import "./report.css";

// Internal route. Data is scoped to the current workspace; there is no public, tokenised or share-link access (docs/AUDIT_REPORT.md).
// `noindex` only keeps the page out of search engines. It is not access control.
export const metadata: Metadata = { title: "Website audit report · Rank Local", robots: { index: false, follow: false } };

type AuditReportPageProps = { params: Promise<{ auditRunId: string }> };

function Unavailable({ title, detail, backHref }: { title: string; detail: string; backHref: string }) {
  return <main className="page-shell"><Link className="back-link" href={backHref}>← Back</Link><div className="empty-state"><h2>{title}</h2><p>{detail}</p></div></main>;
}

export default async function AuditReportPage({ params }: AuditReportPageProps) {
  const { auditRunId } = await params;
  const workspaceId = getWorkspaceContext().workspaceId;
  const loaded = await getAuditReportData(workspaceId, auditRunId);

  if (loaded.status === "not_configured") return <Unavailable title="Database not configured" detail="Supabase is not configured, so no audit can be loaded." backHref="/prospects" />;
  if (loaded.status === "not_found") return <Unavailable title="Audit not found" detail="This audit does not exist in the current workspace." backHref="/prospects" />;
  const prospectHref = `/prospects/${loaded.data.run.prospect_id}`;
  if (!isReportAvailable(loaded.data.run)) return <Unavailable title="Report not available yet" detail={`This audit is ${loaded.data.run.status}. A report can be shown once the audit has completed or was blocked.`} backHref={prospectHref} />;

  const model = buildAuditReport(loaded.data);
  return (
    <main>
      <AuditReport model={model} toolbar={<><Link className="ar-back" href={prospectHref}>← Back to prospect</Link><span className="ar-toolbar-note">Internal view only</span><PrintButton /></>} />
    </main>
  );
}
