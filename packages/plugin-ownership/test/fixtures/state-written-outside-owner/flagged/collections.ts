import { cache, items, registry, tags } from "./settings.js";

items.push("a");
registry.set("a", 1);
tags.add("b");
delete cache["old"];
