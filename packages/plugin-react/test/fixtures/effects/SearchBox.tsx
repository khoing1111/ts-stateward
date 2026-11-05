import { useEffect, useMemo, useState } from "react";
import { filterUsers, searchUsers, type User } from "./api.js";

type Filters = { query: string; page: number };

export function UserFilter({ users }: { users: readonly User[] }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<User[]>([]);
  useEffect(() => {
    setVisible(filterUsers(users, query));
  }, [users, query]);
  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul>{visible.map((user) => <li key={user.id}>{user.name}</li>)}</ul>
    </>
  );
}

export function UserFilterFixed({ users }: { users: readonly User[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterUsers(users, query), [users, query]);
  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul>{visible.map((user) => <li key={user.id}>{user.name}</li>)}</ul>
    </>
  );
}

export function SearchResults({ initial }: { initial: Filters }) {
  const [filters, setFilters] = useState<Filters>(initial);
  useEffect(() => {
    setFilters({ ...filters, page: 1 });
  }, [filters]);
  return <p>{filters.query}</p>;
}

export function SearchResultsFixed({ initial }: { initial: Filters }) {
  const [filters, setFilters] = useState<Filters>(initial);
  useEffect(() => {
    if (filters.page !== 1) setFilters({ ...filters, page: 1 });
  }, [filters]);
  return <p>{filters.query}</p>;
}

/** Sets the same text each time: React skips the second render, so there is no loop. */
export function SearchLabel({ query }: { query: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(query);
  }, [query, label]);
  return <p>{label}</p>;
}

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  useEffect(() => {
    async function run() {
      const found = await searchUsers(query);
      setResults(found);
    }
    void run();
  }, [query]);
  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <p>{results.length} results</p>
    </>
  );
}

export function SearchBoxFixed() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const found = await searchUsers(query);
      if (!controller.signal.aborted) setResults(found);
    })();
    return () => controller.abort();
  }, [query]);
  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <p>{results.length} results</p>
    </>
  );
}
