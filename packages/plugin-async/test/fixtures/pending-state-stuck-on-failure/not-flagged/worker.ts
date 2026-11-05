// A handler assigned in a block at the top of a module, outside any function (excalidraw's
// subset worker): the rule once crashed walking up past the file looking for a `try`.
import { search } from "./requests.js";

export const port: { onmessage?: () => Promise<void> } = {};

if (typeof port.onmessage === "undefined") {
  port.onmessage = async () => {
    await search();
  };
}
