import type { ReactNode } from "react";

import type { AuditReportModel } from "@/report/model";
import { AuditScoreBreakdown } from "@/ui/audit-report/breakdown";
import { AuditFindingsSection, AuditStrengthsSection } from "@/ui/audit-report/findings";
import { AuditBlockedNotice, AuditEvidenceCoverage, AuditHistoricalNotice, AuditReportHeader } from "@/ui/audit-report/header";
import { AuditScoreSummary } from "@/ui/audit-report/score-summary";
import { AuditLocalSeoSection, AuditPerformanceSection, AuditStructureSection } from "@/ui/audit-report/sections";

// Client-facing website audit report (docs/AUDIT_REPORT.md). A server-rendered document: every value comes from the pure model in
// src/report/model.ts, which reads stored audit evidence only. No data access, no LLM, no generated copy here.
// `toolbar` is screen-only chrome supplied by the route (back link, print button); it is hidden in print.
export function AuditReport({ model, toolbar }: { model: AuditReportModel; toolbar?: ReactNode }) {
  return (
    <div className="audit-report">
      {toolbar ? <div className="ar-toolbar">{toolbar}</div> : null}
      <article className="ar-document">
        <AuditReportHeader header={model.header} />
        {model.historicalNotice ? <AuditHistoricalNotice notice={model.historicalNotice} /> : null}
        {model.blocked ? <AuditBlockedNotice blocked={model.blocked} /> : null}
        <AuditEvidenceCoverage coverage={model.coverage} state={model.state} />
        <AuditScoreSummary categories={model.categories} state={model.state} />
        <AuditFindingsSection model={model} />
        <AuditStrengthsSection strengths={model.strengths} contentEvaluated={model.contentEvaluated} />
        <AuditLocalSeoSection localSeo={model.localSeo} />
        <AuditStructureSection structure={model.structure} contentEvaluated={model.contentEvaluated} />
        <AuditPerformanceSection performance={model.performance} />
        <AuditScoreBreakdown breakdown={model.breakdown} />
        <footer className="ar-footer">
          <p>Prepared by Rank Local from stored, measured audit evidence. No part of this report is estimated or generated; checks that could not be measured are marked as not evaluated.</p>
          <p className="ar-mono">{model.header.versions.crawler} · {model.header.versions.rules} · {model.header.versions.scoring ?? "not scored"} · audit {model.header.runId}</p>
        </footer>
      </article>
    </div>
  );
}
