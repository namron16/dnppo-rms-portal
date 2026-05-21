// components/ui/PriorityBadge.tsx
// Priority badge for documents

import React from 'react'

type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent'

const priorityConfig: Record<
  PriorityLevel,
  { label: string; color: string; bgColor: string }
> = {
  low: {
    label: 'Low',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
  medium: {
    label: 'Medium',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  high: {
    label: 'High',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  urgent: {
    label: 'Urgent',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
}

interface PriorityBadgeProps {
  priority: PriorityLevel
  size?: 'sm' | 'md'
}

export function PriorityBadge({ priority, size = 'sm' }: PriorityBadgeProps) {
  const config = priorityConfig[priority]
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  }

  return (
    <span className={`inline-block font-medium rounded ${config.bgColor} ${config.color} ${sizeClasses[size]}`}>
      {config.label}
    </span>
  )
}
