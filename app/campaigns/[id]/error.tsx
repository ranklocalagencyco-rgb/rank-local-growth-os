"use client";

import Link from "next/link";

export default function CampaignDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-shell">
      <Link className="back-link" href="/campaigns">← Back to campaigns</Link>
      <div className="empty-state danger">
        <h2>Unable to load this campaign</h2>
        <p>{error.message || "Something went wrong while loading discovery data."}</p>
        {error.digest ? <p className="muted">Reference: {error.digest}</p> : null}
        <button type="button" className="button" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
