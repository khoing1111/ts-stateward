declare function search(query: string): Promise<string[]>;
declare function showError(error: unknown): void;

/** Shows its own failures. @neverRejects */
export type SafeHandler = (query: string) => Promise<void>;

type ToolbarProps = {
  /** Shows its own failures. @neverRejects */
  handleSearch: (query: string) => Promise<void>;
  handleReset: SafeHandler;
  handleExport: (query: string) => Promise<void>;
};

/** @neverRejects */
async function refresh(): Promise<void> {
  try {
    await search("");
  } catch (error) {
    showError(error);
  }
}

export function Toolbar({ handleSearch, handleReset, handleExport }: ToolbarProps) {
  return (
    <div>
      <button
        onClick={async () => {
          await handleSearch("a");
        }}
      />
      <button
        onClick={async () => {
          await handleReset("b");
        }}
      />
      <button
        onClick={async () => {
          await refresh();
        }}
      />
      <button
        onClick={async () => {
          await handleExport("c");
        }}
      />
    </div>
  );
}

/** Awaits `onSubmit` inside its own `try`: a failure is handled here. */
function SearchForm(props: { onSubmit: (query: string) => void | Promise<void> }) {
  const submit = async (): Promise<void> => {
    try {
      await props.onSubmit("query");
    } catch (error) {
      showError(error);
    }
  };
  return <form onSubmit={() => void submit()} />;
}

/** Calls `onSubmit` with nothing to catch a failure. */
function LooseForm({ onSubmit }: { onSubmit: (query: string) => void | Promise<void> }) {
  return <form onSubmit={() => void onSubmit("query")} />;
}

export function Page() {
  return (
    <div>
      <SearchForm
        onSubmit={async (query) => {
          await search(query);
        }}
      />
      <LooseForm
        onSubmit={async (query) => {
          await search(query);
        }}
      />
    </div>
  );
}
