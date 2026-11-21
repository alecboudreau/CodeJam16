interface TaskProgressProps {
  label: string;
  completion: number;
}

export default function TaskProgress({ label, completion }: TaskProgressProps) {
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(completion) ? completion : 0)) * 100);
  return <div>
    <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-medium">{label}</span><span className="tabular-nums text-gray-600">{percent}%</span></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2.5 overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
