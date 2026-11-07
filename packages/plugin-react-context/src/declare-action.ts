import ts from "@stateward/core/typescript";
import type { EditorAction, EditorContributions, TextEdit } from "@stateward/core";
import { declareFixOf, guaranteesFileFor } from "./provider-missing/declare-fix.js";
import { fixTitles } from "./provider-missing/messages.js";
import { createResolver } from "./provider-missing/resolve.js";
import type { Edit } from "./provider-missing/summary.js";

type CodeActions = NonNullable<EditorContributions["codeActions"]>;

function toTextEdit(edit: Edit): TextEdit {
  return { location: { file: edit.file, start: edit.start, end: edit.end }, newText: edit.newText };
}

/**
 * "Declare it required" on a context made with no default (`createContext<User | undefined>(undefined)`),
 * so a context whose Providers are all in place can be stated required too, with no finding to
 * start from. The same fix the `provider-missing` finding offers; core tries it before it is shown.
 */
export const codeActions: CodeActions = ({ start, end, sourceFile, types }) => {
  const resolver = createResolver(types);
  const actions: EditorAction[] = [];
  const visit = (node: ts.Node): void => {
    if (node.getEnd() < start || node.getStart() > end) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      resolver.isMissingDefaultContextCall(node.initializer) &&
      resolver.statedContext(node.name) === undefined
    ) {
      const helper = types.isOwnFile(guaranteesFileFor(sourceFile.fileName)) ? "exists" : "missing";
      const fix = declareFixOf(node.initializer, types, helper);
      const [first, ...rest] = fix?.forms ?? [];
      if (fix !== undefined && first !== undefined) {
        actions.push({
          title: fixTitles.declare(node.name.text, fix.call),
          edits: first.map(toTextEdit),
          alternatives: rest.map((form) => ({ edits: form.map(toTextEdit) })),
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return actions;
};
