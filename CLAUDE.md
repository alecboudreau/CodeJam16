# CLAUDE.md

Read `README.md` first. It's the spec; `shared/src/types.ts` is the source of truth for data shapes.

## Work one GitHub issue at a time

All work is tracked as GitHub Issues (`[A1]`…`[C12]`, labels `person-a` / `person-b` / `person-c`, milestones `Hour 8` → `Final`).

When the user names an issue ("do #12"):

1. Read it: `gh issue view 12`. Check its **Depends on** issues are closed; if not, say so and ask before starting.
2. Branch from an up-to-date `main`: `<person>/<number>-<short-name>`, e.g. `a/12-nudge-prompts`.
3. Touch **only** the files listed under "Files this issue may touch". If something outside the issue needs to change (another person's folder, `shared/`, a different issue), **say so and don't do it**.
4. Stop when every **Done when** item is met. Don't add features, refactors or polish beyond it.
5. Run `npm run build` and `npm run lint`, then open a PR whose body starts with `Closes #12` and lists each Done-when item.

If the user hasn't named an issue, ask which one before writing code.

Issues in the `Should` milestone wait until the hour-20 checkpoint unless the user says otherwise.

## Rules from the spec

- Every LLM call goes through `backend/src/llm/client.ts` so tokens, cost and energy are logged.
- Every LLM output is validated with the zod schemas in `shared/src/schemas.ts`.
- Decide rules are plain code (README §10). Never ask a model *whether* to nudge, only *how to word* it.
- Never trigger anything on commit activity, never compare members, and never put evidence, percentages or commit counts in a team message.
- `shared/` is the team contract: changing it needs a heads-up to the team, so flag it instead of editing it inside a feature issue.
- After a `schema.sql` change, the local DB must be recreated (`rm data/enforcer.db && npm run db:init`).
- Prefer simple, readable code over clever abstractions: this is a 36-hour build.
