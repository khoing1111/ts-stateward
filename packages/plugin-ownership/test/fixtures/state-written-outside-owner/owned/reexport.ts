import { appSettings } from "./index.js";
import * as all from "./index.js";

export function viaIndex(): void {
  appSettings.fontSize = 3;
  all.registry.clear();
}
