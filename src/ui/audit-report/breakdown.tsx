import type { AuditReportModel } from "@/report/model";

// Transparency appendix: every scoring rule with its status, points and the measured values behind it. Visually secondary.
export function AuditScoreBreakdown({ breakdown }: { breakdown: AuditReportModel["breakdown"] }) {
  if (breakdown.length === 0) return null;
  return (
    <section className="ar-section ar-breakdown" aria-label="Score breakdown">
      <details>
        <summary><h2>Score breakdown</h2><span className="ar-quiet">Every rule, its points and the measured evidence</span></summary>
        {breakdown.map((category) => (
          <div key={category.key} className="ar-breakdown-category">
            <h3>{category.label} <span className="ar-quiet">· {category.scoreLabel} · {category.evaluatedLabel}</span></h3>
            <table className="ar-table ar-table-compact">
              <thead><tr><th scope="col">Rule</th><th scope="col">Status</th><th scope="col">Points</th><th scope="col">Measured evidence</th></tr></thead>
              <tbody>{category.rules.map((rule) => <tr key={rule.code}><th scope="row">{rule.label}</th><td><span className={`ar-status ar-status-${rule.status}`}>{rule.statusLabel}</span></td><td className="ar-num">{rule.pointsLabel}</td><td>{rule.evidence.length > 0 ? rule.evidence.map((item) => `${item.label}: ${item.value}`).join(" · ") : "—"}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
      </details>
    </section>
  );
}
