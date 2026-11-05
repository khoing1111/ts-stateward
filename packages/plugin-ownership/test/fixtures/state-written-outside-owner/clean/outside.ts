import ts from "typescript";
import { total, LIMIT } from "./settings.js";
import { ghost } from "./missing.js";

ts.sys.args.push("x");
total.n = LIMIT;
ghost.x = 1;
