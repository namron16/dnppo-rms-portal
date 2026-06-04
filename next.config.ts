import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Supabase project URL — used in connect-src.
// The storage API lives at the same hostname as the Supabase project URL
// (e.g. https://xxxx.supabase.co) so we just reuse NEXT_PUBLIC_SUPABASE_URL.
// Signed download URLs also come from this origin.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "form-action 'self' https://accounts.google.com",
              // connect-src:
              //   • 'self'                    — API routes, same origin
              //   • googleapis / oauth2       — Google Drive + OAuth
              //   • supabaseUrl               — Supabase DB, Auth, Realtime
              //   • *.supabase.co (storage)   — Supabase Storage signed URLs
              //     Signed download URLs are served from
              //     <project-ref>.supabase.co which matches the wildcard.
              //     We also include the explicit project URL for safety.
              //   • wss://*.supabase.co       — Supabase Realtime websocket
              [
                "connect-src",
                "'self'",
                "https://www.googleapis.com",
                "https://oauth2.googleapis.com",
                supabaseUrl,
                // Supabase Storage signed URLs share the project hostname,
                // already covered by supabaseUrl above, but the wildcard
                // covers any edge / CDN hostnames Supabase may use.
                "https://*.supabase.co",
                "wss://*.supabase.co",
              ].filter(Boolean).join(" "),
              "frame-ancestors 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options",        value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",     value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;