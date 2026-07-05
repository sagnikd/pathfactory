'use client'

import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Pie, PieChart, Cell, Legend } from 'recharts'

type FunnelDataPoint = {
  name: string
  views: number
}

export default function AnalyticsCharts({ funnelData }: { funnelData: FunnelDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={funnelData}>
        <XAxis
          dataKey="name"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}`}
        />
        <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
        <Bar dataKey="views" fill="#007381" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

type CampaignDataPoint = {
  source: string
  sessions: number
}

const DONUT_COLORS = ['#007381', '#3fa9b5', '#7bc4cc', '#c7935e', '#9c6b4f', '#6b7280']

export function CampaignDonut({ data }: { data: CampaignDataPoint[] }) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  if (data.length === 0 || data.every(d => d.sessions === 0)) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No campaign traffic yet.</p>
  }

  const toggle = (source: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  // Zero out excluded slices rather than removing them from `data` — keeps
  // every source in the legend (so a hidden one stays clickable to re-show)
  // while the donut itself re-proportions around only the visible slices.
  const chartData = data.map(d => ({ ...d, sessions: excluded.has(d.source) ? 0 : d.sessions }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="sessions"
          nameKey="source"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          onClick={(entry) => toggle(String(entry.payload?.source))}
          cursor="pointer"
        >
          {chartData.map((entry, i) => (
            <Cell key={entry.source} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend
          onClick={(entry) => toggle(String(entry.value))}
          formatter={(value) => (
            <span style={{
              cursor: 'pointer',
              opacity: excluded.has(String(value)) ? 0.4 : 1,
              textDecoration: excluded.has(String(value)) ? 'line-through' : 'none',
            }}>
              {value}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
