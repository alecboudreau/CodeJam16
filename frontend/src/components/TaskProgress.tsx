interface TaskProgressProps {
  label: string;
  completion: number;
}

export default function TaskProgress({ label, completion }: TaskProgressProps) {
  const percent = Math.round(
    Math.min(1, Math.max(0, Number.isFinite(completion) ? completion : 0)) *
      100,
  );
  return (
    <div className="task-progress">
      <div className="progress-label">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="progress-track"
      >
        <div className="progress-value" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
