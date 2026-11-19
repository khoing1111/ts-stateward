// real-world corpus (element-web's LinkModal): a handler that waits one tick with a promise whose
// executor only resolves. Nothing here can reject, so the handler is not reported (1.2.1 read any
// `new Promise(…)` as able to reject).
declare function close(): void;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export const WaitATick = () => (
  <form
    onSubmit={async (event) => {
      event.preventDefault();
      close();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
    }}
  />
);
