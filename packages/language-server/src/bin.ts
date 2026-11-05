#!/usr/bin/env node
import { createConnection } from "vscode-languageserver/node";
import { limitHeapGrowth } from "./memory.js";
import { startServer } from "./server.js";

limitHeapGrowth();
const connection = createConnection(process.stdin, process.stdout);
startServer(connection);
connection.listen();
