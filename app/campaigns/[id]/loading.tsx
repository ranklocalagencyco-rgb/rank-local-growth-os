export default function CampaignDetailLoading() {
  return (
    <main className="page-shell" aria-busy="true">
      <div className="back-link skeleton-text">Loading campaign</div>
      <div className="page-heading"><div><div className="eyebrow">Campaign</div><h1 className="skeleton-block">Loading…</h1><p className="muted">Fetching discovery status and candidates.</p></div></div>
      <section className="stats"><div className="stat"><span>Discovery status</span><strong>…</strong></div><div className="stat"><span>Candidates</span><strong>…</strong></div><div className="stat"><span>Prospects</span><strong>…</strong></div></section>
      <div className="empty-state"><p>Loading candidates…</p></div>
    </main>
  );
}
