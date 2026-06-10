/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse loads its vendored pdf.js via a dynamic require that breaks
    // under webpack's production bundle ("bad XRef entry" on valid PDFs).
    // Keeping it external makes it run as a plain Node dependency.
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;
