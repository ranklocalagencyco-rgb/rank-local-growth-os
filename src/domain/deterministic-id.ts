import { createHash } from "node:crypto";

/**
 * Derives a stable UUID from a namespace and input so retried background work
 * re-creates the same row instead of a duplicate (insert ... on conflict do nothing).
 */
export function deterministicUuid(namespace: string, input: string): string {
  const hex = createHash("sha256").update(`${namespace}:${input}`).digest("hex").slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}`;
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function valueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
