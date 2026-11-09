import {
  mapClear,
  mapDelete,
  mapLoose,
  mapPassed,
  mapSet,
} from "./map-written-in-other-file.js";

function fill(target: Map<string, number>): void {
  target.set("b", 2);
}

export function changeMaps(): void {
  mapSet.set("b", 2);
  mapDelete.delete("a");
  mapClear.clear();
  fill(mapPassed);
  const loose = mapLoose.set;
  void loose;
}
