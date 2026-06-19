// app/layout.tsx
// ─────────────────────────────────────────────
// Root layout: wraps every page with:
//   - AuthProvider  (global user/session state)
//   - ToastProvider (global toast notifications)

import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider }  from '@/lib/auth'
import { ToastProvider } from '@/components/ui/Toast'

export const metadata: Metadata = {
  title: 'DNPPO Records Management System',
  description: 'Secure, centralized document management for Davao Norte Provincial Police Office personnel.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
