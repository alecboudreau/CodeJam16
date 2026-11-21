// /api/projects, members, aliases (owner: Person A). README §7.
import { Router } from "express";
import { AddAliasBody, CreateProjectBody } from "@enforcer/shared";
import { addGithubAlias, db, getMemberProjectId, getProject, insertProject } from "../db/db";
import { authEnabled } from "../auth/auth";

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

  // With sign-in on, the creator must be on the team (matched by the email they signed in with),
  // or they'd be locked out of their own project. Their Discord account is linked right away.
  const me = req.user;
  const myEmail = me?.email?.toLowerCase();
  if (authEnabled() && me) {
    const mine = body.members.find((m) => myEmail && m.email?.toLowerCase() === myEmail);
    if (!mine) {
      res.status(400).json({ error: `Add yourself to the team with the email you signed in with${me.email ? ` (${me.email})` : ""}.` });
      return;
    }
  }

  const project = insertProject(body);
  if (authEnabled() && me?.discordId && myEmail) {
    const creator = project.members.find((m) => m.email?.toLowerCase() === myEmail);
    if (creator && !creator.discordId) db.prepare("UPDATE members SET discord_id = ? WHERE id = ?").run(me.discordId, creator.id);
  }
  res.status(201).json(getProject(project.id));
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
