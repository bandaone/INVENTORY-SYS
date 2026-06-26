'use client';

import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTheme } from '@/components/ThemeProvider';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const PALETTE = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399'];

interface TrendData {
  labels: string[];
  datasets: { label: string; data: number[]; color: string }[];
}

export default function SalesTrendChart() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sales-trend')
      .then(r => r.json())
      .then(data => { setTrend(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const gridColor   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const tickColor   = isDark ? '#94a3b8' : '#64748b';
  const tooltipBg   = isDark ? 'rgba(15,17,21,0.95)' : 'rgba(255,255,255,0.98)';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '240px', color: 'var(--text-muted)', gap: '8px' }}>
      <Loader2 size={18} className="spin" /> Loading chart data...
    </div>
  );

  if (!trend || trend.datasets.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '240px', color: 'var(--text-muted)', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontWeight: 600 }}>No sales data yet</p>
      <p style={{ fontSize: '13px' }}>Complete a sale from the POS to see your trend here.</p>
    </div>
  );

  const chartData = {
    labels: trend.labels,
    datasets: trend.datasets.map((ds, i) => {
      const color = PALETTE[i % PALETTE.length];
      const fill  = color + (isDark ? '18' : '14');
      return {
        label: ds.label,
        data: ds.data,
        borderColor: color,
        backgroundColor: fill,
        fill: true,
        tension: 0.45,
        pointRadius: 4,
        pointBackgroundColor: color,
        pointBorderColor: isDark ? '#0f1115' : '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
      };
    }),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top', align: 'end',
        labels: { color: tickColor, font: { family: 'Outfit', size: 12, weight: 500 }, boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, padding: 16 },
      },
      tooltip: {
        backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
        titleColor: tooltipText, bodyColor: tickColor, padding: 14, cornerRadius: 10,
        titleFont: { family: 'Outfit', size: 13, weight: 600 },
        bodyFont: { family: 'Outfit', size: 12 },
        callbacks: {
          label: (ctx) => {
            const value = ctx.parsed.y ?? 0;
            return ` ${ctx.dataset.label}: K${value.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { color: gridColor, drawTicks: false }, border: { display: false }, ticks: { color: tickColor, font: { family: 'Outfit', size: 12 }, padding: 8 } },
      y: { grid: { color: gridColor, drawTicks: false }, border: { display: false }, ticks: { color: tickColor, font: { family: 'Outfit', size: 12 }, padding: 10, callback: (v) => `K${Number(v).toLocaleString()}` } },
    },
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '240px' }}>
      <Line data={chartData} options={options} />
    </div>
  );
}
