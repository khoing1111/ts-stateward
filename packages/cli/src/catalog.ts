/**
 * When `init` ticks a pack: `always` (it reads plain TypeScript), `chosen` (it asks for a shape
 * the team decides on, so only `--packs` or the questions add it), or when package.json lists one
 * of `dependencies`.
 */
export type PackDetection =
  { kind: "always" } | { kind: "chosen" } | { kind: "dependency"; dependencies: readonly string[] };

/**
 * The packs `init` can set up, in the order a generated config lists them: a static catalog, so
 * the CLI depends on core only and installs nothing it does not use. Name and
 * description are each pack's own; a test checks they match the packs (catalog.test.ts). No pack
 * needs a helper package in the app.
 */
const PACKS = [
  {
    name: "unions",
    packageName: "@stateward/plugin-unions",
    importName: "unions",
    description: "Every case of a union is handled, and its tag tells the cases apart.",
    detect: { kind: "always" },
  },
  {
    name: "records",
    packageName: "@stateward/plugin-records",
    importName: "records",
    description:
      "Lookup tables and records keyed by a union have every key, once, under a type that names them.",
    detect: { kind: "always" },
  },
  {
    name: "async",
    packageName: "@stateward/plugin-async",
    importName: "asyncFlow",
    description:
      "An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails.",
    detect: { kind: "always" },
  },
  {
    name: "react-context",
    packageName: "@stateward/plugin-react-context",
    importName: "reactContext",
    description: "A component that needs a context is always rendered under its Provider.",
    detect: { kind: "dependency", dependencies: ["react"] },
  },
  {
    name: "errors",
    packageName: "@stateward/plugin-errors",
    importName: "errors",
    description:
      "Errors are handled where they can happen: none ignored, none replaced in `finally`, no `Result` dropped.",
    detect: { kind: "always" },
  },
  {
    name: "ownership",
    packageName: "@stateward/plugin-ownership",
    importName: "ownership",
    description:
      "One owner per piece of shared state and per brand: others call the owner's functions.",
    detect: { kind: "chosen" },
  },
  {
    name: "reducers",
    packageName: "@stateward/plugin-reducers",
    importName: "reducers",
    description: "A reducer reaches every state it declares and can leave every state it enters.",
    detect: { kind: "chosen" },
  },
  {
    name: "react",
    packageName: "@stateward/plugin-react",
    importName: "react",
    description:
      "Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state.",
    detect: { kind: "dependency", dependencies: ["react"] },
  },
] as const satisfies readonly {
  name: string;
  packageName: string;
  importName: string;
  description: string;
  detect: PackDetection;
}[];

/** One pack of the catalog. */
export type PackEntry = (typeof PACKS)[number];

export type PackName = PackEntry["name"];

/** The catalog, in order: what `init`, the docs and the packs listing read. */
export const PACK_CATALOG: readonly PackEntry[] = PACKS;

export const PACK_NAMES: readonly PackName[] = PACKS.map((pack) => pack.name);

export function isPackName(value: string): value is PackName {
  return PACK_NAMES.some((name) => name === value);
}

/** Thrown when a pack name has no entry in `PACKS`; `PackName` is derived from it, so it is a bug. */
export class UnknownPackError extends Error {
  constructor(name: string) {
    super(`no pack named "${name}"`);
    this.name = "UnknownPackError";
  }
}

/**
 * The name a pack's function is imported by: the one `PACKS` gives (`async` is `asyncFlow`, since
 * `async` reads as a keyword), else the plugin name in camelCase (`react-context` is `reactContext`).
 */
export function importNameOf(plugin: { name: string }): string {
  const pack = PACKS.find((candidate) => candidate.name === plugin.name);
  return (
    pack?.importName ?? plugin.name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
  );
}

export function packOf(name: PackName): PackEntry {
  const pack = PACKS.find((candidate) => candidate.name === name);
  if (pack === undefined) throw new UnknownPackError(name);
  return pack;
}

/** One line saying what the pack is for: the plugin's own `description`. */
export function packDescription(name: PackName): string {
  return packOf(name).description;
}
