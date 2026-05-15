import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

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
              // Next.js needs 'unsafe-inline' for its inline scripts in dev;
              // in prod you can lock this down further with a nonce (see note below)
              `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
              "style-src 'self' 'unsafe-inline'",   // Tailwind/CSS-in-JS needs this
              "img-src 'self' data: blob: https:",  // adjust to your CDN/avatar hosts
              "font-src 'self'",
              "form-action 'self' https://accounts.google.com", // for GDrive OAuth
              "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
              // Supabase — replace with your actual project URL
              `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} wss://*.supabase.co`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          // Belt-and-suspenders headers while you're here
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