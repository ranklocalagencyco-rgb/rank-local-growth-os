import type { AuditReportModel, ReportStrategy } from "@/report/model";
import type { ReportMetric } from "@/report/metrics";

export function AuditLocalSeoSection({ localSeo }: { localSeo: AuditReportModel["localSeo"] }) {
  return (
    <section className="ar-section" aria-label="Local SEO">
      <h2>Local SEO</h2>
      <table className="ar-table">
        <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Measured evidence</th></tr></thead>
        <tbody>{localSeo.items.map((item) => <tr key={item.key}><th scope="row">{item.label}</th><td><span className={`ar-state ar-state-${item.state}`}>{item.stateLabel}</span></td><td>{item.detail ?? "—"}</td></tr>)}</tbody>
      </table>
      {localSeo.localities.length > 0 ? <p className="ar-footnote">Localities named on the website: {localSeo.localities.join(", ")}.</p> : null}
    </section>
  );
}

export function AuditStructureSection({ structure, contentEvaluated }: { structure: AuditReportModel["structure"]; contentEvaluated: boolean }) {
  return (
    <section className="ar-section" aria-label="Website structure">
      <h2>Website structure</h2>
      <p className="ar-lead">{structure.scopeSentence}</p>
      {contentEvaluated ? <ul className="ar-roles">{structure.roles.map((role) => <li key={role.role}><span className="ar-role-count">{role.count}</span><span>{role.label}</span></li>)}</ul> : null}
      <dl className="ar-facts">
        <div><dt>Pages evaluated</dt><dd>{contentEvaluated ? `${structure.pagesEvaluated} of ${structure.pagesAttempted} requested` : "Not evaluated"}{contentEvaluated && structure.pagesNotLoaded > 0 ? ` · ${structure.pagesNotLoaded} did not load as a page` : ""}</dd></div>
        <div><dt>Page limit</dt><dd>{structure.pageCap === null ? "Not recorded" : `${structure.pageCap} pages per audit`}</dd></div>
        <div><dt>XML sitemap</dt><dd>{structure.sitemapLabel}</dd></div>
      </dl>
    </section>
  );
}

function MetricRow({ metric }: { metric: ReportMetric }) {
  return <tr><th scope="row">{metric.label}</th><td>{metric.value}</td><td>{metric.bandLabel ? <span className={`ar-band ar-band-${metric.band}`}>{metric.bandLabel}</span> : <span className="ar-quiet">—</span>}</td></tr>;
}

function StrategyCard({ strategy }: { strategy: ReportStrategy }) {
  return (
    <article className="ar-strategy">
      <div className="ar-strategy-head"><h3>{strategy.label}</h3><div className="ar-strategy-score">{strategy.status !== "measured" ? "Not measured" : strategy.score === null ? "Score not returned" : <>{strategy.score}<span> / 100</span></>}</div></div>
      <p className="ar-quiet">Lighthouse performance score</p>
      {strategy.note ? <p>{strategy.note}</p> : null}
      {strategy.metrics.length > 0 ? <table className="ar-table ar-table-compact"><thead><tr><th scope="col">Lab metric</th><th scope="col">Measured</th><th scope="col">Rating</th></tr></thead><tbody>{strategy.metrics.map((metric) => <MetricRow key={metric.key} metric={metric} />)}</tbody></table> : null}
    </article>
  );
}

export function AuditPerformanceSection({ performance }: { performance: AuditReportModel["performance"] }) {
  return (
    <section className="ar-section" aria-label="Performance">
      <h2>Performance</h2>
      <p className="ar-lead">Homepage, measured in a lab run on mobile and desktop.{performance.providerLabel ? ` Source: ${performance.providerLabel}.` : ""}</p>
      <div className="ar-strategies">{performance.strategies.map((strategy) => <StrategyCard key={strategy.strategy} strategy={strategy} />)}</div>
      <p className="ar-footnote">Ratings are shown only for metrics with a documented threshold (LCP 2.5 s / 4.0 s, CLS 0.1 / 0.25, TBT 200 ms / 600 ms, INP 200 ms / 500 ms). Other values are shown as measured.</p>
      {performance.field.metrics.length > 0 ? (
        <div className="ar-field"><h3>Real-user (CrUX) data</h3><p className="ar-quiet">{performance.field.scopeLabel}</p><table className="ar-table ar-table-compact"><thead><tr><th scope="col">Field metric</th><th scope="col">Measured</th><th scope="col">Rating</th></tr></thead><tbody>{performance.field.metrics.map((metric) => <MetricRow key={metric.key} metric={metric} />)}</tbody></table></div>
      ) : performance.field.sentence ? <p className="ar-field-note">{performance.field.sentence}</p> : null}
    </section>
  );
}
