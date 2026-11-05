import { useMemo, useState } from "react";

type Todo = { id: string; title: string };

/** Removing the first todo moves every row up, and each row's input keeps its text. */
export function TodoList({ initial }: { initial: Todo[] }) {
  const [todos, setTodos] = useState(initial);
  const remove = (id: string) => setTodos(todos.filter((todo) => todo.id !== id));
  return (
    <ul>
      {todos.map((todo, index) => (
        <li key={index}>
          <input defaultValue={todo.title} />
          <button onClick={() => remove(todo.id)}>remove</button>
        </li>
      ))}
    </ul>
  );
}

export function TodoListFixed({ initial }: { initial: Todo[] }) {
  const [todos, setTodos] = useState(initial);
  const remove = (id: string) => setTodos(todos.filter((todo) => todo.id !== id));
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>
          <input defaultValue={todo.title} />
          <button onClick={() => remove(todo.id)}>remove</button>
        </li>
      ))}
    </ul>
  );
}

export function SearchableTodos({ todos }: { todos: Todo[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => todos.filter((todo) => todo.title.includes(query)),
    [todos, query],
  );
  return (
    <div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      {visible.map((todo, i) => (
        <label key={`todo-${i}`}>
          <input type="checkbox" />
          {todo.title}
        </label>
      ))}
    </div>
  );
}

export function SortedTodos({ todos }: { todos: Todo[] }) {
  const sorted = [...todos].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <ol>
      {sorted.map((todo, i) => (
        <TodoItem key={i} todo={todo} />
      ))}
    </ol>
  );
}

function TodoItem({ todo }: { todo: Todo }) {
  const [done, setDone] = useState(false);
  return <li onClick={() => setDone(!done)}>{done ? "done" : todo.title}</li>;
}

type Post = { id: string; text: string };

export function Feed({ first }: { first: Post[] }) {
  const [posts, setPosts] = useState(first);
  const publish = (post: Post) => setPosts((current) => [post, ...current]);
  return (
    <section>
      <button onClick={() => publish({ id: "new", text: "hello" })}>post</button>
      {posts.map((post, index) => (
        <article key={String(index)}>
          <textarea defaultValue={post.text} />
        </article>
      ))}
    </section>
  );
}

/** Lines are only added at the end, so a row keeps its position. */
export function Log() {
  const [lines, setLines] = useState<string[]>([]);
  return (
    <pre>
      <button onClick={() => setLines([...lines, "line"])}>add</button>
      {lines.map((line, index) => (
        <code key={index}>{line}</code>
      ))}
    </pre>
  );
}

/** A fixed list never changes. */
export function Legend() {
  return (
    <ul>
      {["low", "medium", "high"].map((level, index) => (
        <li key={index}>{level}</li>
      ))}
    </ul>
  );
}

/** Filtered, but a row is only text: nothing in it can end up on the wrong item. */
export function Tags({ tags, query }: { tags: string[]; query: string }) {
  return (
    <ul>
      {tags
        .filter((tag) => tag.includes(query))
        .map((tag, i) => (
          <li key={i}>{tag}</li>
        ))}
    </ul>
  );
}
