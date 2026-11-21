import { useId } from "react";
import type { Dashboard } from "@enforcer/shared";

const fraction = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const dateOf = (date: string) => new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
const dateLabel = (date: string) => dateOf(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function ActivityTimeline({ timeline }: { timeline: Dashboard["timeline"] }) {
  const descriptionId = useId();
  const data = [...timeline].filter((point) => Number.isFinite(dateOf(point.date).getTime())).sort((a, b) => dateOf(a.date).getTime() - dateOf(b.date).getTime());
  if (!data.length) return <p className="text-sm text-gray-500">Progress history will appear after the first check-in.</p>;
  const first = dateOf(data[0].date).getTime(), last = dateOf(data[data.length - 1].date).getTime();
  const points = data.map((point) => ({ ...point,
    x: last === first ? 400 : 50 + (dateOf(point.date).getTime() - first) / (last - first) * 720,
    y: 190 - fraction(point.overallProgress) * 160,
  }));
  return <div>
    <svg viewBox="0 0 800 220" role="img" aria-label="Overall project progress over time" aria-describedby={descriptionId} className="block w-full">
      <desc id={descriptionId}>Points-weighted project completion from {dateLabel(data[0].date)} to {dateLabel(data[data.length - 1].date)}. Exact values are available in the progress data table.</desc>
      {[0, 0.5, 1].map((value) => <g key={value}><line x1="50" x2="770" y1={190 - value * 160} y2={190 - value * 160} stroke="#e5e7eb" /><text x="40" y={194 - value * 160} textAnchor="end" fill="#6b7280" fontSize="13">{value * 100}%</text></g>)}
      <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r="4" fill="#2563eb"><title>{dateLabel(point.date)}: {Math.round(fraction(point.overallProgress) * 100)}%</title></circle>)}
    </svg>
    <div className="flex justify-between gap-3 text-xs text-gray-500"><span>{dateLabel(data[0].date)}</span>{data.length > 1 && <span>{dateLabel(data[data.length - 1].date)}</span>}</div>
    <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-blue-700">View progress data</summary>
      <table className="mt-3 w-full text-left"><caption className="sr-only">Overall project completion over time</caption><thead><tr><th scope="col" className="py-2">Date</th><th scope="col">Project completion</th></tr></thead>
        <tbody>{data.map((point, index) => <tr key={`${point.date}-${index}`} className="border-t border-gray-100"><th scope="row" className="py-2 font-normal">{dateLabel(point.date)}</th><td>{Math.round(fraction(point.overallProgress) * 100)}%</td></tr>)}</tbody>
      </table>
    </details>
  </div>;
}
