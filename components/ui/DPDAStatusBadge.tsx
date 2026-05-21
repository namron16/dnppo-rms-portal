// components/ui/DPDAStatusBadge.tsx
// Status badge for DPDA document review

import React from 'react'

type StatusType = 'pending' | 'approved' | 'disapproved' | 'returned_with_comments' | 'returned'

const statusConfig: Record<
  StatusType,
  { label: string; color: string; bgColor: string; icon: string }
> = {
  pending: {
    label: 'Pending Review',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    icon: '⏳',
  },
  approved: {
    label: 'Approved',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    icon: '✓',
  },
  disapproved: {
    label: 'Disapproved',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    icon: '✕',
  },
  returned_with_comments: {
    label: 'Returned with Comments',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    icon: '💬',
  },
  returned: {
    label: 'Returned to Sender',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
    icon: '↩',
  },
}

interface DPDAStatusBadgeProps {
  status: StatusType
  size?: 'sm' | 'md' | 'lg'
}

export function DPDAStatusBadge({ status, size = 'md' }: DPDAStatusBadgeProps) {
  const config = statusConfig[status]

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-full ${config.bgColor} ${config.color} ${sizeClasses[size]}`}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  )
}
