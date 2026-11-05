// Next to the shapes of a real project: what still says nothing to the user or a reporter.
type Action = { type: string };
declare function dispatch(action: Action): void;
declare function refresh(): Action;
declare function setLoading(loading: boolean): void;
declare function save(): Promise<void>;
declare function render(): void;

export async function dispatchesSomethingElse(): Promise<void> {
  try {
    await save();
  } catch (e) {
    console.error(e);
    dispatch(refresh());
  }
  render();
}

export async function setsAnotherState(): Promise<void> {
  try {
    await save();
  } catch (e) {
    console.error(e);
    setLoading(false);
  }
  render();
}

export async function oneBranchTells(refusal: boolean): Promise<void> {
  try {
    await save();
  } catch (e) {
    console.error(e);
    dispatch(refusal ? refresh() : { type: "folders/saveError" });
  }
  render();
}
