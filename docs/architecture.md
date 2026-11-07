# Architecture

## The pieces

```text
stateward.config.ts ──▶ loadConfig ──▶ Config { tsconfig, include, exclude, plugins, rules }
                                            │
                          ┌─────────────────┴───────────────────┐
                          ▼                                     ▼
                     CLI (check)                     language server (on edit)
                          │                                     │
                          └──────────▶ check(config, overlays) ◀┘
                                            │
                     ┌──────────────────────┼─────────────────────────┐
                     ▼                      ▼                         ▼
             TS 6 programs, one    file rules: check(ctx)    project rules:
             per project in the    per own file, with its    summarize(file) per own file
             tsconfig references   project's TypeQueries     → JSON → check(all summaries)
                                            │
                                            ▼
                 Finding[]: problem | unknown | failure, sorted, capped per rule and file
                                            │
                     ┌──────────────────────┴───────────────┐
                     ▼                                      ▼
            pretty / JSON output, exit code       LSP diagnostics, quick fixes,
                                                  + plugin hover and tokens
```

- **Plugins** are objects passed in the config (dependency injection): `{ name, rules, editor? }`.
  A rule is a file rule (looks at one file) or a project rule (a JSON summary per file, then one
  check over all summaries). The editor contributions add hovers and semantic tokens.
- **Projects.** The configured tsconfig is followed through its `references` (a Vite or other
  solution-style tsconfig lists no files itself). Each project with files is its own program with
  its own options; a file in two projects is checked once. No files at all is an error, never a
  silent pass.
- **One checker per config.** `createChecker` keeps the programs of the last run: the next check
  reuses them (`oldProgram`), and hovers and tokens read them instead of building their own.
- **TypeQueries** is the only door to the type checker: resolve a symbol through imports, find its
  declaration, tell own files from library files, list the literal values of a finite union. Today
  it is TypeScript 6's compiler API; a TS 7 backend replaces that one file.
- **No runtime packages**: apps
  import nothing from stateward. A plugin recognises the app's own code by its shape (a context
  with no default read through a check, a brand's tag, a `Result`'s `ok`).

## Incremental runs

- **Qualified ids.** `SymbolRef.id` is `<file relative to the project>#<path>`
  (`src/cart.ts#useCart.onAdd`): the chain of declaration names, a counter only for a repeated
  name under one parent. A statement `X.y = …` (an expando) is `$expando:y`, counted the same way
  (`#$expando:label$2`). An edit that does not rename or move a declaration keeps its id.
- **Dependency fingerprints** (`backend/fingerprints.ts`). A Merkle hash over the import graph of
  each file's *shape* (what an importer can learn about it through the type checker), whether it
  is own, and how each import resolved; an import cycle is one strongly connected component
  (`graph.ts`); plus a global part (compiler options, lib files, scripts, `declare global`,
  `declare module "…"`); plus the file's own full text. The shape of an own TypeScript module is
  its tokens without comments or layout, leaving out the bodies of functions with a declared
  return type (and setters, constructors, static blocks), the initializers of declared variables,
  properties and parameters, and the declarations it does not export that nothing kept names; it
  keeps JSDoc (`calleeTags` reads its tags) and pragma comments; no offset (a top-level
  `X.y = …` is named by its order among the same-named ones, which the tokens show). Any other
  file's shape is its full text. A function
  without a declared return type keeps its body: its type is inferred from it.
- **Syntax reads.** A rule handed another file's node (`TypeQueries.declarationOf`) can read past
  its shape. Each run on a file gets its own queries object (`ProjectUnit.typesFor`), which notes
  every declaration of another file `declarationOf` hands out, by read id: its qualified id
  (`src/utils.ts#clamp`) for a declaration of an own TypeScript file, else the file's own id
  (`src/utils.ts#`, its whole text): a library or declaration file, JavaScript (types in JSDoc), a
  module, a declaration placed by offset. A declaration read is hashed with what a rule can learn
  around it (`declarationTextHash`): its whole top-level statement with the comments before it
  (parents: a `const`'s keyword, a method's class and other members, a parameter's function; the
  JSDoc), and every other top-level statement related to it by name, transitively (a helper its
  body calls, a private constant whose literal type is read, an import, its overloads and merged
  declarations, `X.y = …`, `export default X`, a local added that shadows a global). Names are
  matched by text, so more is included than needed, never less. The cache entry keeps the read ids
  with their hashes and is reused only while the fingerprint holds and each id still finds a
  declaration in the new program with the same hash: one renamed, moved or removed invalidates.
  Positions are not in the hash (a comment above would move them): when a file's results (its
  findings, a summary's spans) name a read file by path, that file is read whole for the entry
  (engine `readsAfter`). Because the queries object is per file, a plugin's memo kept on it
  (`WeakMap` by queries) lasts one file: nothing a rule learns from another file's syntax can come
  from a memo filled for another file without being noted. A plugin must not memo another file's
  syntax under any other key.
- **What the rules read (audit, 2026-11).** Body or initializer level, so noted as reads:
  `errors` throws inference and the React render tree (callee and component bodies), render
  guards (`useContext` initializers); `async` rejections (callee bodies) and handler components;
  `react` value stability (hooks, `memo(...)` and `useState` initializers); `react-context`
  provider resolution (an imported module's statements, component bodies) and `createContext`
  declarations; `reducers` initial states and reducer signatures; `records` const tables and
  keys; `unions` never-helpers and destructured bindings; `ownership` written variables, classes
  and brand keys. Location only (the file or package a name is declared in; noted too, which
  costs a rerun only when that file's text changes): React and global-object checks across the
  packs, error class ids, enum members. Type level, inside the backend (covered by shapes):
  `calleeTags` (JSDoc), `uniqueSymbolKeyFiles`, `typeAliasOf`, `importSpecifierFor`,
  `callMayChange`, `parameterIsReadonly`, `symbolAt` ids. Library facts read package sources
  outside the program, keyed by the package's manifest as before. Past the read node (audit for
  declaration reads, 2026-11): parents up to the statement (a `const`'s declaration list, a
  method's class: `render-guards`, `ownership`, `isPlatform`), sibling overloads
  (`implementationOf`, `signaturesOf` in `errors`, same name, so related), a module's statements
  (`react-context`'s `namedExportOf`, a module read: its whole file), the other declarations of
  a declaration's file (`brand-built-outside-owner` reads the exported functions' signatures, and
  a body only without a declared return type: all in the shape, which the reader's fingerprint
  carries), and offsets kept in summaries
  (`react-context` `locOf`, the errors pack's React tree, `records` union files): each names the
  file, so the file is read whole. Type questions on a node in a read body depend on the names it
  uses in its file (the related statements) and on what that file imports (the reader's
  fingerprint, through the import graph).
- **The result cache** (`cache.ts`). Per file and fingerprint, per rule key (rule id, code, meta,
  severity, options, add-ons): the findings and a project rule's summary (JSON text and hash),
  with what its rules read of other files (read ids and hashes). Per project rule: the hash of its summaries and the findings its check gave (early cut-off: the
  check reruns only when a summary changed). Results with a failure are not kept.
- **Where it lives.** A checker keeps one in memory for its life (the language server's full pass
  reruns rules only on files whose fingerprint or reads changed). On disk it is one JSON file per project
  and implementation id in `node_modules/.cache/stateward/` (or `STATEWARD_CACHE_DIR`; capped by
  `STATEWARD_CACHE_MAX_MB`), read and written by `disk-cache.ts` in core for both the CLI
  (`--no-cache` skips it) and the language server. The server reads it when it starts a config's
  engine (or reloads the config) and writes it after a full pass that completed, at most every
  30 s, and when the engine stops or the server shuts down; a cancelled pass writes nothing. A
  write goes to a temporary file in the same folder, renamed over the old one, so concurrent
  writers (the CLI and the editor) leave one whole file: the last one wins, and its results are
  keyed by fingerprint and rule key, so either may reuse them. A broken, foreign-version or
  other-implementation file is a cold run, never an error.
- **Recorded programs** (`backend/program-record.ts`). A program built from nothing records every
  answer its compiler host gave (files and folders that exist, text hashes, links, folder
  listings), also when the editor's open documents were served in front of the disk. The next run
  (the CLI, or the language server when it starts) asks the same questions, of the disk with that
  run's open documents in front; when every answer is the same, it takes files and fingerprints
  from the record (and the text hashes of the files rules read) and builds the program only if a
  rule, or an editor request, needs a node or a type.
- **Parsing** sets no parent pointers and skips JSDoc in TypeScript files (as tsc); the binder sets
  parents when the type checker is created (`ProjectUnit.bind`), before any rule sees a node.

## Who owns which fact

| Fact | Owner | Saved in |
| --- | --- | --- |
| Which plugins and rule settings apply | the project's `stateward.config.ts` | the user's repo |
| Which files are checked | the config's tsconfig, include and exclude | the user's repo |
| What a file needs and provides (project rules) | that rule's `summarize` | the result cache: memory (checker), disk (CLI and server) |
| A rule's findings and summary on a file | the rule, under the file's dependency fingerprint | the result cache (below) |
| Whether a program would be built the same | the compiler host's recorded answers | the disk cache (CLI and server) |
| Findings | `check`, recomputed; never edited downstream | nowhere; derived |
| Rule documentation | the rule's `meta.explain` | the plugin package |

## State machines

The language server's check cycle, per workspace.
A full pass checks in slices of about 20 ms and lets the server answer between them; an edit
stops it:

```text
starting ──config loaded──▶ ready
ready ──edit or opening of a file──▶ edited (fast timer 100 ms and full timer 1,000 ms; another edit restarts both)
edited ──fast timer──▶ fast pass (file rules, that file only) ──done──▶ edited (that file's diagnostics published,
                                                                          its project-rule findings kept)
edited ──full timer, or save──▶ full pass (progress begin … end) ──done──▶ ready (all diagnostics replaced)
full pass ──edit of an open file──▶ edited (the pass stops at its next slice, publishes nothing; the
                                           files it finished stay cached for the next one)
full pass ──another full pass asked for──▶ full pass (the running one stops; the new one starts)
ready ──watched file, config reload or closed document──▶ full timer 200 ms ──▶ full pass
full pass or fast pass ──tsconfig error──▶ same state (one error message; earlier diagnostics kept)
full pass or fast pass ──a rule crashed──▶ same state (a failure diagnostic; the rest published)
starting ──config missing or invalid──▶ failed (one error message; no diagnostics)
```

A document still at the version it was opened with (the editor just started, or the file was just
opened) takes its file rules' results from the cache in the fast pass when its fingerprint and
reads hold, as a full pass would (`Checker.checkFiles`, `reusable`): no rule runs and nothing is
type-checked, and when the recorded program replays, nothing is parsed either. Other files run
their rules; the fast pass never writes the cache. Before the first full pass, inlay hints are
answered with nothing when the client can be asked to refresh them (it is, after each full pass),
and semantic tokens with nothing when no plugin colours code: neither builds a program ahead of
the open file's findings. With a saved cache, an editor start is then: config and cache read,
program replayed, the open files' saved findings published, the full pass (all reused), and the
programs built only when a request or an edit needs them.

The progress always ends: `begin` is followed by `end` also when the check throws or stops; it
reports "<n> of <total> files", then "project rules <n> of <total>". The server also sends
`stateward/checking { configFile, checking }` when a full pass starts and ends; the extension's
status bar says "checking project…" meanwhile. The fast pass logs `checked <file> in <ms> ms`, the
full pass `checked <n> files in <s> s: …`, a stopped one `stateward: project check stopped by a
newer change`.
