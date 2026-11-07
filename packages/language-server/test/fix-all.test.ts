import { describe, expect, it } from "vitest";
import type { CodeAction, Range } from "vscode-languageserver/node";
import { fixAllEdits, kindWanted, versionedEdit, type FixSite } from "../src/fix-all.js";

const URI = "file:///p/a.ts";
const range = (line: number, from: number, to: number): Range => ({
  start: { line, character: from },
  end: { line, character: to },
});

function site(
  edits: Record<string, { range: Range; newText: string }[]>,
  alternative = false,
): FixSite {
  const first: CodeAction = { title: "fix", edit: { changes: edits } };
  const second: CodeAction = {
    title: "other",
    edit: { changes: { [URI]: [{ range: range(9, 0, 1), newText: "!" }] } },
  };
  const edit = Object.values(edits)[0]?.[0];
  return { range: edit?.range ?? range(0, 0, 0), actions: alternative ? [first, second] : [first] };
}

describe("fixAllEdits", () => {
  it("collects the edits of every site, in file order", () => {
    const sites = [
      site({ [URI]: [{ range: range(5, 0, 3), newText: "c" }] }),
      site({ [URI]: [{ range: range(1, 0, 3), newText: "a" }] }),
      site({ [URI]: [{ range: range(3, 2, 4), newText: "b" }] }),
    ];
    const { edits, count } = fixAllEdits(sites, URI);
    expect(edits.map((e) => e.newText)).toEqual(["a", "b", "c"]);
    expect(count).toBe(3);
  });

  it("takes the first fix of a site, not its alternatives", () => {
    const sites = [site({ [URI]: [{ range: range(1, 0, 3), newText: "a" }] }, true)];
    expect(fixAllEdits(sites, URI).edits.map((e) => e.newText)).toEqual(["a"]);
  });

  it("leaves out a fix that overlaps an earlier one, whole", () => {
    const sites = [
      site({ [URI]: [{ range: range(1, 0, 10), newText: "first" }] }),
      site({
        [URI]: [
          { range: range(0, 0, 1), newText: "kept-by-nobody" },
          { range: range(1, 5, 12), newText: "clash" },
        ],
      }),
      site({ [URI]: [{ range: range(2, 0, 1), newText: "later" }] }),
    ];
    const { edits, count } = fixAllEdits(sites, URI);
    expect(edits.map((e) => e.newText)).toEqual(["first", "later"]);
    expect(count).toBe(2);
  });

  it("treats edits that only touch as independent, and two insertions at one point as a clash", () => {
    const touching = [
      site({ [URI]: [{ range: range(1, 0, 3), newText: "a" }] }),
      site({ [URI]: [{ range: range(1, 3, 6), newText: "b" }] }),
    ];
    expect(fixAllEdits(touching, URI).count).toBe(2);
    const inserts = [
      site({ [URI]: [{ range: range(1, 3, 3), newText: "a" }] }),
      site({ [URI]: [{ range: range(1, 3, 3), newText: "b" }] }),
    ];
    expect(fixAllEdits(inserts, URI).count).toBe(1);
  });

  it("skips a fix that edits another file, or whose own edits overlap", () => {
    const sites = [
      site({
        [URI]: [{ range: range(1, 0, 3), newText: "a" }],
        "file:///p/b.ts": [{ range: range(0, 0, 1), newText: "x" }],
      }),
      site({ "file:///p/b.ts": [{ range: range(0, 0, 1), newText: "x" }] }),
      site({
        [URI]: [
          { range: range(2, 0, 5), newText: "p" },
          { range: range(2, 3, 8), newText: "q" },
        ],
      }),
    ];
    expect(fixAllEdits(sites, URI)).toEqual({ edits: [], count: 0 });
  });

  it("applies what verifying the chosen fixes together gives", () => {
    const sites = [
      site({ [URI]: [{ range: range(3, 0, 3), newText: "a" }] }),
      site({ [URI]: [{ range: range(5, 0, 3), newText: "b" }] }),
    ];
    const { edits, count } = fixAllEdits(sites, URI, (chosen) => {
      expect(chosen).toEqual([0, 1]);
      return {
        kept: [true, false],
        edits: [
          { range: range(3, 0, 3), newText: "a" },
          { range: range(0, 0, 1), newText: "" },
        ],
      };
    });
    expect(edits.map((e) => e.newText)).toEqual(["", "a"]);
    expect(count).toBe(1);
  });

  it("makes an edit two fixes share once", () => {
    const shared = { range: range(0, 0, 0), newText: "import x;\n" };
    const sites = [
      site({ [URI]: [shared, { range: range(3, 0, 3), newText: "a" }] }),
      site({ [URI]: [{ ...shared }, { range: range(5, 0, 3), newText: "b" }] }),
    ];
    const { edits, count } = fixAllEdits(sites, URI);
    expect(edits.map((e) => e.newText)).toEqual(["import x;\n", "a", "b"]);
    expect(count).toBe(2);
  });

  it("is empty for no sites", () => {
    expect(fixAllEdits([], URI)).toEqual({ edits: [], count: 0 });
  });
});

describe("kindWanted", () => {
  it("wants everything when the client names no kinds", () => {
    expect(kindWanted(undefined, "quickfix")).toBe(true);
    expect(kindWanted([], "source.fixAll.stateward")).toBe(true);
  });

  it("matches a kind or one of its parents, not a sibling or a longer name", () => {
    expect(kindWanted(["source.fixAll"], "source.fixAll.stateward")).toBe(true);
    expect(kindWanted(["source"], "source.fixAll.stateward")).toBe(true);
    expect(kindWanted(["source.fixAll.stateward"], "source.fixAll.stateward")).toBe(true);
    expect(kindWanted(["source.fixAll"], "quickfix")).toBe(false);
    expect(kindWanted(["quickfix"], "source.fixAll.stateward")).toBe(false);
    expect(kindWanted(["source.fix"], "source.fixAll.stateward")).toBe(false);
  });
});

describe("versionedEdit", () => {
  const NEW = "file:///p/src/guarantees.ts";
  const edit = { range: range(0, 0, 0), newText: "x" };

  it("creates a file a fix writes before filling it, and versions an open one", () => {
    const made = versionedEdit(
      { [URI]: [edit], [NEW]: [edit] },
      (uri) => (uri === URI ? 3 : null),
      (uri) => uri === URI,
    );
    expect(made.documentChanges).toEqual([
      { textDocument: { uri: URI, version: 3 }, edits: [edit] },
      { kind: "create", uri: NEW, options: { ignoreIfExists: true } },
      { textDocument: { uri: NEW, version: null }, edits: [edit] },
    ]);
  });

  it("does not create a file that exists but is not open", () => {
    const made = versionedEdit(
      { [URI]: [edit] },
      () => null,
      () => true,
    );
    expect(made.documentChanges).toEqual([
      { textDocument: { uri: URI, version: null }, edits: [edit] },
    ]);
  });
});
