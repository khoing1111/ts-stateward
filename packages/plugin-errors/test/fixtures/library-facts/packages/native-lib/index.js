"use strict";
const addon = require("./build/addon.node");
function hash(text) {
  return addon.hash(text);
}
exports.hash = hash;
