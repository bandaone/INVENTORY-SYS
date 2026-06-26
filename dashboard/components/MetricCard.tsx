import { TrendingUp, TrendingDown } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  delay?: string;
}

export default function MetricCard({ title, value, trend, trendUp, delay = '' }: MetricCardProps) {
  return (
    <div className={`glass-panel animate-fade-in ${delay}`}>
      <div className="metric-label">{title}</div>
      <div className="metric-value">{value}</div>
      
      {trend && (
        <div className={`trend-badge ${trendUp ? 'trend-up' : 'trend-down'}`}>
          {trendUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {trend}
        </div>
      )}
    </div>
  );
}
