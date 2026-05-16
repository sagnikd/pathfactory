'use client'

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'

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
