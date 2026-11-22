import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Run with DATABASE_URL pointing to a test database. All rows live in a disposable schema.
const schema = `contract_join_${randomUUID().replaceAll("-", "")}`;
process.env.DB_SCHEMA = schema;
const db = await import("../src/db/db");
const { config } = await import("../src/config");
const { buildTaskMap } = await import("../src/routes/taskmap");

test("late joining accepts live terms once while preserving work and pending proposals", { skip: !config.databaseUrl }, async () => {
  try {
    await db.initDb();
    const project = await db.insertProject({ name: "Contract test", repos: [], deadline: "2027-01-01T00:00:00.000Z", members: [{ name: "Original", githubUsername: "original" }] });
    const original = project.members[0];
    // Original members still sign normally, even when joining by invite code.
    const code = await db.ensureInviteCode(project.id);
    await db.joinGroup(code, "original", null);
    assert.equal((await db.getMember(original.id))!.contractAcceptedAt, undefined);
    await db.updateProjectPlanState(project.id, { planActive: true, planVersion: 1, gracePeriodHours: 48, graceApprovedBy: [original.id] });
    const task = { id: db.newId(), title: "Ship", description: "Ship it", points: 3 as const, ownerId: original.id, paths: [], tracked: true, dependsOn: [], completion: 0.6, approvedBy: [original.id] };
    const cp = { id: db.newId(), taskId: task.id, ownerId: null, dueAt: "2026-12-15T00:00:00.000Z", targetCompletion: 1, criteria: "Ready", status: "missed" as const, approvedBy: [original.id], missedAt: "2026-12-16T00:00:00.000Z", graceEndsAt: undefined };
    await db.upsertTask(project.id, task);
    await db.upsertCheckpoint(project.id, cp);
    const late = await db.insertMember(project.id, { name: "Josh", githubUsername: "josh", email: "josh@example.test" });
    assert.equal(late.contractJoinPending, true);
    assert.equal((await db.getTasks(project.id)).filter(t => t.ownerId === late.id).length, 0);
    assert.equal((await db.getProjectPlanState(project.id))!.planActive, true);
    const listed = await db.listGroups({ email: "josh@example.test" });
    assert.equal(listed[0].contractJoinPending, true);
    assert.equal(listed[0].githubUsername, "josh");
    const pending = { tasks: [{ ...task, title: "Ship more", approvedBy: [] }], checkpoints: [cp], gracePeriodHours: 72, graceApprovedBy: [] };
    await db.updateProjectPlanState(project.id, { pendingPlan: pending });
    const rejected = await db.joinGroup(code, "josh", { email: "wrong@example.test" });
    assert.ok("error" in rejected);
    assert.equal((await db.getMember(late.id))!.contractAcceptedAt, undefined);
    const joined = await db.joinGroup(code, "@JOSH", { email: "josh@example.test" });
    assert.ok("project" in joined);
    const member = (await db.getMember(late.id))!;
    assert.equal(member.contractJoinPending, false);
    assert.equal(member.contractAcceptedVersion, 1);
    assert.ok(member.contractAcceptedAt);
    assert.deepEqual(await db.getTasks(project.id), [task]);
    assert.deepEqual(await db.getCheckpoints(project.id), [{ ...cp, approvedBy: [original.id, late.id] }]);
    const state = (await db.getProjectPlanState(project.id))!;
    assert.equal(state.planActive, true);
    assert.equal(state.planVersion, 1);
    assert.deepEqual(state.pendingPlan, JSON.parse(JSON.stringify(pending)));
    assert.deepEqual(state.graceApprovedBy, [original.id, late.id]);
    assert.ok((await buildTaskMap(project.id))!.waitingOn.some(w => w.memberIds.includes(late.id)));
    // Reopening/rejoining cannot accept a subsequent version or an unsigned proposal.
    await db.updateProjectPlanState(project.id, { planVersion: 2, graceApprovedBy: [original.id] });
    await db.joinGroup(code, "josh", null);
    assert.deepEqual((await db.getProjectPlanState(project.id))!.graceApprovedBy, [original.id]);
    assert.equal((await db.getMember(late.id))!.contractAcceptedAt, member.contractAcceptedAt);
    await db.updateProjectPlanState(project.id, { planVersion: 1, graceApprovedBy: state.graceApprovedBy, pendingPlan: null });
    assert.deepEqual((await buildTaskMap(project.id))!.waitingOn, []);
    // Migration can recover legacy late invitees and is safe to rerun.
    const legacy = await db.insertMember(project.id, { name: "Legacy", githubUsername: "legacy" });
    await db.dbRun("UPDATE members SET contract_join_pending = 0 WHERE id = ?", legacy.id);
    await db.initDb();
    assert.equal((await db.getMember(legacy.id))!.contractJoinPending, true);
    assert.equal((await db.getMember(late.id))!.contractJoinPending, false);
  } finally {
    await db.dbRun(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.closeDb();
  }
});
