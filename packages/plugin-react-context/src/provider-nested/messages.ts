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

export const notes = {
  outer: (context: string): string => `the outer ${code(context)} Provider`,
  outerIn: (context: string, owner: string): string =>
    `the outer ${code(context)} Provider, which ${code(`<${owner}>`)} renders around it`,
  inside: (tag: string, owner: string, context: string): string =>
    `${code(`<${tag}>`)} is inside ${code(`<${owner}>`)}, which provides ${code(context)}`,
  inner: (context: string): string => `the inner ${code(context)} Provider`,
  renderedUnder: (tag: string, context: string): string =>
    `${code(`<${tag}>`)} is rendered under a ${code(context)} Provider`,
  stated: (context: string): string =>
    `${code(context)} is stated \`SingleProvider\`: one Provider on any render path`,
};
