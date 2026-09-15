import type { NextConfig } from "next";

// GitHub Codespaces proxies the forwarded port, so the `origin` header the app
// sees (localhost:3000) never matches `x-forwarded-host` (*.app.github.dev).
// Next.js aborts Server Actions on that mismatch. Allow it only when the
// Codespaces env vars are present; this is a no-op everywhere else.
const codespaceName = process.env.CODESPACE_NAME;
const codespaceDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
const codespaceOrigins =
  codespaceName && codespaceDomain
    ? ["localhost:3000", `${codespaceName}-3000.${codespaceDomain}`]
    : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(codespaceOrigins.length > 0
    ? { experimental: { serverActions: { allowedOrigins: codespaceOrigins } } }
    : {}),
};

export default nextConfig;
