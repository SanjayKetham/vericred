import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Charts read their colours from the CSS custom properties in index.css, so light and dark mode have a
 * single source of truth and the validated palette is never duplicated in JS.
 */
function useTokens() {
  const read = () => {
    if (typeof window === 'undefined') return null;
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      series1: token('--series-1', '#2a78d6'),
      series2: token('--series-2', '#d03b3b'),
      accent: token('--accent', '#1d4ed8'),
      grid: token('--grid', '#e8eef6'),
      axis: token('--axis', '#cfdbe9'),
      muted: token('--text-muted', '#7b8ca1'),
      secondary: token('--text-secondary', '#46566a'),
      surface: token('--surface-1', '#ffffff'),
      primary: token('--text-primary', '#0b1b2b'),
      good: token('--status-good', '#0ca30c'),
      ramp: [
        token('--ramp-0', '#eef3f9'),
        token('--ramp-1', '#cde2fb'),
        token('--ramp-2', '#9ec5f4'),
        token('--ramp-3', '#5598e7'),
        token('--ramp-4', '#2a78d6'),
        token('--ramp-5', '#184f95'),
      ],
    };
  };

  const [tokens, setTokens] = useState(read);

  useEffect(() => {
    const update = () => setTokens(read());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);

  return tokens ?? read()!;
}

/**
 * Recharts' ResponsiveContainer measures once on mount and, inside a CSS grid cell, can latch onto a
 * width of nearly zero before layout settles — silently rendering a chart a few pixels wide. Measuring
 * the wrapper ourselves removes that race: the chart renders only once a real width exists.
 */
function ChartFrame({ height, children }: { height: number; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }} className="min-w-0">
      {width > 0 ? children(width) : null}
    </div>
  );
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}
    >
      {label && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: entry.color }} />
          <span className="ink-secondary">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- donut */

/**
 * A single headline proportion. One number is the job, so the ring frames the value rather than being
 * a chart to read off — the figure sits in the middle and the ring gives it scale.
 */
export function DonutGauge({
  value,
  label,
  size = 184,
  trackColor,
  valueColor,
}: {
  value: number;
  label: string;
  size?: number;
  trackColor?: string;
  valueColor?: string;
}) {
  const t = useTokens();
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${clamped.toFixed(1)} per cent ${label}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor ?? t.grid} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={valueColor ?? t.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-semibold leading-none tabular-nums">{clamped.toFixed(1)}%</span>
        <span className="ink-muted mt-1.5 text-xs">{label}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- area trend */

/** One measure over time, filled to the baseline. A single series needs no legend — the title names it. */
export function AreaTrend({
  data,
  dataKey,
  name,
  height = 200,
  tone = 'primary',
}: {
  data: Record<string, number | string>[];
  dataKey: string;
  name: string;
  height?: number;
  tone?: 'primary' | 'critical';
}) {
  const t = useTokens();
  const stroke = tone === 'critical' ? t.series2 : t.series1;
  const gradientId = `area-${dataKey}-${tone}`;

  return (
    <ChartFrame height={height}>
      {(width) => (
        <AreaChart width={width} height={height} data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.26} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.axis }} minTickGap={28} />
          <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip content={<TooltipBox />} cursor={{ stroke: t.axis, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={name}
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: t.surface }}
          />
        </AreaChart>
      )}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------- line trend */

/** Two measures of the same unit on one axis — never a second y-scale. */
export function DualTrend({
  data,
  keys,
  height = 240,
}: {
  data: Record<string, number | string>[];
  keys: { key: string; name: string; tone: 'primary' | 'critical' }[];
  height?: number;
}) {
  const t = useTokens();
  return (
    <ChartFrame height={height}>
      {(width) => (
        <LineChart width={width} height={height} data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.axis }} minTickGap={28} />
          <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip content={<TooltipBox />} cursor={{ stroke: t.axis, strokeWidth: 1 }} />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: t.secondary }} />
          {keys.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stroke={series.tone === 'critical' ? t.series2 : t.series1}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.surface }}
            />
          ))}
        </LineChart>
      )}
    </ChartFrame>
  );
}

/* ------------------------------------------------------------ sparkline */

/** A shape-only trend beside a headline figure: no axes, no grid, no labels. */
export function Sparkline({
  data,
  tone = 'primary',
  height = 76,
}: {
  data: { month: string; count: number }[];
  tone?: 'primary' | 'critical' | 'neutral';
  height?: number;
}) {
  const t = useTokens();
  const color = tone === 'critical' ? t.series2 : tone === 'neutral' ? t.secondary : t.series1;

  if (data.length < 2) {
    return (
      <div style={{ height }} className="ink-muted flex items-center text-xs">
        Not enough history
      </div>
    );
  }

  return (
    <ChartFrame height={height}>
      {(width) => {
        const values = data.map((d) => d.count);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const pad = 6;
        const stepX = (width - pad * 2) / (data.length - 1);
        const points = data.map((d, i) => {
          const x = pad + i * stepX;
          const y = pad + (1 - (d.count - min) / span) * (height - pad * 2);
          return [x, y] as const;
        });
        const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        const last = points[points.length - 1]!;
        return (
          <svg width={width} height={height} aria-hidden="true">
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} stroke={t.surface} strokeWidth={2} />
          </svg>
        );
      }}
    </ChartFrame>
  );
}

/* -------------------------------------------------------------- heatmap */

/**
 * Daily volume as a calendar grid. Magnitude is a single hue, light to dark — never a rainbow — and
 * the exact count sits in the title of every cell, so the value is reachable without colour.
 */
export function ActivityHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const t = useTokens();
  if (data.length === 0) return <p className="ink-muted py-6 text-center text-sm">No activity recorded.</p>;

  const max = Math.max(...data.map((d) => d.count), 1);
  const step = (count: number) => {
    if (count === 0) return t.ramp[0]!;
    const ratio = count / max;
    if (ratio <= 0.2) return t.ramp[1]!;
    if (ratio <= 0.4) return t.ramp[2]!;
    if (ratio <= 0.65) return t.ramp[3]!;
    if (ratio <= 0.85) return t.ramp[4]!;
    return t.ramp[5]!;
  };

  // Columns are weeks, rows are weekdays; the series runs oldest to newest.
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7));
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div>
      <div className="flex gap-[5px]">
        <div className="flex flex-col gap-[5px] pr-1">
          {dayLabels.map((label, i) => (
            <span key={i} className="ink-muted flex h-[18px] items-center text-[10px] leading-none">
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[5px]">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week[di];
              if (!cell) return <span key={di} className="h-[18px] w-[18px]" />;
              return (
                <span
                  key={di}
                  className="h-[18px] w-[18px] rounded-[5px]"
                  style={{ background: step(cell.count) }}
                  title={`${cell.date}: ${cell.count} verification${cell.count === 1 ? '' : 's'}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="ink-muted mt-3 flex items-center justify-end gap-1.5 text-[11px]">
        <span>Less</span>
        {t.ramp.map((color, i) => (
          <span key={i} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: color }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- category bars */

/**
 * Ranked magnitude across named categories: horizontal bars, one series, direct value labels.
 * Values render as a right-hand category axis rather than Recharts' LabelList, which in a vertical
 * layout positions labels against the plot area instead of their own bar row.
 */
export function CategoryBars({
  data,
  highlight,
  height = 220,
}: {
  data: { label: string; value: number }[];
  highlight?: (label: string) => boolean;
  height?: number;
}) {
  const t = useTokens();
  if (data.length === 0) return <p className="ink-muted py-8 text-center text-sm">No data.</p>;
  const max = Math.max(...data.map((d) => d.value));
  const valueByLabel = new Map(data.map((d) => [d.label, d.value]));

  return (
    <ChartFrame height={height}>
      {(width) => (
        <BarChart
          width={width}
          height={height}
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 4, bottom: 4, left: 8 }}
          barCategoryGap={6}
        >
          <CartesianGrid stroke={t.grid} horizontal={false} />
          <XAxis type="number" domain={[0, max * 1.08]} hide />
          <YAxis
            yAxisId="category"
            type="category"
            dataKey="label"
            tick={{ fill: t.secondary, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.axis }}
            width={150}
          />
          <YAxis
            yAxisId="values"
            orientation="right"
            type="category"
            dataKey="label"
            tick={{ fill: t.primary, fontSize: 11, fontWeight: 600 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(label: string) => (valueByLabel.get(label) ?? 0).toLocaleString()}
          />
          <Tooltip content={<TooltipBox />} cursor={{ fill: t.grid, fillOpacity: 0.5 }} />
          <Bar yAxisId="category" dataKey="value" name="Count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.label} fill={highlight?.(entry.label) ? t.series2 : t.series1} stroke={t.surface} strokeWidth={2} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartFrame>
  );
}

/** A labelled share row — used where a full chart would be more furniture than information. */
export function ShareRows({ data }: { data: { label: string; value: number }[] }) {
  const t = useTokens();
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <ul className="space-y-3">
      {data.map((row) => {
        const pct = (100 * row.value) / total;
        return (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="ink-secondary truncate">{row.label}</span>
              <span className="font-semibold tabular-nums">{pct.toFixed(0)}%</span>
            </div>
            <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-full" style={{ background: t.grid }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.series1 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Tabular fallback so every chart's numbers are also readable without colour. */
export function DataTable({ data, caption }: { data: { label: string; value: number }[]; caption: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <table className="w-full text-xs">
      <caption className="ink-muted mb-2 text-left">{caption}</caption>
      <thead>
        <tr className="ink-muted border-b text-left" style={{ borderColor: 'var(--border)' }}>
          <th className="py-1 font-medium">Category</th>
          <th className="py-1 text-right font-medium">Count</th>
          <th className="py-1 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.label} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
            <td className="py-1">{row.label}</td>
            <td className="py-1 text-right tabular-nums">{row.value.toLocaleString()}</td>
            <td className="ink-muted py-1 text-right tabular-nums">
              {total === 0 ? '—' : `${((100 * row.value) / total).toFixed(1)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
