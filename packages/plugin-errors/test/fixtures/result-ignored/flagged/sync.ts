import { err, map, ok, tryCatch, type Result } from "./result.js";

declare const user: string;
declare function saveUser(user: string): Result<void, Error>;
declare const repo: { save(user: string): Result<void, Error> };
declare const app: { database: { users: { insertOneUserRecord(user: string): Result<void, Error> } } };

function inferred(flag: boolean) {
  return flag ? ok(1) : err(new Error("no"));
}

export function dropped(): void {
  saveUser(user);
  void saveUser(user);
  (saveUser(user));
  repo.save(user);
  app.database.users.insertOneUserRecord(user);
  inferred(true);
  ok(1);
  map(saveUser(user), () => 1);
  tryCatch(() => 1, () => new Error("failed"));
}

export const arrow = (): void => {
  saveUser(user);
};

export class Store {
  save(): void {
    saveUser(user);
  }
}
