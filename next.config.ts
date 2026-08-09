import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,

  // FIX 5.3 (master-document-audit.md): next/image was never configured to
  // accept the external hosts this app actually renders (Drive thumbnails,
  // Google user-content avatars), which is why raw <img> was used everywhere.
  images: {
    qualities: [75, 85],
    remotePatterns: [
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // FIX 1.7: 'unsafe-inline' removed from script-src in production.
              // Next.js needs 'unsafe-eval' only in dev (fast refresh); keep
              // that dev-only. If any inline <script> is required in prod,
              // switch to a per-request nonce instead of re-adding unsafe-inline.
              `script-src 'self'${
                isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""
              }`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // FIX 1.8: img-src no longer allows arbitrary https: origins —
              // restricted to the hosts this app actually uses.
              "img-src 'self' data: blob: https://lh3.googleusercontent.com https://drive.google.com https://*.supabase.co",
              "frame-src 'self' blob: https://drive.google.com https://docs.google.com https://view.officeapps.live.com",
              "media-src 'self' blob: https://drive.google.com https://content.googleapis.com",

              [
                "connect-src",
                "'self'",
                "https://www.googleapis.com",
                "https://oauth2.googleapis.com",
                "https://drive.google.com",
                "https://content.googleapis.com",
                "https://lh3.googleusercontent.com",
                supabaseUrl,
                "https://*.supabase.co",
                "wss://*.supabase.co",
              ]
                .filter(Boolean)
                .join(" "),
              "form-action 'self' https://accounts.google.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
