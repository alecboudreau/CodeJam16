// zod schemas for API bodies + LLM output (owner: Person A). See README sections 7, 8 and 11.
import { z } from "zod";

// ---------- shared pieces ----------

export const Points = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]);
export const Fraction = z.number().min(0).max(1);
export const IsoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const MemberStatusSchema = z.enum(["none", "on_it", "blocked", "need_help"]);
export const CheckpointStatusSchema = z.enum(["pending", "met", "missed", "alerted"]);

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  points: Points,
  ownerId: z.string(),
  paths: z.array(z.string()),
  tracked: z.boolean(),
  dependsOn: z.array(z.string()),
  completion: Fraction,
  approvedBy: z.array(z.string()),
});

export const CheckpointSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  ownerId: z.string().nullable(),
  dueAt: IsoDate,
  targetCompletion: Fraction,
  criteria: z.string().min(1),
  status: CheckpointStatusSchema,
  approvedBy: z.array(z.string()),
  missedAt: IsoDate.optional(),
  graceEndsAt: IsoDate.optional(),
});

export const PlanItemRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: z.string() }),
  z.object({ kind: z.literal("checkpoint"), id: z.string() }),
  z.object({ kind: z.literal("grace") }),
]);

// ---------- API bodies ----------

export const MemberInputSchema = z.object({
  name: z.string().min(1),
  githubUsername: z.string().min(1),
  email: z.string().email().optional(),
  capacityHoursPerWeek: z.number().positive().max(80).optional(),
});

export const CreateProjectBody = z.object({
  name: z.string().min(1),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "use owner/repo")).min(1),
  members: z.array(MemberInputSchema).min(1),
  deadline: IsoDate,
});

export const AddAliasBody = z.object({ githubLogin: z.string().min(1) });

export const PutTaskMapBody = z.object({
  tasks: z.array(TaskSchema),
  checkpoints: z.array(CheckpointSchema),
  gracePeriodHours: z.number().int().positive(),
});

export const AgreeBody = z.object({
  memberId: z.string(),
  items: z.array(PlanItemRefSchema).optional(), // omitted = everything waiting on memberId
});

export const DisputeBody = z.object({
  memberId: z.string(),
  note: z.string().min(1).max(500),
  filePaths: z.array(z.string().min(1)).max(5).optional(), // DISPUTE_MAX_FILES
});

export const SimulateBody = z.object({ days: z.number().int().min(1).max(14).default(7) });

// ---------- LLM output ----------

export const PlanLlmOutput = z.object({
  tasks: z.array(z.object({
    key: z.string(),
    title: z.string().min(1),
    description: z.string(),
    points: Points,
    ownerName: z.string(),
    paths: z.array(z.string()),
    tracked: z.boolean(),
    dependsOn: z.array(z.string()),
  })).min(1),
  checkpoints: z.array(z.object({
    taskKey: z.string(),
    shared: z.boolean(),
    dueAt: IsoDate,
    targetCompletion: Fraction,
    criteria: z.string().min(1),
  })),
  gracePeriodHours: z.number().int().positive(),
  graceReason: z.string(),
});

export const JudgeLlmOutput = z.object({
  judgments: z.array(z.object({
    sha: z.string(),
    taskId: z.string().nullable(),
    kind: z.enum(["substantial", "light"]),
    completionDelta: Fraction,
    confidence: Fraction,
    reason: z.string(),
  })),
});

export const JudgmentDisputeLlmOutput = z.object({
  kind: z.enum(["substantial", "light"]),
  completionDelta: Fraction,
  reason: z.string(),
});

export const CheckpointDisputeLlmOutput = z.object({
  completion: Fraction,
  met: z.boolean(),
  reason: z.string(),
});

export const NudgeLlmOutput = z.object({ message: z.string().min(1).max(600) });

export const ReportLlmOutput = z.object({ markdown: z.string().min(1) });

export type PlanLlm = z.infer<typeof PlanLlmOutput>;
export type JudgeLlm = z.infer<typeof JudgeLlmOutput>;
