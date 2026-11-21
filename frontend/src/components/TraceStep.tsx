import { useEffect, useState } from "react";
import type { TraceStep as Step } from "@enforcer/shared";

const labels: Record<Step["step"], { title: string; compute: string }> = {
  observe: { title: "Observe", compute: "GitHub API" },
  filter: { title: "Filter", compute: "No AI" },
  judge: { title: "Judge", compute: "Small model" },
  escalate: { title: "Escalate", compute: "Big model only when needed" },
  decide: { title: "Decide", compute: "Plain code" },
  act: { title: "Act", compute: "Message delivery" },
  skip: { title: "Skipped", compute: "No model calls" },
};

export default function TraceStep({ step }: { step: Step }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setEntered(true), 20); return () => clearTimeout(timer); }, []);
  const failed = /^failed:/i.test(step.summary);
  const style = failed ? "border-red-200 bg-red-50" : step.step === "skip" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white";
  return <li className={`rounded-xl border p-5 transition duration-300 motion-reduce:transform-none motion-reduce:transition-none ${entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"} ${style}`}>
    <div className="flex flex-wrap items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">{step.order + 1}</span>
      <h3 className="font-semibold">{labels[step.step].title}{failed ? " · Failed" : ""}</h3>
      <span className="text-xs text-gray-500">{labels[step.step].compute}</span>
      <time dateTime={step.at} className="ml-auto text-xs text-gray-500">{new Date(step.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
    </div>
    <p className="mt-3 text-sm leading-6 text-gray-700">{step.summary}</p>
  </li>;
}
