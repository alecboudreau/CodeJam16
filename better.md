# Project Accountability System

## Purpose

Help student project teams stay on track by checking whether agreed work is actually getting completed. The system measures progress against project requirements and milestone criteria, not by commit counts, update frequency, or activity volume. It gives members early, private reminders and alerts the team only when a missed commitment remains unresolved.

The system supports accountability and coordination. It does not grade students or assign penalties.

## Intended users

The first version is for student teams working on group projects tracked in GitHub. A project may have shared goals, individually owned milestones, or both.

## How a project is set up

1. A team connects one or more GitHub repositories and provides a project document containing requirements, deadlines, and effort estimates.
2. The system analyzes the document and repositories to identify requirements, dependencies, shared milestones, and proposed individual milestones.
3. It recommends more frequent, feasible targets based on estimated effort, dependencies, time remaining, and member capacity. It also recommends a grace period for missed checkpoints.
4. Each member reviews and approves their personal targets. The team reviews and approves shared milestones and sets the grace period. Members can propose alternatives to personal targets and discuss them with the team before approval.
5. Once approved, the plan becomes the basis for progress checks and reminders.

## Progress assessment

The system runs adaptive check-ins against GitHub repositories. It chooses when to check based on milestone urgency and the project timeline, rather than requiring a fixed daily or weekly schedule.

At each check-in, the model assesses progress at two levels:

- **Milestone progress:** how far the work has advanced against that milestone's requirements and acceptance criteria.
- **Overall project progress:** how the completed and in-progress milestones compare with the project's agreed goals.

The assessment is based on functional or requirement-level completion, not on the volume of repository activity. The model can mark work complete on its own. Members can correct an assessment or dispute it by submitting evidence, such as code snippets, screenshots, or instructions pointing the system to relevant repository files. The AI rechecks disputed work. While a dispute is being rechecked, alerts related to that specific issue are paused; other alerts continue.

The system sends the member the evidence behind their own assessment. Evidence is not included in team-wide alerts.

## Accountability and notifications

- A private Discord reminder is sent when a member misses an approved checkpoint.
- If the checkpoint is still unmet after the team-approved grace period, the whole team receives a status alert.
- The system recommends a grace period during setup, and the team chooses the final value.
- Team alerts explain the missed status without sharing the member's supporting evidence.
- The system does not send reminders merely because a member has few commits or updates.

## Core capabilities

- Import requirements, deadlines, and estimates from a project document.
- Connect GitHub repositories and inspect project-specific files and functionality.
- Generate proposed shared and individual milestones, dependencies, workload targets, and dates.
- Recommend feasible targets using effort, dependencies, time remaining, and member capacity.
- Collect member approval for personal targets and team approval for shared milestones.
- Adapt repository check-in timing to milestone urgency and deadlines.
- Assess milestone and overall completion against requirements and criteria.
- Show each member the evidence for their assessment.
- Accept corrections and evidence-based disputes, then recheck with AI.
- Send private Discord reminders and status-only team alerts after a missed checkpoint and grace period.

## Initial product scope

**In scope:** student group projects, GitHub repositories, Discord notifications, project documents with deadlines and estimates, shared goals and personal milestones, evidence submissions, automated progress assessment, and dispute rechecks.

**Not in scope for the first version:** grading, penalties, commit-based contribution scoring, and integrations with other code hosts or notification platforms.

## Product principles

1. **Measure outcomes.** A commit is evidence to inspect, not a unit of progress.
2. **Agree on expectations first.** Proposed targets become active only after the required member or team approval.
3. **Make assessments reviewable.** Members can see the evidence and challenge an incorrect result.
4. **Escalate proportionately.** Start with a private reminder; involve the team only after the grace period.
5. **Protect personal evidence.** A team alert reports status without exposing the affected member's evidence.
