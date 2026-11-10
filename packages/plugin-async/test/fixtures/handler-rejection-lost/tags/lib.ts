import { send } from "sdk";

/** Wrong: `fetch` rejects outside a try. @neverRejects */
export async function loadWrong(url: string): Promise<void> {
  await fetch(url);
}

/** Wrong: it throws. @neverRejects */
export async function validate(value: string): Promise<string> {
  if (value === "") throw new Error("empty");
  return value;
}

async function inner(): Promise<void> {
  await fetch("/inner");
}

/** Wrong: it calls a project function that rejects. @neverRejects */
export async function outer(): Promise<void> {
  await inner();
}

/** Wrong, as an arrow. @neverRejects */
export const ping = async (): Promise<void> => {
  await fetch("/ping");
};

/** Right: the failure is caught. @neverRejects */
export async function loadRight(url: string): Promise<void> {
  try {
    await fetch(url);
  } catch (error) {
    console.error(error);
  }
}

/** Right: a chain that ends in `.catch`. @neverRejects */
export function track(): Promise<void> {
  return fetch("/t")
    .then(() => undefined)
    .catch(() => undefined);
}

/** Not known: a package with no facts. Not reported. @neverRejects */
export async function forward(body: string): Promise<void> {
  await send(body);
}

/** Right: awaits only a function that cannot reject. @neverRejects */
export async function both(): Promise<void> {
  await track();
}

type Command = { kind: "save"; id: string } | { kind: "drop"; id: string };

/** Right: the `throw` sits after a value typed `never`, so it cannot run. @neverRejects */
export async function run(command: Command): Promise<void> {
  switch (command.kind) {
    case "save":
    case "drop":
      try {
        await fetch(`/c/${command.id}`);
      } catch (error) {
        console.error(error);
      }
      return;
    default: {
      const unexpected: never = command;
      throw new Error(`unknown ${String(unexpected)}`);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(String(value));
}

/** Wrong: an exhaustive check in an earlier branch does not make the later `throw` unreachable. @neverRejects */
export async function send(command: Command): Promise<void> {
  let url: string;
  if (command.kind === "save") url = "/s";
  else if (command.kind === "drop") url = "/d";
  else assertNever(command);
  const response = await fetch(url).catch(() => undefined);
  if (response === undefined) throw new Error("server said no");
}

async function handleCommand(command: Command): Promise<void> {
  switch (command.kind) {
    case "save":
    case "drop":
      return;
    default: {
      const unexpected: never = command;
      throw new Error(String(unexpected));
    }
  }
}

/** Right: the function it awaits throws only where it cannot run. @neverRejects */
export async function viaHelper(command: Command): Promise<void> {
  await handleCommand(command);
}
