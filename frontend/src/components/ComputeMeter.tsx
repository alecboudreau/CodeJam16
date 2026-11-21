import { useEffect, useState } from "react";
import type { ComputeMeter as Meter } from "@enforcer/shared";
import { api } from "../api/client";

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const energy = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export default function ComputeMeter({ projectId, refreshKey = "" }: { projectId: string; refreshKey?: string }) {
  const [meter, setMeter] = useState<Meter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getMeter(projectId).then((value) => { if (!cancelled) setMeter(value); })
      .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load compute totals."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, refreshKey, attempt]);

  return <section aria-labelledby="compute-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="compute-heading" className="text-lg font-semibold">Project compute</h2><button type="button" disabled={loading} onClick={() => setAttempt((n) => n + 1)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Refresh compute</button></div>
    <p className="mt-2 text-sm leading-6 text-gray-600">Project totals compared with a naive baseline that sends every observed commit to the big model.</p>
    {loading ? <p role="status" className="mt-4 text-sm">Loading compute totals…</p> : error ? <div role="alert" className="mt-4 text-sm text-red-800">{error}<button type="button" className="ml-3 underline" onClick={() => setAttempt((n) => n + 1)}>Retry compute</button></div> : meter && <>
      <div className="mt-4 overflow-x-auto"><table role="table" className="stack-table w-full text-left text-sm"><caption className="sr-only">Our project compute versus the naive baseline</caption>
        <thead role="rowgroup"><tr role="row" className="border-b border-gray-200"><th role="columnheader" scope="col" className="py-3 pr-3">Measure</th><th role="columnheader" scope="col" className="px-3 py-3 text-blue-800">Ours</th><th role="columnheader" scope="col" className="px-3 py-3">Naive baseline</th></tr></thead>
        <tbody role="rowgroup">{([
          ["Tokens", integer.format(meter.ours.tokens), integer.format(meter.naive.tokens)],
          ["Cost (USD)", dollars.format(meter.ours.usd), dollars.format(meter.naive.usd)],
          ["Energy (Wh, estimate)", energy.format(meter.ours.wh), energy.format(meter.naive.wh)],
          ["AI calls", integer.format(meter.ours.aiCalls), integer.format(meter.naive.aiCalls)],
        ]).map(([label, ours, naive]) => <tr role="row" key={label} className="border-b border-gray-100"><th role="rowheader" scope="row" className="py-3 pr-3 font-medium">{label}</th><td role="cell" data-label="Ours" className="px-3 py-3 tabular-nums text-blue-800">{ours}</td><td role="cell" data-label="Naive baseline" className="px-3 py-3 tabular-nums text-gray-600">{naive}</td></tr>)}</tbody>
      </table></div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">{([
        ["Filtered without AI", meter.filteredWithoutAi], ["Skipped check-ins", meter.skippedCheckins], ["Dispute re-judges", meter.disputeRejudges],
      ] as const).map(([label, count]) => <div key={label} className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-600">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{integer.format(count)}</dd></div>)}</dl>
      <p className="mt-4 text-xs leading-5 text-gray-500">Energy is an estimate. The baseline is hypothetical and includes the same planning, messaging, reporting, and dispute calls. Dispute re-judges are included in our totals; skipped check-ins avoid model calls.</p>
    </>}
  </section>;
}
