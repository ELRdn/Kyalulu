import { describe, expect, it } from "vitest";
import { preserveComposerKey } from "./Composer";

describe("composer keyboard input", () => {
  it("lets Android Enter insert a newline without submitting or completing a command", () => {
    expect(preserveComposerKey("Enter", false, false, 13, true)).toBe(true);
  });
  it("preserves desktop Enter sending", () => {
    expect(preserveComposerKey("Enter", false, false, 13, false)).toBe(false);
  });
  it("does not submit during composition, including Android's final keyCode 229", () => {
    expect(preserveComposerKey("Enter", true, false, 13, false)).toBe(true);
    expect(preserveComposerKey("Enter", false, true, 13, false)).toBe(true);
    expect(preserveComposerKey("Enter", false, false, 229, false)).toBe(true);
  });
});
