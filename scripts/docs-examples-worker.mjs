// One worker of scripts/docs-examples.mjs: runs the examples of the rules it is given and posts
// [id, result] pairs back.
import { parentPort, workerData } from "node:worker_threads";
import { exampleOutput } from "./docs-examples.mjs";
import { loadPacks } from "./rule-meta.mjs";

const { root, ids } = workerData;
const packs = await loadPacks(root);
const results = [];
for (const id of ids) {
  const [name, key] = id.split("/");
  const plugin = packs.find((pack) => pack.plugin.name === name)?.plugin;
  if (plugin === undefined) throw new Error(`no pack ${name}`);
  results.push([id, await exampleOutput(root, plugin, key, plugin.rules[key].meta.explain)]);
}
parentPort?.postMessage(results);
