/** Every message of `provider-nested`, written once. Code is quoted in backticks. */

export type Message = { message: string; hint: string };

function code(text: string): string {
  return `\`${text}\``;
}

const FIX = (context: string): string =>
  [
    "one of",
    "- remove the inner Provider, so its readers get the outer one's value",
    `- or remove \`SingleProvider\` from the type of ${code(context)}, if a second value for part of the tree is intended`,
  ].join("\n");

export function nested(tag: string, context: string): Message {
  return {
    message: `${code(`<${tag}>`)} is rendered under another ${code(context)} Provider`,
    hint: FIX(context),
  };
}

/** A component that writes a Provider, rendered where one is already above. */
export function rendersNested(component: string, context: string): Message {
  return {
    message: `${code(`<${component}>`)} renders a second ${code(context)} Provider under the first`,
    hint: [
      "one of",
      `- remove ${code(`<${component}>`)} here, so the components inside it read the outer ${code(context)} value`,
      `- or remove \`SingleProvider\` from the type of ${code(context)}, if a second value for part of the tree is intended`,
    ].join("\n"),
  };
}

export function rendersUnderEntry(
  component: string,
  context: string,
  file: string,
  exportName: string,
): Message {
  return {
    message: `${code(`<${component}>`)} renders a second ${code(context)} Provider under the one above entry ${code(`${file}#${exportName}`)}`,
    hint: [
      "one of",
      `- drop the Provider ${code(`<${component}>`)} renders, so its readers get the one above the entry`,
      `- or remove ${code(context)} from ${code("provides")} of that entry in the react-context options`,
    ].join("\n"),
  };
}

export function notFollowed(tag: string, context: string): Message {
  return {
    message: `${code(`<${tag}>`)} is outside any component: whether another ${code(context)} Provider is above it is not proven`,
    hint: `render it in a component's JSX, so stateward can follow where it renders`,
  };
}

const READ_IN_JSX = (context: string): string =>
  [
    `a second ${code(context)} Provider may be rendered under the first here; one of`,
    "- render it in JSX, so stateward can follow where it renders",
    `- or remove \`SingleProvider\` from the type of ${code(context)}, if a second value for part of the tree is intended`,
  ].join("\n");

/** A place the proof cannot follow: not checked, with what it is (`reason`, after "not checked: "). */
export type NotChecked = Message & { reason: string };

function notChecked(reason: string, hint: string): NotChecked {
  // The guarantee's line says what to write instead too: the first way of the hint.
  const way = hint.split("\n").find((line) => line.startsWith("- "));
  return {
    message: `not checked: ${reason}`,
    hint,
    reason: way === undefined ? reason : `${reason}: ${way.slice(2)}`,
  };
}

/** A slot handed on to something not followed (`wrap(children)`) in a component rendered under a Provider. */
export function slotEscapes(text: string, owner: string, context: string): NotChecked {
  return notChecked(
    `${code(text)} in ${code(`<${owner}>`)} cannot be followed`,
    READ_IN_JSX(context),
  );
}

/** A Provider given to a slot its component hands on to something not followed. */
export function providerInEscapingSlot(tag: string, context: string, text: string): NotChecked {
  return notChecked(
    `${code(`<${tag}>`)} is given to ${code(text)}, which cannot be followed`,
    READ_IN_JSX(context),
  );
}

/** A Provider written in a callback of its component (`useMemo(() => <P>…)`): where it renders is not followed. */
export function providerInCallback(tag: string, context: string, callback: string): NotChecked {
  return notChecked(
    `${code(`<${tag}>`)} is written in a callback of ${code(callback)}, which cannot be followed`,
    [
      "one of",
      `- write the Provider in the component's own JSX, so stateward can follow where it renders`,
      `- or remove \`SingleProvider\` from the type of ${code(context)}, if a second value for part of the tree is intended`,
    ].join("\n"),
  );
}

/** A Provider kept in a variable (`const inner = <P>…</P>`): where it renders is not followed. */
export function providerKept(tag: string, context: string, name: string): NotChecked {
  return notChecked(
    `${code(`<${tag}>`)} is kept in ${code(name)}, which cannot be followed`,
    [
      "one of",
      `- write the Provider where it renders, in the component's own JSX, so stateward can follow it`,
      `- or remove \`SingleProvider\` from the type of ${code(context)}, if a second value for part of the tree is intended`,
    ].join("\n"),
  );
}

/** A component that writes a Provider, passed to something that is not followed. */
export function providerEscapes(component: string, context: string, sink: string): NotChecked {
  return notChecked(
    `${code(`<${component}>`)} is passed to ${code(sink)}, which cannot be followed`,
    READ_IN_JSX(context),
  );
}

export const notes = {
  outer: (context: string): string => `the outer ${code(context)} Provider`,
  outerIn: (context: string, owner: string): string =>
    `the outer ${code(context)} Provider, which ${code(`<${owner}>`)} renders around it`,
  inside: (tag: string, owner: string, context: string): string =>
    `${code(`<${tag}>`)} is inside ${code(`<${owner}>`)}, which provides ${code(context)}`,
  itself: (context: string, owner: string): string =>
    `this ${code(context)} Provider is the outer one too: ${code(`<${owner}>`)} renders itself inside it`,
  inner: (context: string): string => `the inner ${code(context)} Provider`,
  renderedUnder: (tag: string, context: string): string =>
    `${code(`<${tag}>`)} is rendered under a ${code(context)} Provider`,
  stated: (context: string): string =>
    `${code(context)} is stated \`SingleProvider\`: one Provider on any render path`,
};
