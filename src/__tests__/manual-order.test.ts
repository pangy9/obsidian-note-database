import { describe, expect, it } from "vitest";
import { isExplicitlySorted } from "../data/ManualOrder";

// 判断当前视图是否处于「显式排序」状态。
// 表格/看板/画廊/列表/时间线共享：只有显式排序规则生效时，组内手动重排序（manual
// order）才会被覆盖、应当禁用；跨组移动不应受此影响。
describe("isExplicitlySorted", () => {
  it("returns false when there is no sort column and no sort rules", () => {
    expect(isExplicitlySorted({})).toBe(false);
    expect(isExplicitlySorted({ sortColumn: undefined, sortRules: undefined })).toBe(false);
    expect(isExplicitlySorted({ sortRules: [] })).toBe(false);
  });

  it("returns true when a single sort column is set", () => {
    expect(isExplicitlySorted({ sortColumn: "status" })).toBe(true);
  });

  it("returns true when sort rules contain at least one valid rule", () => {
    expect(isExplicitlySorted({ sortRules: [{ field: "priority", direction: "asc" }] })).toBe(true);
  });

  // 看板 bug 的核心：旧 canReorderCards 只看 sortRules.length > 0，
  // 没有过滤掉 field/direction 为空的无效规则，导致残留空规则时误判为已排序、
  // 误禁用跨组移动。其余视图（table/gallery/list/timeline）都已过滤。
  it("treats rules with empty field or direction as not sorted", () => {
    expect(isExplicitlySorted({ sortRules: [{ field: "", direction: "asc" }] })).toBe(false);
    expect(isExplicitlySorted({ sortRules: [{ field: "priority", direction: "" }] })).toBe(false);
    expect(isExplicitlySorted({ sortRules: [{ field: undefined, direction: undefined }] })).toBe(false);
  });

  it("returns true as long as any rule is valid, ignoring invalid ones", () => {
    expect(
      isExplicitlySorted({
        sortRules: [
          { field: "", direction: "asc" },
          { field: "priority", direction: "desc" },
        ],
      })
    ).toBe(true);
  });

  it("prefers sort column even when rules are all invalid", () => {
    expect(isExplicitlySorted({ sortColumn: "status", sortRules: [{ field: "", direction: "" }] })).toBe(true);
  });
});
