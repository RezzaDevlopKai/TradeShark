import { describe, expect, it } from "vitest";
import { executeLimitOrder as executeFromIndex } from "./index.ts";
import { executeLimitOrder as executeFromModule } from "./execution.ts";

describe("trading public exports", () => {
  it("re-exports execution from the canonical execution module", () => {
    expect(executeFromIndex).toBe(executeFromModule);
  });
});
