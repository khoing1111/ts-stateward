import { useState } from "react";
import toast from "react-hot-toast";
import { getPlan, savePlan, type Plan } from "./api";

declare function showError(message: unknown): void;
const editor = { open: true };

function closeEditor(): void {
  editor.open = false;
}

function openEditor(plan: Plan): string {
  editor.open = true;
  return plan.details.title;
}

// An example from a real project: a bug in `openEditor` would show "Could not load the plan".
export function usePlanTitle(id: string): { title: string; load: () => Promise<void> } {
  const [title, setTitle] = useState("");
  const load = async (): Promise<void> => {
    try {
      const plan = await getPlan(id);
      setTitle(openEditor(plan));
    } catch (e) {
      showError("Could not load the plan");
    }
  };
  return { title, load };
}

// The lines after the save use nothing from the try, and the catch returns: they can move.
export async function save(plan: Plan, setSaved: (saved: boolean) => void): Promise<void> {
  try {
    await savePlan(plan);
    closeEditor();
    setSaved(true);
  } catch (e) {
    showError(e);
    return;
  }
}

// A parse, then a callback given what was parsed: a bug in the callback would be taken for bad
// JSON (memos' `onEvent(event)` in its server-sent events reader, real-world corpus).
export function readEvent(line: string, onEvent: (event: { type: string }) => void): void {
  try {
    const event: { type: string } = JSON.parse(line);
    onEvent(event);
  } catch {
    // malformed JSON is skipped
  }
}

// A toast is not the request: its package may fail in ways stateward does not know, but nothing
// awaits it. The `try` is for `savePlan`, and `onSaved` is a callback of the function around it
// (outline and memos in the real-world corpus named `toast.success(…)` here).
export async function saveWithToast(plan: Plan, onSaved: () => void): Promise<void> {
  try {
    await savePlan(plan);
    toast.success("Saved");
    onSaved();
  } catch (e) {
    showError(e);
  }
}
