import type { AuditReportModel } from "@/report/model";

// Header, evidence coverage and the notices that qualify everything below them. Presentational only: props are the pure report model.

export function AuditReportHeader({ header }: { header: AuditReportModel["header"] }) {
  return (
    <header className="ar-header">
      <div className="ar-brand"><span className="ar-brand-mark" aria-hidden="true" />Rank Local<span className="ar-brand-sub">Website audit report</span></div>
      <div className="ar-header-main">
        <div className="ar-title">
          <h1>{header.businessName}</h1>
          <p className="ar-domain">{header.domain}</p>
          <p className="ar-meta">Audited {header.auditDateLabel}</p>
        </div>
        <div className={`ar-overall ar-tone-${header.tone}`}>
          <div className="ar-overall-label">Overall score</div>
          <div className="ar-overall-value">{header.overallLabel}</div>
          <div className="ar-chip">{header.statusLabel}</div>
        </div>
      </div>
    </header>
  );
}

export function AuditEvidenceCoverage({ coverage, state }: { coverage: AuditReportModel["coverage"]; state: AuditReportModel["state"] }) {
  const percent = coverage.percent === null ? null : Math.max(0, Math.min(100, coverage.percent));
  return (
    <section className={`ar-coverage ar-state-${state}`} aria-label="Evidence coverage">
      <div className="ar-coverage-head">
        <h2>Evidence coverage</h2>
        <span className="ar-coverage-value">{percent === null ? "Not calculated" : `${coverage.percent}%`}</span>
      </div>
      {percent === null ? null : <div className="ar-bar" role="img" aria-label={`${coverage.percent}% of the scoring evidence was measured`}><span style={{ width: `${percent}%` }} /></div>}
      <p className="ar-coverage-sentence">{coverage.sentence}</p>
      {coverage.details.length > 0 ? <ul className="ar-plain-list">{coverage.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
      <p className="ar-footnote">Coverage is the share of the 100 scoring points that could be measured. Evidence that was not collected is excluded from the score, never counted as a failure.</p>
    </section>
  );
}

export function AuditHistoricalNotice({ notice }: { notice: NonNullable<AuditReportModel["historicalNotice"]> }) {
  return (
    <aside className="ar-notice" aria-label="Audit version notice">
      <p>{notice.text}</p>
      <p className="ar-footnote">{notice.versions.join(" · ")}</p>
    </aside>
  );
}

export function AuditBlockedNotice({ blocked }: { blocked: NonNullable<AuditReportModel["blocked"]> }) {
  return (
    <section className="ar-blocked" aria-label="Audit blocked">
      <h2>{blocked.headline}</h2>
      <p>{blocked.text}</p>
      <dl className="ar-facts">
        <div><dt>Detected</dt><dd>{blocked.kindLabel}</dd></div>
        <div><dt>URL</dt><dd>{blocked.url}</dd></div>
        <div><dt>Response</dt><dd>{blocked.httpStatusLabel}{blocked.pageTitle ? ` · page title “${blocked.pageTitle}”` : ""}</dd></div>
        <div><dt>Detected at</dt><dd>{blocked.detectedAtLabel}</dd></div>
        <div><dt>Signals</dt><dd className="ar-mono">{blocked.signals.length > 0 ? blocked.signals.join(" · ") : "None stored"}</dd></div>
      </dl>
      <p className="ar-footnote">{blocked.detail}</p>
    </section>
  );
}
