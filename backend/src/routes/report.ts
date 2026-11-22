// /report: neutral status summary (owner: Person A). README §2.9. One small-model call.
import { Router, type RequestHandler } from "express";
import { ReportLlmOutput } from "@enforcer/shared";
import type { Report } from "@enforcer/shared";
import { getCheckpoints, getProject, getTasks } from "../db/db";
import { projectNow } from "../agent/loop";
import { callSmall } from "../llm/client";
import { buildReportPrompt } from "../llm/prompts/report";

export const reportRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// GET /projects/:id/report → Report
reportRouter.get(
  "/projects/:id/report",
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const tasks = await getTasks(project.id);
    if (tasks.length === 0) {
      res.status(409).json({ error: "there's no plan to report on yet" });
      return;
    }

    const nameOf = new Map(project.members.map((m) => [m.id, m.name]));
    const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
    const now = await projectNow(project.id);
    const { system, user } = buildReportPrompt({
      projectName: project.name,
      today: now,
      deadline: project.deadline,
      tasks: tasks.map((t) => ({ title: t.title, tracked: t.tracked, ownerName: nameOf.get(t.ownerId) ?? "unassigned" })),
      checkpoints: (await getCheckpoints(project.id)).map((c) => ({
        criteria: c.criteria,
        dueAt: c.dueAt,
        status: c.status,
        taskTitle: titleOf.get(c.taskId) ?? "",
        shared: c.ownerId === null,
      })),
    });

    const out = await callSmall({ purpose: "report", projectId: project.id, system, user, schema: ReportLlmOutput });
    const report: Report = { markdown: out.markdown, generatedAt: new Date().toISOString() };
    res.json(report);
  }),
);
