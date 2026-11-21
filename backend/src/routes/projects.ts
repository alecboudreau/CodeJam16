// /api/projects, members, aliases (owner: Person A). README §7.
import { Router } from "express";
import { AddAliasBody, CreateProjectBody } from "@enforcer/shared";
import { addGithubAlias, getMemberProjectId, getProject, insertProject } from "../db/db";

export const projectsRouter = Router();

// POST /projects → Project
projectsRouter.post("/projects", (req, res) => {
  const body = CreateProjectBody.parse(req.body);

  const seen = new Set<string>();
  for (const m of body.members) {
    const key = m.githubUsername.toLowerCase();
    if (seen.has(key)) {
      res.status(400).json({ error: `GitHub username "${m.githubUsername}" is listed twice` });
      return;
    }
    seen.add(key);
  }

  res.status(201).json(insertProject(body));
});

// GET /projects/:id → Project
projectsRouter.get("/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(project);
});

// POST /projects/:id/members/:memberId/aliases { githubLogin } → Member
// Assigns an "unmatched" GitHub login to a member.
projectsRouter.post("/projects/:id/members/:memberId/aliases", (req, res) => {
  const { githubLogin } = AddAliasBody.parse(req.body);
  if (getMemberProjectId(req.params.memberId) !== req.params.id) {
    res.status(404).json({ error: "member not found in this project" });
    return;
  }
  res.json(addGithubAlias(req.params.memberId, githubLogin));
});
