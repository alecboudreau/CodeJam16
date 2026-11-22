import type { Member } from "@enforcer/shared";

export default function MemberStatus({ member, members }: { member: Member; members: Member[] }) {
  if (member.status === "none") return null;
  const blocker = members.find((m) => m.id === member.blockedById);
  const label = member.status === "on_it" ? "On it" : member.status === "need_help" ? "Needs help" : `Blocked by ${blocker?.name ?? "a teammate"}`;
  const style = member.status === "blocked" ? "bg-amber-50 text-amber-900" : member.status === "need_help" ? "bg-purple-50 text-purple-800" : "bg-blue-50 text-blue-800";
  return <span className={`status-label ${style}`}>{label}</span>;
}
