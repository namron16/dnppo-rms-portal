// components/dpda-inbox/DPDAFilterBar.tsx
// Filter, search, and sort controls for DPDA Inbox

'use client'

import React, { useState } from 'react'
import {
  Search,
  Filter,
  ChevronDown,
  X,
  ArrowUpDown,
} from 'lucide-react'

interface DPDAFilterBarProps {
  onSearch: (query: string) => void
  onStatusChange: (status: string) => void
  onSenderChange: (sender: string) => void
  onPriorityChange: (priority: string) => void
  onSortChange: (sort: string) => void
  activeStatus: string
  activeSender: string
  activePriority: string
  activeSort: string
}

const SENDERS = [
  { value: 'all', label: 'All Senders' },
  { value: 'P1', label: 'P1 - Records Officer' },
  { value: 'P2', label: 'P2 - Admin Officer' },
  { value: 'P3', label: 'P3 - Admin Officer' },
  { value: 'P4', label: 'P4 - Admin Officer' },
  { value: 'P5', label: 'P5 - Admin Officer' },
  { value: 'P6', label: 'P6 - Admin Officer' },
  { value: 'P7', label: 'P7 - Admin Officer' },
  { value: 'P8', label: 'P8 - Admin Officer' },
  { value: 'P9', label: 'P9 - Admin Officer' },
  { value: 'P10', label: 'P10 - Admin Officer' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'disapproved', label: 'Disapproved' },
  { value: 'returned_with_comments', label: 'Returned with Comments' },
  { value: 'returned', label: 'Returned to Sender' },
]

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest First' },
  { value: 'date-asc', label: 'Oldest First' },
  { value: 'priority-high', label: 'Highest Priority' },
  { value: 'sender', label: 'By Sender' },
]

export function DPDAFilterBar({
  onSearch,
  onStatusChange,
  onSenderChange,
  onPriorityChange,
  onSortChange,
  activeStatus,
  activeSender,
  activePriority,
  activeSort,
}: DPDAFilterBarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showMobileFilters, setShowMobileFilters] = useState(false)

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    onSearch(value)
  }

  const hasActiveFilters =
    activeStatus !== 'all' || activeSender !== 'all' || activePriority !== 'all'

  const activeFilterCount = [
    activeStatus !== 'all' ? 1 : 0,
    activeSender !== 'all' ? 1 : 0,
    activePriority !== 'all' ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="w-full relative">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by file title, sender, or notes..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder:text-slate-500"
        />
      </div>

      {/* Desktop Filters - Horizontal Layout */}
      <div className="hidden md:flex items-center gap-3 bg-white p-4 rounded-lg border border-slate-200">
        {/* Status Filter */}
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Status</label>
          <div className="relative">
            <select
              value={activeStatus}
              onChange={(e) => onStatusChange(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
          </div>
        </div>

        {/* Sender Filter */}
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Sender</label>
          <div className="relative">
            <select
              value={activeSender}
              onChange={(e) => onSenderChange(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
            >
              {SENDERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
          </div>
        </div>

        {/* Priority Filter */}
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Priority</label>
          <div className="relative">
            <select
              value={activePriority}
              onChange={(e) => onPriorityChange(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
          </div>
        </div>

        {/* Sort Filter */}
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Sort</label>
          <div className="relative">
            <select
              value={activeSort}
              onChange={(e) => onSortChange(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ArrowUpDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
          </div>
        </div>

        {/* Reset Filters Button */}
        {hasActiveFilters && (
          <div className="flex items-end">
            <button
              onClick={() => {
                onStatusChange('all')
                onSenderChange('all')
                onPriorityChange('all')
                onSortChange('date-desc')
              }}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-300 whitespace-nowrap"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Mobile Filters - Toggle */}
      <div className="md:hidden">
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
            showMobileFilters || hasActiveFilters
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
          }`}
        >
          <Filter className="w-4 h-4" />
          {hasActiveFilters ? 'Filters Active' : 'Show Filters'}
          {activeFilterCount > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-slate-900 text-white rounded-full font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Mobile Filter Panel */}
        {showMobileFilters && (
          <div className="mt-3 p-4 bg-white rounded-lg border border-slate-200 space-y-4">
            {/* Status Filter */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
              <div className="relative">
                <select
                  value={activeStatus}
                  onChange={(e) => onStatusChange(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
              </div>
            </div>

            {/* Sender Filter */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Sender</label>
              <div className="relative">
                <select
                  value={activeSender}
                  onChange={(e) => onSenderChange(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  {SENDERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
              </div>
            </div>

            {/* Priority Filter */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Priority</label>
              <div className="relative">
                <select
                  value={activePriority}
                  onChange={(e) => onPriorityChange(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
              </div>
            </div>

            {/* Sort Filter */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Sort By</label>
              <div className="relative">
                <select
                  value={activeSort}
                  onChange={(e) => onSortChange(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-8 border border-slate-300 rounded-lg text-slate-900 font-medium cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ArrowUpDown className="absolute right-2.5 top-2.5 w-4 h-4 pointer-events-none text-slate-600" />
              </div>
            </div>

            {/* Reset Button */}
            {hasActiveFilters && (
              <button
                onClick={() => {
                  onStatusChange('all')
                  onSenderChange('all')
                  onPriorityChange('all')
                  onSortChange('date-desc')
                }}
                className="w-full px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-300"
              >
                Reset All Filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
