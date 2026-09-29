import assert from "node:assert/strict";
import test from "node:test";
import { shanghaiDay, dayRange, formatFullDate } from "../../lib/format";

test("Shanghai day boundaries stay correct across month and year boundaries", () => {
  assert.equal(shanghaiDay(new Date("2025-12-31T16:00:00Z")), "2026-01-01");
  assert.deepEqual(dayRange("2026-01-01", "2026-01-31"), {
    gte: new Date("2025-12-31T16:00:00Z"), lt: new Date("2026-01-31T16:00:00Z"),
  });
  assert.deepEqual(dayRange("2024-02-29", "2024-02-29"), {
    gte: new Date("2024-02-28T16:00:00Z"), lt: new Date("2024-02-29T16:00:00Z"),
  });
  assert.match(formatFullDate("2025-12-31T16:00:00Z"), /2026.*01.*01.*00:00:00/);
});

test("date ranges reject impossible and reversed dates", () => {
  assert.throws(() => dayRange("2026-02-30", "2026-03-01"), /日期/);
  assert.throws(() => dayRange("2026-01-02", "2026-01-01"), /日期/);
});
