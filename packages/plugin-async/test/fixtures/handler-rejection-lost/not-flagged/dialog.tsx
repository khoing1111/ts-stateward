// real-world corpus (outline's ConfirmationDialog): the component catches its prop's failure, and the
// module exports it wrapped by name (`export default observer(ConfirmationDialog)`).
declare function observer<T>(component: T): T;
declare function report(error: unknown): void;

type Props = { onSubmit: () => Promise<void> | void };

const ConfirmDialog = ({ onSubmit }: Props) => {
  const submit = async (): Promise<void> => {
    try {
      await onSubmit();
    } catch (error) {
      report(error);
    }
  };
  return <button onClick={() => void submit()} />;
};

export default observer(ConfirmDialog);
