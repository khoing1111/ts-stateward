# @stateward/language-server

The language server behind the Stateward VS Code extension: [stateward](https://github.com/khoing1111/ts-stateward#readme)'s
findings as you type, quick fixes, and hints about the errors a function can throw, for any editor
that speaks the Language Server Protocol.

```bash
npm install --save-dev @stateward/language-server
```

Start it with `npx stateward-language-server`. It talks over stdin and stdout and checks the
project of the nearest `stateward.config.ts`. The VS Code extension uses the copy installed in your
project, else its own.
