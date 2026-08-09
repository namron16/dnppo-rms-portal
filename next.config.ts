import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  images: { qualities: [75, 85] },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // FIX 1.7 (gdrive-recovery-system-user-logs-audit-report.md):
              // 'unsafe-inline' on script-src defeats most of CSP's XSS
              // protection. Dev keeps 'unsafe-inline' + 'unsafe-eval' for
              // Next.js's dev-mode hot reload / fast refresh scripts; the
              // production build drops both. If a real need for an inline
              // script arises in production, use a per-request nonce
              // instead of re-adding 'unsafe-inline'.
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
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
