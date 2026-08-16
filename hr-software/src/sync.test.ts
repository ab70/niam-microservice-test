import { test, expect } from "bun:test";
import { normalizeStaff } from "./sync";

// Run with: bun test src/sync.test.ts
// Guards the webhook schema-parse fix: HTML dates must become ISO datetimes,
// empty dates must be dropped (schema rejects ""), everything else passes through.

test("converts HTML dates to ISO datetimes so the webhook schema parses", () => {
  const [out] = normalizeStaff([{ email: "a@b.com", department: "IT", joining_Date: "2024-01-15" }]);
  expect(out.joining_Date).toBe("2024-01-15T00:00:00.000Z");
  expect(out.department).toBe("IT");
});

test("drops empty dates — the schema rejects empty strings", () => {
  const [out] = normalizeStaff([{ email: "a@b.com", joining_Date: "", effective_Date: undefined as any }]);
  expect(out.joining_Date).toBeUndefined();
  expect(out.effective_Date).toBeUndefined();
});

test("passes through already-ISO dates and non-date fields untouched", () => {
  const [out] = normalizeStaff([{ email: "a@b.com", joining_Date: "2024-01-15T10:30:00.000Z", department: "" }]);
  expect(out.joining_Date).toBe("2024-01-15T10:30:00.000Z");
  expect(out.department).toBe("");
});

test("REMOVE envelopes (email only) pass through untouched", () => {
  expect(normalizeStaff([{ email: "a@b.com" }])).toEqual([{ email: "a@b.com" }]);
});
