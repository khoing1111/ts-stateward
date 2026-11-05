import { describe, expect, it } from "vitest";
import { highestUncovered, shortestPath } from "../src/internal.js";

type Edge = { to: string; at: string; covered?: boolean };

/** `app` renders `page` twice (one covered), `page` renders `widget`, which needs X. */
const tree: Readonly<Record<string, readonly Edge[]>> = {
  app: [
    { to: "page", at: "app:1" },
    { to: "page", at: "app:2", covered: true },
  ],
  page: [{ to: "widget", at: "page:1" }],
  widget: [],
};
const needs: Readonly<Record<string, readonly string[]>> = {
  app: ["X"],
  page: ["X"],
  widget: ["X", "Y"],
};

describe("highestUncovered", () => {
  it("reports each need once, at the highest uncovered edge of each path", () => {
    const found = highestUncovered<Edge>({
      roots: [{ to: "app", at: "main" }],
      edges: (node) => tree[node] ?? [],
      covered: (edge) => edge.covered === true,
      needs: (node) => new Set(needs[node] ?? []),
      key: (edge) => edge.at,
    });
    expect(found.map(({ edge, needs: missing }) => [edge.at, missing])).toEqual([
      ["main", ["X"]],
      ["page:1", ["Y"]],
    ]);
  });

  it("stops at a covered root", () => {
    const found = highestUncovered<Edge>({
      roots: [{ to: "app", at: "main", covered: true }],
      edges: (node) => tree[node] ?? [],
      covered: (edge) => edge.covered === true,
      needs: (node) => new Set(needs[node] ?? []),
      key: (edge) => edge.at,
    });
    expect(found).toEqual([]);
  });
});

describe("shortestPath", () => {
  it("gives the edges down to the first node where the goal holds", () => {
    const path = shortestPath<Edge>(
      "app",
      (node) => tree[node] ?? [],
      (edge) => edge.covered !== true,
      (node) => node === "widget",
    );
    expect(path?.map((edge) => edge.at)).toEqual(["app:1", "page:1"]);
  });

  it("gives nothing when the goal cannot be reached through followed edges", () => {
    expect(
      shortestPath<Edge>(
        "app",
        (node) => tree[node] ?? [],
        () => false,
        (node) => node === "widget",
      ),
    ).toBeUndefined();
    expect(
      shortestPath<Edge>(
        "app",
        () => [],
        () => true,
        (node) => node === "app",
      ),
    ).toEqual([]);
  });
});
