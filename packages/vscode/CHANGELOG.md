# Changelog

## 1.1.0

- Hover a declaration typed `RequiredContext` or `Owned` to see whether it is proven, and for
  which readers or writers. The code lens above it lists them; "Show the proof path" on an error
  goes through each step from the error to the declaration.
- Messages, quick-fix titles and labels state the problem first, in plain words ("Check again").

## 1.0.0

The first release: findings as you type, quick fixes that are tried before they are offered,
"Explain this rule", ignore comments written for you, rule-by-rule rollout from the status bar, and
inline hints for what a call can throw. The extension runs your project's own stateward when it is
installed, so the editor and `stateward check` agree.

The full history of stateward is in its
[changelog](https://github.com/khoing1111/ts-stateward/blob/main/CHANGELOG.md).
