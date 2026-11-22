import { useId } from "react";
import type { Dashboard } from "@enforcer/shared";

const fraction = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const dateOf = (date: string) =>
  new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
const dateLabel = (date: string) =>
  dateOf(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function ActivityTimeline({
  timeline,
}: {
  timeline: Dashboard["timeline"];
}) {
  const descriptionId = useId();
  const data = [...timeline]
    .filter((point) => Number.isFinite(dateOf(point.date).getTime()))
    .sort((a, b) => dateOf(a.date).getTime() - dateOf(b.date).getTime());
  if (!data.length)
    return (
      <p className="text-sm text-gray-500">
        Progress history will appear after the first check-in.
      </p>
    );
  const first = dateOf(data[0].date).getTime(),
    last = dateOf(data[data.length - 1].date).getTime();
  const points = data.map((point) => ({
    ...point,
    x:
      last === first
        ? 182
        : 60 + ((dateOf(point.date).getTime() - first) / (last - first)) * 245,
    y: 150 - fraction(point.overallProgress) * 120,
  }));
  return (
    <div>
      <svg
        viewBox="0 0 320 175"
        role="img"
        aria-label="Overall project progress over time"
        aria-describedby={descriptionId}
        className="block w-full"
      >
        <desc id={descriptionId}>
          Points-weighted project completion from {dateLabel(data[0].date)} to{" "}
          {dateLabel(data[data.length - 1].date)}. Exact values are available in
          the progress data table.
        </desc>
        {[0, 0.5, 1].map((value) => (
          <g key={value}>
            <line
              x1="60"
              x2="305"
              y1={150 - value * 120}
              y2={150 - value * 120}
              stroke="var(--line)"
            />
            <text
              x="48"
              y={155 - value * 120}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="16"
            >
              {value * 100}%
            </text>
          </g>
        ))}
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="var(--umber)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.date}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3.5"
            fill="var(--umber)"
          >
            <title>
              {dateLabel(point.date)}:{" "}
              {Math.round(fraction(point.overallProgress) * 100)}%
            </title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between gap-3 text-xs text-gray-500">
        <span>{dateLabel(data[0].date)}</span>
        {data.length > 1 && (
          <span>{dateLabel(data[data.length - 1].date)}</span>
        )}
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium text-blue-700">
          View progress data
        </summary>
        <table role="table" className="stack-table mt-3 w-full text-left">
          <caption className="sr-only">
            Overall project completion over time
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col" className="py-2">
                Date
              </th>
              <th role="columnheader" scope="col">
                Project completion
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {data.map((point, index) => (
              <tr
                role="row"
                key={`${point.date}-${index}`}
                className="border-t border-gray-100"
              >
                <th role="rowheader" scope="row" className="py-2 font-normal">
                  {dateLabel(point.date)}
                </th>
                <td role="cell" data-label="Project completion">
                  {Math.round(fraction(point.overallProgress) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
