// e.g. app/admin/master/loading.tsx
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export default function Loading() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 56px)' }}>
      <LoadingSpinner size="lg" />
    </div>
  )
}