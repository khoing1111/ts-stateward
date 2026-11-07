import { describe, expect, it } from "vitest";
import { placeListFrom, whereOf, type Place } from "../src/places.js";

const place: Place = {
  uri: "file:///work/app/src/Readers.tsx",
  range: { start: { line: 11, character: 16 }, end: { line: 11, character: 23 } },
  label: "<Profile>",
};

describe("the guarantee commands' argument", () => {
  it("reads a title and its places, in order", () => {
    expect(placeListFrom({ title: "AuthContext: proven for 1 reader", places: [place] })).toEqual({
      title: "AuthContext: proven for 1 reader",
      places: [place],
    });
    expect(placeListFrom({ title: "none", places: [] })).toEqual({ title: "none", places: [] });
  });

  it("refuses anything else, rather than jumping to a wrong place", () => {
    expect(placeListFrom(undefined)).toBeUndefined();
    expect(placeListFrom({ title: "x" })).toBeUndefined();
    expect(placeListFrom({ title: "x", places: [{ ...place, range: {} }] })).toBeUndefined();
    expect(placeListFrom({ title: "x", places: [{ ...place, uri: 3 }] })).toBeUndefined();
  });

  it("shows where a place is from its folder, with a 1-based line", () => {
    expect(whereOf(place, "file:///work/app")).toBe("src/Readers.tsx:12");
    expect(whereOf(place, "file:///elsewhere")).toBe("/work/app/src/Readers.tsx:12");
    expect(whereOf(place, undefined)).toBe("/work/app/src/Readers.tsx:12");
  });
});
