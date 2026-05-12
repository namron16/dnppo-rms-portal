'use client'
// components/layout/AuthGuard.tsx

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

interface AuthGuardProps {
  requiredRole?: 'admin' | 'officer' | 'any'
  children: React.ReactNode
}

export function AuthGuard({ requiredRole = 'any', children }: AuthGuardProps) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
  if (isLoading) return
  if (!user) {
    router.replace('/login')
    return
  }
}, [user, isLoading, router])

  if (isLoading || !user) {
    return <LoadingSpinner fullPage />
  }

  return <>{children}</>
}