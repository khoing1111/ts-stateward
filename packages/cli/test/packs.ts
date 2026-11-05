import { asyncFlow } from "@stateward/plugin-async";
import { errors } from "@stateward/plugin-errors";
import { ownership } from "@stateward/plugin-ownership";
import { react } from "@stateward/plugin-react";
import { reactContext } from "@stateward/plugin-react-context";
import { records } from "@stateward/plugin-records";
import { reducers } from "@stateward/plugin-reducers";
import { unions } from "@stateward/plugin-unions";

/**
 * The packs themselves, by name: the CLI does not import them (its catalog is static), so its
 * tests do, to check the catalog against them. They are development dependencies.
 */
export const PACK_FACTORIES: Readonly<Record<string, () => { name: string; description: string }>> =
  { unions, records, asyncFlow, reactContext, errors, ownership, reducers, react };
