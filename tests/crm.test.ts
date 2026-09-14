import { describe, expect, it } from "vitest";

import { formatLocation, normalizeBusinessName, parseCampaignForm, parseProspectForm } from "@/domain/crm";

 describe("CRM domain helpers", () => {
  it("normalizes business names for deterministic matching", () => {
    expect(normalizeBusinessName("  A&B Roofing  Ltd. ")).toBe("a b roofing ltd");
  });

  it("formats the most useful available location fields", () => {
    expect(formatLocation({ city: "Uxbridge", region: "London", postcode: "UB8" })).toBe("Uxbridge, London, UB8");
    expect(formatLocation({ city: null, region: null, postcode: null })).toBe("Location not recorded");
  });

  it("parses the minimum campaign and prospect create forms", () => {
    const campaignForm = new FormData();
    campaignForm.append("name", "West London Roofers");
    campaignForm.append("targetCategories", "roofing, plumbing");
    campaignForm.append("targetLocations", "Uxbridge, London");
    campaignForm.append("websiteFilter", "any");
    const prospectForm = new FormData();
    prospectForm.append("displayName", "A&B Roofing Ltd");
    prospectForm.append("city", "Uxbridge");

    const campaign = parseCampaignForm(campaignForm);
    const prospect = parseProspectForm(prospectForm);

    expect(campaign.targetCategories).toEqual(["roofing", "plumbing"]);
    expect(campaign.targetLocations).toEqual(["Uxbridge", "London"]);
    expect(prospect.displayName).toBe("A&B Roofing Ltd");
    expect(prospect.city).toBe("Uxbridge");
  });
});
