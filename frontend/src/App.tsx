import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Setup from "./pages/Setup";
import TaskMap from "./pages/TaskMap";
import Dashboard from "./pages/Dashboard";
import Trace from "./pages/Trace";
import Report from "./pages/Report";

const links = [
  ["/setup", "Setup"],
  ["/taskmap", "Task map"],
  ["/dashboard", "Dashboard"],
  ["/trace", "Trace"],
  ["/report", "Report"],
] as const;

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex gap-4 border-b bg-white px-6 py-3">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "font-semibold" : "text-gray-500")}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/taskmap" element={<TaskMap />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/report" element={<Report />} />
        </Routes>
      </main>
    </div>
  );
}
