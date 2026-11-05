// A hook built by a function of the project: stateward cannot read what it returns.
function makeHandlers() {
  return () => ({ onOpen: (id: string) => id });
}

export const useStableCardHandlers = makeHandlers();
