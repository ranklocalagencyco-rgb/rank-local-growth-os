import Link from "next/link";

import { getProspects } from "@/data/crm";
import { formatLocation, prospectStatusLabel } from "@/domain/crm";
import { websiteStateLabel, websiteStateTone } from "@/domain/discovery";
import { getWorkspaceContext } from "@/domain/workspaces";
import { createProspectAction } from "./actions";

export default async function ProspectsPage() {
  const prospects = await getProspects(getWorkspaceContext().workspaceId);

  return <main className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">CRM / Prospects</div><h1>Prospects</h1><p>Canonical business records, source provenance, pipeline state, and compliance visibility.</p></div></div>
    <section className="panel"><div className="panel-header"><div><h2>Create prospect</h2><p>Save a basic canonical business record.</p></div></div><form action={createProspectAction}><label htmlFor="prospect-name">Business name</label><input id="prospect-name" name="displayName" required /><label htmlFor="prospect-domain">Website domain</label><input id="prospect-domain" name="canonicalDomain" placeholder="example.co.uk" /><label htmlFor="prospect-email">Primary email</label><input id="prospect-email" name="primaryEmail" type="email" /><label htmlFor="prospect-phone">Primary phone</label><input id="prospect-phone" name="primaryPhone" /><label htmlFor="prospect-city">City</label><input id="prospect-city" name="city" /><label htmlFor="prospect-region">Region</label><input id="prospect-region" name="region" /><label htmlFor="prospect-postcode">Postcode</label><input id="prospect-postcode" name="postcode" /><button type="submit">Create prospect</button></form></section>
    {prospects.length === 0 ? <div className="empty-state"><h2>No prospects yet</h2><p>Created prospects will appear here after the form is submitted.</p></div> : <section className="panel"><div className="panel-header"><div><h2>All prospects</h2><p>{prospects.length} prospect{prospects.length === 1 ? "" : "s"}</p></div></div><div className="table-wrap"><table><thead><tr><th>Business</th><th>Location</th><th>Website</th><th>Status</th><th>Score</th><th>Updated</th></tr></thead><tbody>{prospects.map((prospect) => <tr key={prospect.id}><td><Link className="primary-link" href={`/prospects/${prospect.id}`}>{prospect.display_name}</Link><div className="muted">{prospect.canonical_domain || "No domain recorded"}</div></td><td>{formatLocation(prospect)}</td><td><span className={`status-pill tone-${websiteStateTone(prospect.website_state)}`}>{websiteStateLabel(prospect.website_state)}</span></td><td><span className="status-pill">{prospectStatusLabel(prospect.status)}</span></td><td>{prospect.current_opportunity_score ?? "-"}</td><td>{new Date(prospect.updated_at).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div></section>}
  </main>;
}
