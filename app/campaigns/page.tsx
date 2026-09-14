import Link from "next/link";

import Link from "next/link";

import { getCampaigns } from "@/data/crm";
import { getCandidateCounts } from "@/data/discovery";
import { campaignStatusLabel } from "@/domain/crm";
import { getWorkspaceContext } from "@/domain/workspaces";
import { createCampaignAction } from "./actions";

export default async function CampaignsPage() {
  const workspaceId = getWorkspaceContext().workspaceId;
  const campaigns = await getCampaigns(workspaceId);
  const candidateCounts = await getCandidateCounts(workspaceId, campaigns.map((campaign) => campaign.id));

  return <main className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">CRM / Campaigns</div><h1>Campaigns</h1><p>Organise prospecting work by service, territory, and qualification policy.</p></div></div>
    <section className="panel"><div className="panel-header"><div><h2>Create campaign</h2><p>Save a basic workspace-scoped campaign record.</p></div></div><form action={createCampaignAction}><label htmlFor="campaign-name">Name</label><input id="campaign-name" name="name" required /><label htmlFor="campaign-categories">Categories</label><input id="campaign-categories" name="targetCategories" placeholder="roofing, plumbing" /><label htmlFor="campaign-locations">Locations</label><input id="campaign-locations" name="targetLocations" placeholder="Uxbridge, London" /><label htmlFor="campaign-website-filter">Website filter</label><select id="campaign-website-filter" name="websiteFilter" defaultValue="any"><option value="any">Any website</option><option value="no_website">No website</option><option value="weak_website">Weak website</option></select><button type="submit">Create campaign</button></form></section>
    {campaigns.length === 0 ? <div className="empty-state"><h2>No campaigns yet</h2><p>Created campaigns will appear here after the form is submitted. Open a campaign to run discovery.</p></div> : <section className="panel"><div className="panel-header"><div><h2>All campaigns</h2><p>{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Territory</th><th>Categories</th><th>Candidates</th><th>Created</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><Link className="primary-link" href={`/campaigns/${campaign.id}`}>{campaign.name}</Link></td><td><span className="status-pill">{campaignStatusLabel(campaign.status)}</span></td><td>{campaign.target_locations.join(", ") || "Not set"}</td><td>{campaign.target_categories.join(", ") || "Not set"}</td><td>{candidateCounts.get(campaign.id) ?? 0}</td><td>{new Date(campaign.created_at).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div></section>}
  </main>;
}
