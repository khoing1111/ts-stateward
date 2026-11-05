import { InlayHintKind, MarkupKind, type InlayHint } from "vscode-languageserver/node";
import type { EditorHint } from "@stateward/core/internal";
import { positionAt, type LineIndex } from "./mapping.js";

/**
 * Which kinds of inline hint are on, by the kind a plugin gives its hints
 * (`stateward.inlayHints.<kind>` in the editor's settings). A kind the settings do not mention is
 * on.
 */
export type HintSettings = ReadonlyMap<string, boolean>;

export const DEFAULT_HINT_SETTINGS: HintSettings = new Map();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The hint settings from the `stateward` section of the editor's settings
 * (`{ inlayHints: { throws: false } }`); anything else is "all on".
 */
export function readHintSettings(section: unknown): HintSettings {
  const hints = isRecord(section) ? section.inlayHints : undefined;
  if (!isRecord(hints)) return DEFAULT_HINT_SETTINGS;
  return new Map(
    Object.entries(hints).flatMap(([kind, on]) => (typeof on === "boolean" ? [[kind, on]] : [])),
  );
}

export function hintEnabled(settings: HintSettings, kind: string): boolean {
  return settings.get(kind) !== false;
}

/** The LSP hints of the plugins' hints that fall inside `range` (offsets, end excluded), as plain type labels. */
export function toInlayHints(
  hints: readonly EditorHint[],
  index: LineIndex,
  range: { start: number; end: number },
): InlayHint[] {
  return hints
    .filter((hint) => hint.offset >= range.start && hint.offset <= range.end)
    .map((hint) => ({
      position: positionAt(index, hint.offset),
      label: hint.label,
      kind: InlayHintKind.Type,
      ...(hint.paddingLeft === true ? { paddingLeft: true } : {}),
      ...(hint.tooltip === undefined
        ? {}
        : { tooltip: { kind: MarkupKind.Markdown, value: hint.tooltip } }),
    }));
}
