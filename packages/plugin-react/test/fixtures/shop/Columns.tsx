import { memo, useEffect, useState } from "react";

type Column = { key: string; title: string };

/** A plain function, not a hook: a hook cannot be called in it, so the fix is at each call. */
export function getColumns(prefix: string): Column[] {
  return [{ key: `${prefix}-name`, title: "Name" }];
}

function buildColumns(options: { prefix: string }): Column[] {
  return [{ key: `${options.prefix}-name`, title: "Name" }];
}

const Table = memo(function Table({ columns }: { columns: Column[] }) {
  return <table>{columns.length}</table>;
});

export function Report({ prefix }: { prefix: string }) {
  const columns = getColumns(prefix);
  useEffect(() => {
    document.title = columns[0]?.title ?? "";
  }, [columns]);
  return <Table columns={columns} />;
}

/** The argument is itself new every render: memoizing the call alone would not help. */
export function Grid({ prefix }: { prefix: string }) {
  const options = { prefix };
  const columns = buildColumns(options);
  useEffect(() => {
    document.title = columns[0]?.title ?? "";
  }, [columns]);
  return null;
}

/** A hook that calls the plain function: the call in the hook is what to memoize. */
export function useColumns(prefix: string) {
  const [sorted] = useState(false);
  const columns = getColumns(prefix);
  return { columns, sorted };
}

export function SortedReport({ prefix }: { prefix: string }) {
  const { columns } = useColumns(prefix);
  useEffect(() => {
    document.title = columns[0]?.title ?? "";
  }, [columns]);
  return null;
}
