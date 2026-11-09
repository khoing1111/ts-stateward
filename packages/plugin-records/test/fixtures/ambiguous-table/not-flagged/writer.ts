import {
  regAssign,
  regCompound,
  regDefine,
  regDelete,
  regDestructure,
  regElement,
  regProperty,
} from "./written-in-other-file.js";

export function write(key: string): void {
  regElement[key] = "y";
  regProperty.extra = "y";
  regCompound[key] += 1;
  delete regDelete[key];
  Object.defineProperty(regDefine, key, { value: "z" });
  Object.assign(regAssign, { [key]: "z" });
  [regDestructure[key]] = ["z"];
}
