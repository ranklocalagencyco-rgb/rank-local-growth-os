import type { Campaign, Prospect } from "@/db/types";

export type CampaignFormInput = {
  name: string;
  targetCategories: string[];
  targetLocations: string[];
  websiteFilter: string;
};

export type ProspectFormInput = {
  displayName: string;
  canonicalDomain: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  countryCode: string;
  region: string | null;
  city: string | null;
  postcode: string | null;
};

export function normalizeBusinessName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function listValue(formData: FormData, key: string): string[] {
  return formValue(formData, key).split(",").map((value) => value.trim()).filter(Boolean);
}

export function parseCampaignForm(formData: FormData): CampaignFormInput {
  const name = formValue(formData, "name");
  if (!name) throw new Error("Campaign name is required");

  return {
    name,
    targetCategories: listValue(formData, "targetCategories"),
    targetLocations: listValue(formData, "targetLocations"),
    websiteFilter: formValue(formData, "websiteFilter") || "any",
  };
}

export function parseProspectForm(formData: FormData): ProspectFormInput {
  const displayName = formValue(formData, "displayName");
  if (!displayName) throw new Error("Business name is required");

  return {
    displayName,
    canonicalDomain: formValue(formData, "canonicalDomain") || null,
    primaryPhone: formValue(formData, "primaryPhone") || null,
    primaryEmail: formValue(formData, "primaryEmail") || null,
    countryCode: formValue(formData, "countryCode") || "GB",
    region: formValue(formData, "region") || null,
    city: formValue(formData, "city") || null,
    postcode: formValue(formData, "postcode") || null,
  };
}

export function campaignStatusLabel(status: Campaign["status"]): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function prospectStatusLabel(status: Prospect["status"]): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatLocation(prospect: Pick<Prospect, "city" | "region" | "postcode">): string {
  return [prospect.city, prospect.region, prospect.postcode].filter(Boolean).join(", ") || "Location not recorded";
}

export function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}
