import type { Fix, Location, RelatedLocation } from "@stateward/core";
import { type Hop, type Machine, pathTo, quoted } from "./machines.js";
import { shorten } from "./text.js";
import type { Place } from "./summary.js";

export const at = (file: string, place: Place): Location => ({ file, ...place });

/** Where the machine starts, one note for each place that says so. */
export function startNotes(machine: Machine, tags?: readonly string[]): RelatedLocation[] {
  return machine.starts
    .filter((start) => tags === undefined || start.tags.some((tag) => tags.includes(tag)))
    .map((start) => ({
      location: at(start.file, start.at),
      message: `starts at ${start.tags.map(quoted).join(", ")}`,
    }));
}

function hopNote(machine: Machine, hop: Hop): RelatedLocation {
  const event = hop.edge.event === null ? "" : ` on \`${shorten(hop.edge.event, 30)}\``;
  return {
    location: at(machine.file, hop.edge),
    message: `${quoted(hop.from)} goes to ${quoted(hop.to)}${event}`,
  };
}

/** The way from a start to a state, as notes: where it starts, then each hop. */
export function pathNotes(machine: Machine, tag: string): RelatedLocation[] {
  if (machine.startsAny) return [];
  const hops = pathTo(machine, tag);
  const first = hops[0]?.from ?? tag;
  const start = machine.starts.find((candidate) => candidate.tags.includes(first));
  return [
    ...(start === undefined
      ? []
      : [{ location: at(start.file, start.at), message: `starts at ${quoted(first)}` }]),
    ...hops.map((hop) => hopNote(machine, hop)),
  ];
}

/**
 * The quick fix that marks a state final: it extends the reducer's `FINAL_STATES` const when
 * there is one, else adds it to `@final` on the state type.
 */
export function finalFix(machine: Machine, tag: string): Fix | undefined {
  const { reducer } = machine;
  if (reducer.finalConst !== null) {
    const { at: offset, before } = reducer.finalConst.add;
    return {
      title: `Add ${quoted(tag)} to \`${reducer.finalConst.name}\``,
      safe: true,
      edits: [
        {
          location: { file: machine.file, start: offset, end: offset },
          newText: `${before}${quoted(tag)}`,
        },
      ],
    };
  }
  if (reducer.finalFix === null || /\s/.test(tag)) return undefined;
  const { at: offset, create, separator } = reducer.finalFix;
  return {
    title: `Mark ${quoted(tag)} as final`,
    safe: true,
    edits: [
      {
        location: { file: reducer.stateFile, start: offset, end: offset },
        newText: create ? `/** @final ${quoted(tag)} */\n` : `${separator}${quoted(tag)}`,
      },
    ],
  };
}
