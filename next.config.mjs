import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Stamped at build time, so every deploy automatically updates the footer.
const buildTime = new Date()
  .toISOString()
  .replace("T", " ")
  .replace(/:\d\d\..+$/, " UTC");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  experimental: {
    // pdf-parse loads its vendored pdf.js via a dynamic require that breaks
    // under webpack's production bundle ("bad XRef entry" on valid PDFs).
    // Keeping it external makes it run as a plain Node dependency.
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;
