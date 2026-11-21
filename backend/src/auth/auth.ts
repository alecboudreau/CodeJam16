// Sign-in with Supabase Auth (owner: Person A, #62). The backend, not the browser, decides who the
// viewer is: a verified Supabase token → the member of the requested project with the same Discord
// account (from /link) or email. Any viewerId / memberId the client sends is overwritten.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Member } from "@enforcer/shared";
import { config } from "../config";
import { getMembers, getProject } from "../db/db";

export const authEnabled = (): boolean => Boolean(config.supabaseUrl) && !config.authDisabled;

export interface AuthUser {
  id: string;
  email?: string;
  discordId?: string;
}

// Supabase publishes its public signing keys (ES256) here; jose caches them.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const keys = () => (jwks ??= createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`)));

interface SupabaseClaims extends JWTPayload {
  email?: string;
  user_metadata?: { provider_id?: string; sub?: string };
  app_metadata?: { provider?: string; providers?: string[] };
}

export async function verifyToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify<SupabaseClaims>(token, keys(), {
    issuer: `${config.supabaseUrl}/auth/v1`,
    audience: "authenticated",
  });
  const providers = payload.app_metadata?.providers ?? [payload.app_metadata?.provider];
  const discordId = providers.includes("discord") ? payload.user_metadata?.provider_id ?? payload.user_metadata?.sub : undefined;
  return { id: payload.sub ?? "", email: payload.email || undefined, discordId };
}

/** The member of `projectId` this user is: Discord account first, then email. */
export async function memberFor(projectId: string, user: AuthUser): Promise<Member | undefined> {
  const members = await getMembers(projectId);
  return (
    (user.discordId ? members.find((m) => m.discordId === user.discordId) : undefined) ??
    (user.email ? members.find((m) => m.email && m.email.toLowerCase() === user.email!.toLowerCase()) : undefined)
  );
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    member?: Member;
  }
}

/** Requires a valid Supabase token on every /api request except health checks and webhooks. */
export const requireSignIn: RequestHandler = (req, res, next) => {
  if (!authEnabled() || req.path === "/health" || req.path === "/auth/config" || req.path.startsWith("/webhook") || req.path.startsWith("/discord/") || req.path.startsWith("/cron/")) {
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  verifyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => res.status(401).json({ error: "Your sign-in has expired. Sign in again." }));
};

/**
 * For /api/projects/:id/...: only members get in, and the request acts as that member.
 * Overwrites query.viewerId and body.memberId so no route can be pointed at someone else.
 */
export async function requireMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!authEnabled()) {
    next();
    return;
  }
  const projectId = req.params.id;
  if (!(await getProject(projectId))) {
    next(); // the route answers 404
    return;
  }
  const member = req.user ? await memberFor(projectId, req.user) : undefined;
  if (!member) {
    res.status(403).json({
      error: "You're not a member of this project. Ask whoever set it up to add you, then run /link in Discord.",
    });
    return;
  }
  req.member = member;
  if (typeof req.query.viewerId === "string" || req.path.endsWith("/dashboard")) req.query.viewerId = member.id;
  if (req.body && typeof req.body === "object" && "memberId" in req.body) req.body.memberId = member.id;
  next();
}

export const authRouter = Router();

// GET /api/auth/config → { enabled }: the web app asks this instead of keeping its own setting.
authRouter.get("/auth/config", (_req, res) => {
  res.json({ enabled: authEnabled() });
});

// GET /api/projects/:id/me → the member you're signed in as in this project.
authRouter.get("/projects/:id/me", (req, res) => {
  if (!authEnabled()) {
    res.status(404).json({ error: "sign-in is turned off" });
    return;
  }
  if (!req.member) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(req.member);
});
