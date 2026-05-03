import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
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
    ];
  },
};

export default nextConfig;
