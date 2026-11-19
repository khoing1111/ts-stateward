declare function save(id: string): Promise<void>;

export function Form({ id }: { id: string }) {
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await save(id);
      }}
    />
  );
}
