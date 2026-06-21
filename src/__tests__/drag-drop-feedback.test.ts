import { describe, expect, it } from "vitest";
import { DragDropFeedbackState, resolveDropPlacement } from "../views/DragDropFeedback";

type FakeTarget = HTMLElement & {
  classes: Set<string>;
  operations: string[];
};

function makeTarget(rect: { top: number; left: number; width: number; height: number }): FakeTarget {
  const classes = new Set<string>();
  const operations: string[] = [];
  return {
    classes,
    operations,
    classList: {
      add: (...names: string[]) => {
        for (const name of names) {
          operations.push(`add:${name}`);
          classes.add(name);
        }
      },
      remove: (...names: string[]) => {
        for (const name of names) {
          operations.push(`remove:${name}`);
          classes.delete(name);
        }
      },
      contains: (name: string) => classes.has(name),
    },
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
  } as unknown as FakeTarget;
}

describe("DragDropFeedbackState", () => {
  it("updates only when target or placement changes", () => {
    const target = makeTarget({ top: 10, left: 20, width: 100, height: 40 });
    const state = new DragDropFeedbackState();

    state.update(target, "before");
    expect([...target.classes]).toEqual(["is-drop-before"]);
    expect(target.operations).toEqual(["add:is-drop-before"]);

    state.update(target, "before");
    expect(target.operations).toEqual(["add:is-drop-before"]);

    state.update(target, "after");
    expect([...target.classes]).toEqual(["is-drop-after"]);
    expect(target.operations).toEqual([
      "add:is-drop-before",
      "remove:is-drop-before",
      "add:is-drop-after",
    ]);
  });

  it("clears the previous target without scanning siblings", () => {
    const first = makeTarget({ top: 0, left: 0, width: 100, height: 40 });
    const second = makeTarget({ top: 40, left: 0, width: 100, height: 40 });
    const untouched = makeTarget({ top: 80, left: 0, width: 100, height: 40 });
    const state = new DragDropFeedbackState();

    state.update(first, "before");
    state.update(second, "after");

    expect(first.classes.size).toBe(0);
    expect(second.classes.has("is-drop-after")).toBe(true);
    expect(untouched.operations).toEqual([]);

    state.clear();
    expect(second.classes.size).toBe(0);
  });

  it("clears only the active target on target-specific leave", () => {
    const first = makeTarget({ top: 0, left: 0, width: 100, height: 40 });
    const second = makeTarget({ top: 40, left: 0, width: 100, height: 40 });
    const state = new DragDropFeedbackState();

    state.update(first, "before");
    state.clearTarget(second);

    expect(first.classes.has("is-drop-before")).toBe(true);
    expect(second.operations).toEqual([]);

    state.clearTarget(first);
    expect(first.classes.size).toBe(0);
  });

  it("returns the active placement only for the active target", () => {
    const first = makeTarget({ top: 0, left: 0, width: 100, height: 40 });
    const second = makeTarget({ top: 40, left: 0, width: 100, height: 40 });
    const state = new DragDropFeedbackState();

    expect(state.getPlacement(first)).toBeNull();

    state.update(first, "after");

    expect(state.getPlacement(first)).toBe("after");
    expect(state.getPlacement(second)).toBeNull();
  });
});

describe("resolveDropPlacement", () => {
  it("uses the current rect for vertical and horizontal drop placement", () => {
    const target = makeTarget({ top: 10, left: 20, width: 100, height: 40 });

    expect(resolveDropPlacement(target, { clientY: 20, clientX: 0 } as DragEvent, "vertical")).toBe("before");
    expect(resolveDropPlacement(target, { clientY: 40, clientX: 0 } as DragEvent, "vertical")).toBe("after");
    expect(resolveDropPlacement(target, { clientY: 0, clientX: 50 } as DragEvent, "horizontal")).toBe("before");
    expect(resolveDropPlacement(target, { clientY: 0, clientX: 90 } as DragEvent, "horizontal")).toBe("after");
  });
});
