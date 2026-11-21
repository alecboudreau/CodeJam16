// Inbox API (owner: Person A, #59). A mirror of what the bot sent: same stored messages, same
// member status as the Discord buttons, so a press in either place shows up in both.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { MemberStatus } from "@enforcer/shared";
import { dbAll, getMember, getMemberProjectId, getMembers, getProject, setMemberStatus } from "../db/db";

export const inboxRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

type InboxKind = "nudge" | "nudge_blocker" | "help_post" | "team_alert";
type Answer = "on_it" | "blocked" | "need_help";

interface InboxItem {
  id: string;
  kind: InboxKind;
  message: string;
  at: string;
  checkpoint: { id: string; criteria: string; taskTitle: string };
  deliveredOnDiscord: boolean;
  answered: { status: Answer; blockedByName?: string } | null;
}

interface Row {
  id: string;
  member_id: string | null;
  action: InboxKind;
  message: string;
  sent_at: string | null;
  discord_sent: number | null;
  checkin_started_at: string;
  checkin_real_started_at: string | null;
  checkpoint_id: string;
  criteria: string;
  task_title: string | null;
}

// GET /projects/:id/inbox?viewerId= → { forYou, team, unreadCount }
inboxRouter.get(
  "/projects/:id/inbox",
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const viewerId = typeof req.query.viewerId === "string" ? req.query.viewerId : "";
    const viewer = project.members.find((m) => m.id === viewerId);
    if (!viewer) {
      res.status(400).json({ error: "viewerId must be a member of this project" });
      return;
    }

    // Every message the agent worded for this project (sent on Discord or not), with its checkpoint.
    const rows = await dbAll<Row>(
      `SELECT d.id, d.member_id, d.action, d.message, d.sent_at, d.discord_sent,
              c.started_at AS checkin_started_at, c.real_started_at AS checkin_real_started_at,
              cp.id AS checkpoint_id, cp.criteria, t.title AS task_title
       FROM decisions d
       JOIN checkins c ON c.id = d.checkin_id
       JOIN checkpoints cp ON cp.id = d.checkpoint_id
       LEFT JOIN tasks t ON t.id = cp.task_id
       WHERE c.project_id = ? AND d.message IS NOT NULL
         AND d.action IN ('nudge', 'nudge_blocker', 'help_post', 'team_alert')`,
      project.id,
    );

    const nameOf = new Map(project.members.map((m) => [m.id, m.name]));
    // The member's latest button press answers the reminders created before it (compared in real
    // time: messages carry the project's clock, which is the demo clock during a demo).
    const pressedAt = viewer.statusAt ? Date.parse(viewer.statusAt) : NaN;
    const answer: InboxItem["answered"] =
      viewer.status === "none"
        ? null
        : { status: viewer.status as Answer, ...(viewer.status === "blocked" && viewer.blockedById ? { blockedByName: nameOf.get(viewer.blockedById) ?? "a teammate" } : {}) };

    const toItem = (r: Row, answered: InboxItem["answered"]): InboxItem => ({
      id: r.id,
      kind: r.action,
      message: r.message,
      at: r.sent_at ?? r.checkin_started_at,
      checkpoint: { id: r.checkpoint_id, criteria: r.criteria, taskTitle: r.task_title ?? "" },
      deliveredOnDiscord: Number(r.discord_sent) === 1,
      answered,
    });

    const forYou = rows
      .filter((r) => (r.action === "nudge" || r.action === "nudge_blocker") && r.member_id === viewer.id)
      .map((r) => {
        const created = Date.parse(r.checkin_real_started_at ?? r.checkin_started_at);
        return toItem(r, answer && Number.isFinite(pressedAt) && pressedAt >= created ? answer : null);
      });
    const team = rows.filter((r) => r.action === "help_post" || r.action === "team_alert").map((r) => toItem(r, null));

    const newest = (a: InboxItem, b: InboxItem) => Date.parse(b.at) - Date.parse(a.at);
    forYou.sort(newest);
    team.sort(newest);
    res.json({ forYou, team, unreadCount: forYou.filter((i) => i.answered === null).length });
  }),
);

const StatusBody = z.object({
  status: z.enum(["on_it", "blocked", "need_help"]),
  blockedById: z.string().optional(),
  viewerId: z.string().optional(),
});

// POST /projects/:id/members/:memberId/status { status, blockedById?, viewerId } → Member
// The same action as the Discord buttons. Only the member themselves can answer their reminders.
inboxRouter.post(
  "/projects/:id/members/:memberId/status",
  asyncRoute(async (req, res) => {
    const body = StatusBody.parse(req.body);
    const projectId = req.params.id;
    const memberId = req.params.memberId;
    if ((await getMemberProjectId(memberId)) !== projectId) {
      res.status(404).json({ error: "member not found in this project" });
      return;
    }
    // With sign-in on, req.member is the signed-in member; otherwise the picker's viewerId.
    const actor = req.member?.id ?? body.viewerId;
    if (actor !== memberId) {
      res.status(403).json({ error: "you can only answer your own reminders" });
      return;
    }
    if (body.status === "blocked") {
      const teammates = (await getMembers(projectId)).filter((m) => m.id !== memberId);
      if (!body.blockedById || !teammates.some((m) => m.id === body.blockedById)) {
        res.status(400).json({ error: "pick the teammate you're waiting on" });
        return;
      }
    }
    await setMemberStatus(memberId, body.status as MemberStatus, body.status === "blocked" ? body.blockedById : undefined);
    res.json(await getMember(memberId));
  }),
);
