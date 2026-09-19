import type { AuditReportModel, ReportCategory } from "@/report/model";

export function AuditCategoryCard({ category }: { category: ReportCategory }) {
  return (
    <article className={`ar-category${category.evaluated ? "" : " ar-category-muted"}`}>
      <h3>{category.label}</h3>
      <div className="ar-category-score">{category.scoreLabel}</div>
      {category.ratio === null ? <div className="ar-bar ar-bar-empty" aria-hidden="true" /> : <div className="ar-bar" aria-hidden="true"><span style={{ width: `${Math.round(category.ratio * 100)}%` }} /></div>}
      <p>{category.summary}</p>
    </article>
  );
}

export function AuditScoreSummary({ categories, state }: { categories: AuditReportModel["categories"]; state: AuditReportModel["state"] }) {
  if (categories.length === 0) return null;
  return (
    <section className="ar-section" aria-label="Score summary">
      <h2>Score summary</h2>
      {state === "blocked" ? <p className="ar-lead">Categories that depend on reading the website were not evaluated. They are not scored as zero.</p> : null}
      <div className="ar-categories">{categories.map((category) => <AuditCategoryCard key={category.key} category={category} />)}</div>
    </section>
  );
}
