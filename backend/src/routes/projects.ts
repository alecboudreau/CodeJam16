// /api/projects, members, aliases (owner: Person A). README §7.
import { Router } from "express";
import { z } from "zod";
import { AddAliasBody, CreateProjectBody } from "@enforcer/shared";
import { addGithubAlias, getMemberProjectId, getProject, insertProject, joinGroup, listGroups, setMemberDiscordId } from "../db/db";
import { authEnabled } from "../auth/auth";

const JoinGroupBody = z.object({
  code: z.string().trim().min(1),
  githubUsername: z.string().trim().min(1),
});

export const projectsRouter = Router();

// GET /me/projects → groups the signed-in person belongs to.
projectsRouter.get("/me/projects", async (req, res, next) => {
  try {
    if (!authEnabled()) {
      res.json([]);
      return;
    }
    const me = req.user;
    if (!me) {
      res.status(401).json({ error: "Sign in first." });
      return;
    }
    res.json(await listGroups({ email: me.email, discordId: me.discordId }));
  } catch (e) {
    next(e);
  }
});

// POST /me/projects/join { code, githubUsername } → Project
projectsRouter.post("/me/projects/join", async (req, res, next) => {
  try {
    const body = JoinGroupBody.parse(req.body);
    const me = authEnabled() ? req.user : null;
    if (authEnabled() && !me) {
      res.status(401).json({ error: "Sign in first." });
      return;
    }
    const result = await joinGroup(body.code, body.githubUsername, me ? { email: me.email, discordId: me.discordId } : null);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.project);
  } catch (e) {
    next(e);
  }
});

// POST /projects → Project
projectsRouter.post("/projects", async (req, res, next) => {
  try {
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

  const project = await insertProject(body);
  if (authEnabled() && me?.discordId && myEmail) {
    const creator = project.members.find((m) => m.email?.toLowerCase() === myEmail);
    if (creator && !creator.discordId) await setMemberDiscordId(creator.id, me.discordId);
  }
  res.status(201).json(await getProject(project.id));
  } catch (e) {
    next(e);
  }
});

// GET /projects/:id → Project
projectsRouter.get("/projects/:id", async (req, res, next) => {
  let project;
  try {
    project = await getProject(req.params.id);
  } catch (e) {
    next(e);
    return;
  }
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(project);
});

// POST /projects/:id/members/:memberId/aliases { githubLogin } → Member
// Assigns an "unmatched" GitHub login to a member.
projectsRouter.post("/projects/:id/members/:memberId/aliases", async (req, res, next) => {
  try {
  const { githubLogin } = AddAliasBody.parse(req.body);
  if ((await getMemberProjectId(req.params.memberId)) !== req.params.id) {
    res.status(404).json({ error: "member not found in this project" });
    return;
  }
  res.json(await addGithubAlias(req.params.memberId, githubLogin));
  } catch (e) {
    next(e);
  }
});
