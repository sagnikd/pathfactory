import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdfjs-dist out of the server bundle so it runs as native Node modules
  // (worker resolution + require.resolve only work when not bundled by Turbopack)
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Allow PathFactory to embed YouTube, Vimeo, and external pages in iframes
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
              "style-src 'self' 'unsafe-inline' https://fonts.cdnfonts.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.cdnfonts.com",
              "media-src 'self' blob: https:",
              // Allow the PDF worker served from /public
              "worker-src 'self' blob:",
              // Allow embedding YouTube, Vimeo, and any https page in iframes
              "frame-src 'self' https://www.youtube.com https://player.vimeo.com https:",
              // Allow fetching from Supabase and external APIs
              "connect-src 'self' https:",
            ].join("; "),
          },
        ],
      },
      {
        // Prevent authenticated dashboard pages from being served from bfcache
        // after logout — a hard reload would 307→/login but the stale in-memory
        // paint would expose real lead/asset data to the next user on a shared machine.
        source: "/dashboard(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
