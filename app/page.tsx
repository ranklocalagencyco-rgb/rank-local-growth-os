import Link from "next/link";

import { getRuntimeConfig } from "@/config/env";
import { getCampaigns, getProspects } from "@/data/crm";
import { getWorkspaceContext } from "@/domain/workspaces";

export default async function HomePage() {
  const config = getRuntimeConfig();
  const workspaceId = getWorkspaceContext().workspaceId;
  const [campaigns, prospects] = await Promise.all([getCampaigns(workspaceId), getProspects(workspaceId)]);

  return <main className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">Growth command centre</div><h1>Good work starts with a clear pipeline.</h1><p>Track campaigns, keep prospect records grounded in source data, and preserve operator control as the system grows.</p></div></div>
    <section className="stats"><div className="stat"><span>Campaigns</span><strong>{campaigns.length}</strong></div><div className="stat"><span>Prospects</span><strong>{prospects.length}</strong></div><div className="stat"><span>Send mode</span><strong>{config.sendMode}</strong></div></section>
    <section className="panel"><div className="panel-header"><div><h2>Start here</h2><p>The CRM foundation is ready for workspace-scoped records.</p></div></div><div className="table-wrap"><table><tbody><tr><td><Link className="primary-link" href="/campaigns">Review campaigns</Link></td><td className="muted">See territory and qualification configuration.</td></tr><tr><td><Link className="primary-link" href="/prospects">Review prospects</Link></td><td className="muted">Open canonical records and their compliance surface.</td></tr></tbody></table></div></section>
  </main>;
}
