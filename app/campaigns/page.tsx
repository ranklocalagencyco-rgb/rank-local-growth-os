import { getCampaigns } from "@/data/crm";
import { campaignStatusLabel } from "@/domain/crm";
import { getWorkspaceContext } from "@/domain/workspaces";
import { createCampaignAction } from "./actions";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns(getWorkspaceContext().workspaceId);

  return <main className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">CRM / Campaigns</div><h1>Campaigns</h1><p>Organise prospecting work by service, territory, and qualification policy.</p></div></div>
    <section className="panel"><div className="panel-header"><div><h2>Create campaign</h2><p>Save a basic workspace-scoped campaign record.</p></div></div><form action={createCampaignAction}><label htmlFor="campaign-name">Name</label><input id="campaign-name" name="name" required /><label htmlFor="campaign-categories">Categories</label><input id="campaign-categories" name="targetCategories" placeholder="roofing, plumbing" /><label htmlFor="campaign-locations">Locations</label><input id="campaign-locations" name="targetLocations" placeholder="Uxbridge, London" /><label htmlFor="campaign-website-filter">Website filter</label><select id="campaign-website-filter" name="websiteFilter" defaultValue="any"><option value="any">Any website</option><option value="no_website">No website</option><option value="weak_website">Weak website</option></select><button type="submit">Create campaign</button></form></section>
    {campaigns.length === 0 ? <div className="empty-state"><h2>No campaigns yet</h2><p>Created campaigns will appear here after the form is submitted.</p></div> : <section className="panel"><div className="panel-header"><div><h2>All campaigns</h2><p>{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Territory</th><th>Categories</th><th>Created</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong></td><td><span className="status-pill">{campaignStatusLabel(campaign.status)}</span></td><td>{campaign.target_locations.join(", ") || "Not set"}</td><td>{campaign.target_categories.join(", ") || "Not set"}</td><td>{new Date(campaign.created_at).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div></section>}
  </main>;
}
