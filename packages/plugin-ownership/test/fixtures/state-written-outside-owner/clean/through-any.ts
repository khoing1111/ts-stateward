import { loose, settings } from "./settings.js";

loose.x = 1;
(settings as any).theme = "x";
(settings.raw as any).key = "x";
