import type { AuditReportModel, ReportFinding } from "@/report/model";

function FindingEntry({ finding }: { finding: ReportFinding }) {
  return (
    <article className="ar-finding">
      <div className="ar-finding-head">
        <h4>{finding.title}</h4>
        <span className={`ar-severity ar-severity-${finding.severity}`}>{finding.severityLabel}</span>
      </div>
      <p>{finding.explanation}</p>
      <p className="ar-finding-scope">
        {finding.scope === "site" ? "Applies to the website as a whole." : `Affects ${finding.affectedCount} page${finding.affectedCount === 1 ? "" : "s"}: ${finding.affectedPaths.join(", ")}${finding.morePaths > 0 ? ` and ${finding.morePaths} more` : ""}.`}
      </p>
      {finding.evidence.length > 0 ? <dl className="ar-evidence">{finding.evidence.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
    </article>
  );
}

export function AuditFindingsSection({ model }: { model: Pick<AuditReportModel, "contentEvaluated" | "keyFindings" | "findingGroups" | "findingCount" | "crawlNotes"> }) {
  if (!model.contentEvaluated) {
    return <section className="ar-section" aria-label="Findings"><h2>Findings</h2><p className="ar-lead">Not evaluated. The website&apos;s pages were not read, so no finding was derived and nothing is reported as missing.</p></section>;
  }
  return (
    <section className="ar-section" aria-label="Findings">
      <h2>Key findings</h2>
      {model.findingCount === 0 ? <p className="ar-lead">The audit rules produced no findings for the evaluated pages.</p> : <div className="ar-findings">{model.keyFindings.map((finding) => <FindingEntry key={finding.code} finding={finding} />)}</div>}
      {model.crawlNotes.length > 0 ? <div className="ar-notes"><h3>Notes about this audit</h3><ul className="ar-plain-list">{model.crawlNotes.map((note) => <li key={note}>{note}</li>)}</ul></div> : null}
      {model.findingCount > 0 ? (
        <div className="ar-all-findings">
          <h3>All findings by category ({model.findingCount})</h3>
          {model.findingGroups.map((group) => (
            <div key={group.key} className="ar-finding-group">
              <h4>{group.label}</h4>
              <ul className="ar-plain-list">{group.findings.map((finding) => <li key={finding.code}><strong>{finding.title}</strong> <span className="ar-quiet">· {finding.severityLabel}{finding.scope === "page" ? ` · ${finding.affectedCount} page${finding.affectedCount === 1 ? "" : "s"}` : " · site-wide"}</span></li>)}</ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AuditStrengthsSection({ strengths, contentEvaluated }: { strengths: AuditReportModel["strengths"]; contentEvaluated: boolean }) {
  return (
    <section className="ar-section" aria-label="What is working well">
      <h2>What is working well</h2>
      {strengths.length === 0 ? <p className="ar-lead">{contentEvaluated ? "No check passed in full in the categories that were scored." : "Not evaluated for the website's content. Only measured checks are listed here, and none passed in full."}</p> : (
        <>
          <p className="ar-lead">Checks that passed in full, from the same measured evidence as the score.</p>
          <ul className="ar-strengths">{strengths.map((strength) => <li key={strength.code}><span className="ar-tick" aria-hidden="true">✓</span><span>{strength.text}<span className="ar-quiet"> · {strength.categoryLabel}</span></span></li>)}</ul>
        </>
      )}
    </section>
  );
}
