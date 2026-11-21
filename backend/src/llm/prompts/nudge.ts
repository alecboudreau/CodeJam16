// Nudge wording (owner: Person A). README §2.7, §11 (Nudge). Small model.
// The model only words a message that plain code already decided to send.
// Group messages (help_post, team_alert) get no numbers or evidence as input, so they can't leak any.

export type NudgeKind = "dm" | "blocker_dm" | "help_post" | "team_alert";

export type NudgeInput =
  | { kind: "dm"; memberName: string; taskTitle: string; criteria: string; hoursOfGraceLeft: number; teamAlerted: boolean }
  | { kind: "blocker_dm"; memberName: string; waitingName: string; taskTitle: string; criteria: string }
  | { kind: "help_post"; memberName: string; taskTitle: string; criteria: string }
  | { kind: "team_alert"; memberName: string; taskTitle: string; criteria: string };

const SYSTEM = `You write short messages from a friendly project-coordination bot to students in a group project.
Rules for every message:
- At most 3 sentences. Plain, warm, specific: name the one checkpoint given.
- Never blame, shame, rank or compare people. Never mention percentages, points, commit counts or evidence.
- No greetings like "Dear", no sign-off, no emoji.`;

function describe(input: NudgeInput): string {
  switch (input.kind) {
    case "dm":
      return `A private Discord DM to ${input.memberName}. Their checkpoint "${input.criteria}" on the task "${input.taskTitle}" was missed.
${input.teamAlerted ? "The team has already been told this checkpoint is still open, so be a little firmer, still kind." : `The team will only be told if it's still unmet in about ${input.hoursOfGraceLeft} hours.`}
Ask what's in the way and mention they can use the buttons below the message (On it / Blocked / Need help).`;
    case "blocker_dm":
      return `A private Discord DM to ${input.memberName}. ${input.waitingName} is waiting on them to continue the checkpoint "${input.criteria}" on "${input.taskTitle}".
Let them know someone is blocked and ask if they can unblock them soon.`;
    case "help_post":
      return `A post in the team's group channel. ${input.memberName} asked for help with the checkpoint "${input.criteria}" on "${input.taskTitle}".
Ask if anyone is free to pair with ${input.memberName} on it.`;
    case "team_alert":
      return `A post in the team's group channel. The checkpoint "${input.criteria}" on "${input.taskTitle}" (owned by ${input.memberName}) is still not met after the agreed grace period.
State it neutrally and ask what the team can do to help ${input.memberName}.`;
  }
}

export function buildNudgePrompt(input: NudgeInput): { system: string; user: string } {
  return { system: SYSTEM, user: `${describe(input)}\n\nReturn JSON: { "message": "..." }` };
}
