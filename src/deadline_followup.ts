export type FollowupAction = "none" | "remind_assignee" | "escalate_supervisor";

export function decideDeadlineFollowup(dueAt: Date, now: Date): FollowupAction {
  const hoursRemaining = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursRemaining < 0) return "escalate_supervisor";
  if (hoursRemaining <= 48) return "remind_assignee";
  return "none";
}
