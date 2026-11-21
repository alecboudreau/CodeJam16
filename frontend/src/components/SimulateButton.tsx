import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

interface SimulateButtonProps {
  projectId: string;
  planActive: boolean;
  disabled?: boolean;
  onStarted?: (checkinId: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function SimulateButton({ projectId, planActive, disabled = false, onStarted, onBusyChange }: SimulateButtonProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function simulate() {
    if (!planActive || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const response = await api.simulate(projectId);
      const checkinId = response?.checkinId;
      if (!checkinId || typeof checkinId !== "string") throw new Error("The simulation did not return a check-in ID.");
      if (!mounted.current) return;
      onStarted?.(checkinId);
      navigate({ pathname: "/trace", search: `?${new URLSearchParams({ checkinId })}` });
    } catch (error: unknown) {
      if (mounted.current) setError(error instanceof Error ? error.message : "Could not simulate the week. Please try again.");
    } finally {
      lock.current = false;
      if (mounted.current) { setBusy(false); onBusyChange?.(false); }
    }
  }

  return <div className="max-w-md">
    <button type="button" disabled={!planActive || disabled || busy} onClick={simulate} title={!planActive ? "Approve the plan before simulating" : undefined} className="rounded-lg border border-blue-700 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Simulating 1 week…" : "Simulate 1 week"}</button>
    {busy && <p role="status" className="mt-2 text-xs text-gray-600">Running seven simulated days. The trace will open when the simulation finishes.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </div>;
}
