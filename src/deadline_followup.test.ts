import assert from "node:assert/strict";
import test from "node:test";
import { decideDeadlineFollowup } from "./deadline_followup";

test("escalates an overdue filing instead of sending another reminder", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const overdue = new Date("2026-09-25T11:59:59.000Z");
  assert.equal(decideDeadlineFollowup(overdue, now), "escalate_supervisor");
});

test("reminds the assignee during the final 48 hours", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const tomorrow = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(decideDeadlineFollowup(tomorrow, now), "remind_assignee");
});
