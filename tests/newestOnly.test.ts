import { describe, expect, it } from "vitest";
import { newestOnly } from "../src/newestOnly";

describe("newest only", () => {
  it("runs once more after the work in progress, however many times it was asked", () => {
    let started = 0;
    const runner = newestOnly(() => started++);
    runner.ask();
    runner.ask();
    runner.ask();
    runner.ask();
    expect(started).toBe(1);
    runner.finished();
    expect(started).toBe(2);
    runner.finished();
    expect(started).toBe(2);
    expect(runner.isBusy()).toBe(false);
  });
});
