import { useReducer } from "react";
import { initWizard, wizardReducer } from "./wizard.js";

export function WizardPage({ resume }: { resume: boolean }) {
  const [wizard] = useReducer(wizardReducer, resume, initWizard);
  return <p>{wizard.step}</p>;
}
