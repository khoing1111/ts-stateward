"use strict";
function check(value) {
  if (value < 0) throw new RangeError("negative");
  return value;
}
exports.check = check;
