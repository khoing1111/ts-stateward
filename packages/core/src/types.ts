import type ts from "typescript";
import type { GroupConfigsOf, RuleConfigsOf } from "./options.js";
import type { PRESETS, RULE_TIERS } from "./vocabulary.js";

export type Severity = "error" | "warning" | "info";
export type RuleSetting = Severity | "off";

/** A span in a file. Offsets are 0-based UTF-16 offsets; `file` is absolute. */
export type Location = { file: string; start: number; end: number };
export type RelatedLocation = { location: Location; message: string };
export type TextEdit = { location: Location; newText: string };
/**
 * A quick fix. `safe` (default false) says the fix can be applied without review: it cannot change
 * behaviour or types anywhere else, so `stateward check --fix` applies it. Every other fix is
 * offered in the editor only.
 */
export type FixForm = {
  title: string;
  edits: readonly TextEdit[];
  safe?: boolean;
  /**
   * The fix changes the type of a declaration (an annotation), so code far from its edits may stop
   * compiling: when it is tried, a new error anywhere in the files it edits counts against it, not
   * only one on the lines it edits. Code in other files is not checked: a rule offers such a fix
   * only for a declaration those files cannot see.
   */
  changesType?: true;
  /**
   * Set by core, never by a rule: the edits of `edits` that remove an import this fix leaves
   * unused (`Checker.reviewFixes`). Already part of `edits`; kept apart so fixes applied together
   * can remove such imports once, for the whole set (`Checker.verifyFixSet`).
   */
  importCleanup?: readonly TextEdit[];
};
/**
 * A fix and, in `alternatives`, other ways to write it, in order of preference. Before a fix is
 * offered (the editor's menu, `check --fix`, `check --format json`) each form is applied to a copy
 * of the code and the first that adds no TypeScript error on the lines it edits is the one offered
 * (`Checker.reviewFixes`); a fix none of whose forms compiles is not offered. A plain `check`
 * tries nothing and lists the first form.
 */
export type Fix = FixForm & { alternatives?: readonly FixForm[] };

/**
 * What applying a fix's edits to a copy of the code showed: it adds no TypeScript error on the lines
 * it edits (`compiles`; `removesImports`: the edits that remove the imports it leaves unused), it
 * does (`breaks`, with TypeScript's message), or it could not be tried (`unchecked`: an edit
 * outside every program, or past the end of its file).
 */
export type FixVerdict =
  | { kind: "compiles"; removesImports?: readonly TextEdit[] }
  | { kind: "breaks"; error: string }
  | { kind: "unchecked"; reason: string };

/**
 * Fixes verified as the set applied together (`Checker.verifyFixSet`): per fix, whether it is kept
 * (it compiles with the others), and the edits that make the set: the kept fixes' own edits and
 * the removal of every import the set leaves unused, each once.
 */
export type FixSetReview = { kept: readonly boolean[]; edits: readonly TextEdit[] };

/** A form of a fix that does not compile, and TypeScript's first line about it. */
export type RejectedFix = { title: string; reason: string };

/** One finding after its fixes were tried (`Checker.reviewFixes`). */
export type FixReview = {
  /**
   * The finding with only the fixes that compile, each as its first form that does (without
   * `alternatives`). When it had fixes and none compiles, its hint ends with the line
   * "no automatic fix: <TypeScript's message>".
   */
  finding: Finding;
  /** Fixes that could not be tried: never offered, listed by `check --format json` as not verified. */
  unchecked: readonly FixForm[];
  /** Every form that was tried and does not compile. */
  rejected: readonly RejectedFix[];
};

export type Finding =
  | {
      kind: "problem";
      ruleId: string;
      severity: Severity;
      /** The headline: one line saying what is wrong. */
      message: string;
      /** The one-line change to make. */
      hint: string;
      location: Location;
      related: readonly RelatedLocation[];
      fixes: readonly Fix[];
      /**
       * Which kind of finding this is, for a rule that reports several kinds and lets the config
       * set a severity per kind (`option.severities`); absent for a rule with one kind.
       */
      findingKind?: string;
      /**
       * What the finding is about when another rule may report the same cause there
       * (`ReportProblem.about`); read by `RuleMeta.yieldsTo`, then dropped from the result.
       */
      about?: Location;
    }
  /**
   * Analysis could not decide: always reported, never silent. `hint` says what would make it
   * checkable. `shown` is how the config's `unknowns` setting shows it: absent for an info,
   * "warning", or "off" (left out of the list and the editor, still counted in the summary).
   */
  | {
      kind: "unknown";
      ruleId: string;
      message: string;
      hint: string;
      location: Location;
      shown?: "warning" | "off";
      /** The rule asks for its places not checked to be listed (`RuleMeta.listUnknowns`). */
      listed?: true;
    }
  /** A rule threw: the check is incomplete, so it fails CI. */
  | { kind: "failure"; ruleId: string; message: string; hint: string; location: Location };

export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/**
 * Where a rule sits in its pack: `core` carries the guarantee, `coverage` finds
 * code outside the pack's standard, `addon` is opt-in by name.
 */
export type RuleTier = (typeof RULE_TIERS)[number];

export type BooleanOption = { kind: "boolean"; default: boolean; description: string };
export type NumberOption = {
  kind: "number";
  default: number;
  description: string;
  min?: number;
  max?: number;
  /** When true, only whole numbers are accepted. */
  integer?: boolean;
};
export type StringOption<T extends string = string> = {
  kind: "string";
  default: T;
  description: string;
  /** When present, the only values accepted. */
  oneOf?: readonly T[];
};
export type StringsOption = { kind: "strings"; default: readonly string[]; description: string };
/** Names to lists of strings, such as a file glob and the globs that may write to it. */
export type StringListRecord = Readonly<Record<string, readonly string[]>>;
export type RecordOption = { kind: "record"; default: StringListRecord; description: string };
/** A severity (or "off") per kind of finding, set by the config; a kind it leaves out keeps the rule's severity. */
export type SeverityMap<K extends string = string> = Readonly<Partial<Record<K, RuleSetting>>>;
/**
 * The severity of each kind of finding a rule reports, where the kinds differ in how sure the rule
 * is. `kinds` names each kind and says in plain words what it is; the rule passes the kind to
 * `report`. The default sets none, so every kind has the rule's own severity.
 */
export type SeveritiesOption<K extends string = string> = {
  kind: "severities";
  kinds: Readonly<Record<K, string>>;
  /** Always empty: every kind starts at the rule's own severity. */
  default: SeverityMap;
  description: string;
};

/** One option of a rule, declared once in `RuleMeta.options` (build it with `option.*`). */
export type OptionSpec =
  BooleanOption | NumberOption | StringOption | StringsOption | RecordOption | SeveritiesOption;
export type OptionSpecs = Readonly<Record<string, OptionSpec>>;
/** The specs of a rule that declares no options (what `defineRule` infers when `meta.options` is absent). */
export type NoOptions = Readonly<Record<string, never>>;
/** What an option can hold once parsed. */
export type OptionValue =
  boolean | number | string | readonly string[] | StringListRecord | SeverityMap;
export type Options = Readonly<Record<string, OptionValue>>;

/** The value type of one option spec. */
export type OptionValueOf<O extends OptionSpec> = O extends BooleanOption
  ? boolean
  : O extends NumberOption
    ? number
    : O extends StringsOption
      ? readonly string[]
      : O extends RecordOption
        ? StringListRecord
        : O extends SeveritiesOption<infer K>
          ? SeverityMap<K>
          : O extends StringOption<infer T>
            ? T
            : never;

/** The typed values a rule receives for its declared options. */
export type OptionsOf<S extends OptionSpecs> = { readonly [K in keyof S]: OptionValueOf<S[K]> };

/**
 * What a pack says about a rule before its code is loaded: everything but the `explain` text,
 * which stays in the rule's module. Everything that only reads a rule's settings
 * (config checks, presets, groups, plan, the docs tables) reads this.
 */
export type RuleInfo<S extends OptionSpecs = OptionSpecs, G extends string = string> = {
  description: string;
  defaultSeverity: Severity;
  tier: RuleTier;
  /**
   * The group of its pack this rule belongs to (kebab-case, e.g. `switches`). A pack's groups are
   * derived from its rules; a config sets one as `groups: { "<plugin>/<group>": severity }`
   *.
   */
  group: G;
  /** The add-on this rule belongs to (kebab-case); present exactly when `tier` is "addon". */
  addon?: string;
  /**
   * Add-ons (kebab-case) that widen what this core or coverage rule checks. The rule reads which
   * are on from `FileContext.addons`; they count as add-ons of the plugin, so a config may list them.
   */
  widenedBy?: readonly string[];
  /** A guess, never an error: its severity is capped at "warning" unless the config sets it. */
  heuristic?: true;
  /**
   * The rule reads JSDoc in TypeScript files (`@throws`). Files are parsed as tsc parses them,
   * without the JSDoc of TypeScript files, unless a rule that is on asks for it: parsing it costs
   * time on every file.
   */
  needsJsDoc?: true;
  /**
   * Its places not checked are listed by `check` like warnings, not only counted: the developer
   * asked for exactly this check (`@mustHandle` on an error), so a gap in it is news to them.
   */
  listUnknowns?: true;
  /**
   * Rules of the same pack (their keys) whose finding on the same thing says it better: a finding
   * of this rule whose `about` is where one of them reports a problem is left out (one cause, one
   * message). The rules named must be on for it to apply.
   */
  yieldsTo?: readonly string[];
  /**
   * The settings a team may change in the config (`rules: { id: [severity, { name: value }] }`),
   * each declared once here: type, default and description. The rule reads them from `ctx.options`;
   * the generated docs list them.
   */
  options?: S;
  /**
   * Options this rule reads from another rule of its pack, by option name to that rule's key
   * (`{ stableHooks: "dependency-changes-every-render" }`): one setting for both rules. The rule
   * declares the option too; what the config gives there is joined with the other rule's list
   * (`ctx.options` holds both). Only list options (`option.strings`) can be shared.
   */
  sharedOptions?: Readonly<Record<string, string>>;
};

export type RuleMeta<S extends OptionSpecs = OptionSpecs, G extends string = string> = RuleInfo<
  S,
  G
> & {
  /** Markdown shown by `stateward explain`. */
  explain: string;
};

/** One member of a finite literal union; `label` is how TypeScript prints it, e.g. `Color.Red`. */
export type Literal = { value: string | number | boolean | null | undefined; label: string };

/**
 * A test that narrows a reference by the kind of value it holds rather than by a literal:
 * `typeof x === "string"`, `"p" in x`, `x instanceof C` and a call to a user type guard.
 */
export type NarrowingTest =
  | { kind: "typeof"; typeName: string }
  | { kind: "in"; property: string }
  | { kind: "instanceof"; constructorExpression: ts.Expression }
  | { kind: "guard"; call: ts.CallExpression };

/**
 * The members of a reference's type, by the label TypeScript prints, sorted and each once, and
 * those of them that are gone from its type in the `else` of a test (so a chain of tests covers a
 * member when one of them removes it).
 */
export type NarrowedMembers = { members: readonly string[]; removed: readonly string[] };

/**
 * `id` is the qualified id "<file relative to the project>#<path>" (`src/cart.ts#useCart.onAdd`;
 * the module itself is "<file>#"): stable across runs and across edits that do not rename or move
 * the declaration.
 */
export type SymbolRef = { readonly id: string; readonly name: string };

/** A type alias by its name and the file that declares it. */
export type AliasRef = { readonly name: string; readonly file: string; readonly promised: boolean };

/**
 * The only way rules reach the type checker. This is the backend interface: a TypeScript 7
 * backend replaces its implementation later.
 */
export type TypeQueries = {
  /** Aliases (imports, re-exports) are resolved to the original declaration. */
  symbolAt(node: ts.Node): SymbolRef | undefined;
  declarationOf(symbol: SymbolRef): { file: string; node: ts.Node } | undefined;
  /** In the checked set: not node_modules, not .d.ts, not excluded. */
  isOwnFile(file: string): boolean;
  /**
   * The `name` in the nearest package.json above a file that has one (a package.json that is not
   * JSON, or has no name, is passed over), or undefined. A rule tells a library's declarations by
   * it: it holds for a built copy in node_modules, a workspace link and the source alike. Read
   * through the program, so a renamed package changes the dependency fingerprints.
   */
  packageOf(file: string): string | undefined;
  /**
   * The finite literal union of the node's type (a type parameter is widened to its constraint),
   * sorted by label so the order does not depend on what TypeScript checked earlier.
   */
  literalsOf(node: ts.Node): readonly Literal[] | "not-finite";
  /**
   * The property names of the type of an expression, split by whether the property may be absent.
   * `indexSignature` is true when the type also has a string or number index signature.
   * `"not-object"` for a primitive, a union, an array, a tuple or an array-like (a number index and a numeric `length`, such as
   * `RegExpMatchArray`): the rules that ask do not apply.
   * `"generic"` when the keys depend on a type parameter (`Record<K, string>`, `{ [P in K]: n }`):
   * the properties are not known until `K` is, so the type has no key list to judge.
   */
  propertyKeysOf(
    node: ts.Node,
  ):
    | { required: readonly string[]; optional: readonly string[]; indexSignature: boolean }
    | "not-object"
    | "generic";
  /** Whether the type of an expression includes `undefined`; `any` and `unknown` count as yes. */
  canBeUndefined(node: ts.Node): boolean;
  /** Whether the type of an expression includes `null`; `any` and `unknown` count as yes. */
  canBeNull(node: ts.Node): boolean;
  /**
   * Whether `propertyName` discriminates the type of the object expression (a type parameter
   * widened to its constraint): the type is a union, every member is an object type (an
   * intersection too) whose property is a literal or a union of literals (string, number, boolean,
   * enum member), and not every member has the same one. Then narrowing on `object.propertyName`
   * narrows `object` itself, as TypeScript does: `object` is `never` in a `default` that handles
   * every case, and `object.propertyName` no longer compiles there. `null` and `undefined` members
   * are ignored (`s?.kind` with `s: S | undefined` narrows `s`). False for a plain object, when
   * every member has the same union (`"x" | "y"`), or when a property is optional or wider.
   */
  isDiscriminant(object: ts.Node, propertyName: string): boolean;
  /** The type of an expression as TypeScript prints it, on one line (`Record<string, string>`). */
  typeTextOf(node: ts.Node): string;
  /**
   * The type the surrounding code expects for an expression, as `typeTextOf` prints it: for a
   * function written as a JSX attribute, the declared type of that prop (`() => Promise<void>`);
   * for an argument, its parameter's type. Undefined when nothing around it gives one.
   */
  contextualTypeTextOf(node: ts.Expression): string | undefined;
  /**
   * Whether the type the surrounding code expects for an expression (as `contextualTypeTextOf`)
   * is a function that returns a promise: every member but `undefined` and `null` can be called,
   * and every call signature returns only promise-like types (not `void | Promise<void>`). Read from the type, not its text, so a
   * type alias (`onSave: SaveHandler`) or a method (`onSave(): Promise<void>`) counts. False when
   * nothing gives one.
   */
  expectsPromiseReturn(node: ts.Expression): boolean;
  /**
   * Whether argument `argumentIndex` of the call goes to a parameter that the called function's
   * declaration types as the `never` keyword. A rest parameter or a missing declaration is false.
   */
  parameterIsNever(call: ts.CallExpression, argumentIndex: number): boolean;
  /**
   * The files that declare the unique-symbol keys (`[key]: …` where `key` is a `unique symbol`)
   * of the properties of a type, sorted, each once. The node is an expression or a type node.
   * Empty for a type with no such key. A library that brands types with a private symbol is
   * recognised by where that symbol is declared.
   */
  uniqueSymbolKeyFiles(node: ts.Node): readonly string[];
  /**
   * The type alias a value's type is an instance of, found from its declaration: after awaiting a
   * `Promise`, every member of the type must be written in the same alias (`Result<T, E>` and
   * `Promise<Result<T, E>>` both give `Result`, however the alias is renamed or its members are
   * merged by inference). `promised` is whether the node's type is a promise. Undefined for a type
   * with another member (`undefined`, a primitive) or members of different aliases. A library is
   * recognised by where its alias is declared.
   */
  awaitedAliasOf(node: ts.Node): AliasRef | undefined;
  /** As `awaitedAliasOf`, for what a function declaration, function expression, arrow or method returns (declared or inferred). */
  returnAliasOf(fn: ts.SignatureDeclaration): AliasRef | undefined;
  /**
   * The type alias that names the type of an expression as written (`TouchpointStatus` for
   * `touchpointStatus()` declared to return it; a type parameter widened to its constraint), or
   * undefined when the type has no alias or the alias takes type arguments.
   */
  typeAliasOf(node: ts.Node): { readonly name: string; readonly file: string } | undefined;
  /**
   * Where `fromFile` would import the type alias `name` declared in `file` from, written as
   * TypeScript's own auto-import writes it: a relative path to a checked file (with `.js`, `.ts`
   * or no extension, as the relative imports of `fromFile` already end, else as the module
   * resolution needs), or the package's name when its entry exports the alias. Undefined when
   * the declaring module does not export it under that name, or when `fromFile` is `file`.
   */
  importSpecifierFor(alias: { name: string; file: string }, fromFile: string): string | undefined;
  /**
   * Whether the type of `from` (an expression), without `null` and `undefined`, is assignable to
   * the type of `to` (a type node), without them: a cast from one to the other only removes
   * `null` or `undefined` and builds nothing new. False when `from` is `any` or `unknown`, which
   * are assignable to everything and so prove nothing.
   */
  isAssignableWithoutNullish(from: ts.Node, to: ts.Node): boolean;
  /**
   * Whether argument `argumentIndex` of the call goes to a parameter through which the callee
   * cannot add, change or remove a key: `Readonly<Record<string, V>>`, a type with a `readonly`
   * index signature and no writable property, `ReadonlyMap`, `ReadonlySet` or `ReadonlyArray`
   * (each possibly with `null` or `undefined`). A rest parameter, an argument after a spread, a
   * type parameter without such a constraint, `any` and a missing declaration are false. Properties
   * count as readonly only when declared `readonly`, so `Readonly<{ a: string; [k: string]: string }>`
   * is false.
   */
  parameterIsReadonly(call: ts.CallExpression, argumentIndex: number): boolean;
  /**
   * What `test` does to the type of `reference` (a type parameter widened to its constraint,
   * split into union members): which members the test removes from the type in its `else`, as
   * TypeScript's own narrowing does. `"undecided"` when that cannot be said without guessing:
   * a member that is not an object, a primitive or a literal the form can place, a custom
   * `Symbol.hasInstance`, a type guard on `any`, a name that is not a `typeof` result, two members
   * with one label.
   */
  narrowedBy(reference: ts.Node, test: NarrowingTest): NarrowedMembers | "undecided";
  /**
   * The argument that a call to a user type guard (`isX(value): value is X`, not `asserts`) tells
   * the type of; undefined when the called function is not a type guard on a parameter.
   */
  guardedArgument(call: ts.CallExpression): ts.Expression | undefined;
  /**
   * Whether the type of an expression is TypeScript's error type: it came from something that does
   * not resolve (an import of a missing package, an unknown name). Unlike a written `any`, it
   * says the type is unknown here, so a rule must not read it as `string` or as anything else.
   */
  isErrorType(node: ts.Node): boolean;
  /**
   * Whether the type of an expression is promise-like: awaiting it gives another type
   * (`Promise<T>`, a thenable, `Promise<T> | undefined`). `any` and `unknown` are false.
   */
  isPromiseLike(node: ts.Node): boolean;
  /** As `isPromiseLike`, for what a function declaration, function expression, arrow or method returns (declared or inferred). */
  returnsPromiseLike(fn: ts.SignatureDeclaration): boolean;
  /**
   * Whether the type of an expression surely has property `name` with a value: every member of
   * its type (a type parameter widened to its constraint) declares it, not optional, and its type
   * does not include `undefined`, `void`, `null`, `any` or `unknown`.
   */
  hasDefinedProperty(node: ts.Node, name: string): boolean;
  /**
   * The names of the properties typed `never` in a member of the union an expression is read as:
   * its contextual type (what a setter or a parameter accepts) when it has one, else its own type
   * (a function that takes a union is not a member with properties: it adds none). `{ status:
   * "failed"; error: never }` gives `error`: the type says nothing can fill that field, so the
   * state cannot happen. Sorted, without duplicates; empty when the type is not known.
   */
  neverFieldsOf(node: ts.Expression): readonly string[];
  /**
   * Whether the value of an expression can be called: its type, without `null` and `undefined`
   * (a type parameter widened to its constraint), has a call signature in every member. `any`
   * and `unknown` are false.
   */
  isCallable(node: ts.Node): boolean;
  /**
   * The properties that tell the members of the type of `node` apart (a type parameter widened to
   * its constraint; `null` and `undefined` members ignored), sorted: the type is a union of two
   * or more object types, every member has the property with one unit literal type, and the
   * literals are not all the same. Empty for any other type.
   */
  discriminantsOf(node: ts.Node): readonly string[];
  /**
   * The literal values `property` takes over the members of the type of `node` (a type parameter
   * widened to its constraint; `null` and `undefined` members ignored), sorted by label, each
   * once. A reference's narrowed type counts: after `if (state.status !== "paying") return state`,
   * `state` gives only "paying". `"not-finite"` when a member lacks the property or its type is
   * not a union of unit literals (a `string`), or for a type with no object member. Empty for
   * `never` (a value that cannot exist has no tag).
   */
  tagsOf(node: ts.Node, property: string): readonly Literal[] | "not-finite";
  /**
   * As `tagsOf`, for the type an expression gives once awaited (the type itself when it is not a
   * promise), with how many members that type has (`null` and `undefined` left out): a union of
   * two objects told apart by `ok: true` and `ok: false` has 2, an object with `ok: boolean` has 1.
   * `"missing"` when a member is not an object type or does not have the property at all (a
   * method has it: its type is not a unit literal, so its tags are `"not-finite"`). `any`,
   * `unknown` and a type with only `null` and `undefined` are `"missing"`.
   */
  awaitedTagsOf(
    node: ts.Node,
    property: string,
  ): { readonly members: number; readonly tags: readonly Literal[] | "not-finite" } | "missing";
  /**
   * Whether the property access `a.b.c` can never be assigned through: each property on the path
   * is `readonly` in every member of its object's type, declared so or by a `readonly` mapped
   * type (`Readonly<T>`). False for anything that is not a property access chain.
   */
  isReadonlyPath(node: ts.Expression): boolean;
  /**
   * Whether the call may change what it is given: `argument` is the index of an argument, or
   * `"receiver"` for the object a method is called on. True only when the callee's declaration is
   * in a checked file and, for an argument, its declared parameter type (not the instantiated
   * one) is an object type with a writable property, a method or a writable index signature.
   * False when the callee cannot be found or is declared in a library (stateward cannot see what
   * it does), when the parameter is `readonly` all through, a rest parameter, a primitive,
   * `unknown` or `any`, or the argument follows a spread.
   */
  callMayChange(call: ts.CallExpression | ts.NewExpression, argument: number | "receiver"): boolean;
  /**
   * Whether a file is an entry of the package it belongs to: named by the nearest package.json's
   * `main`, `module`, `types` or `exports` (a build folder `dist`, `build`, `lib` or `out` is
   * read as `src`; a `*` pattern is not followed). Code outside the checked files can import
   * what such a file exports.
   */
  isPackageEntry(file: string): boolean;
  /**
   * The packages the nearest package.json above a file (any, named or not) lists in
   * `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`, sorted, each
   * once; empty when there is none or it is not JSON. A rule tells by it which tools the project
   * uses (a compiler plugin that changes what the code means). Read through the program, so a
   * changed manifest changes the fingerprints of the files under it.
   */
  dependenciesOf(file: string): readonly string[];
  /**
   * Whether every value of an expression's type is compared by value: string, number, bigint,
   * boolean, an enum, a literal of these, `null`, `undefined` or `void`, or a union of them (a
   * type parameter widened to its constraint). Two equal such values are `===`, so a new one each
   * time is still the same value. False for objects, functions, symbols, `any` and `unknown`.
   */
  isPrimitive(node: ts.Node): boolean;
  /**
   * Whether the type of an expression is declared outside the project: in a package (a file found
   * through node_modules) or in TypeScript's own lib. What is asked is where the type is named: its
   * alias (`type Mode = ...`), its enum, or, for a property read (`event.type`), the property; a
   * type parameter is widened to its constraint. False when that place is a project file, and when
   * the type has no such place (a union written inline on a local, `"a" | "b"`).
   */
  isLibraryType(node: ts.Node): boolean;
  /**
   * The index signature of the type of an expression (a type parameter widened to its
   * constraint): its key kind (`string` wins over `number`), its value type as TypeScript prints
   * it, and whether that value type includes `undefined` (`Partial<Record<string, V>>`,
   * `{ [key: string]: V | undefined }`: a lookup may find nothing, and the type says so).
   * Undefined for a type without one.
   */
  indexSignatureOf(
    node: ts.Node,
  ): { keyKind: "string" | "number"; valueText: string; valueCanBeUndefined: boolean } | undefined;
  /**
   * Whether the value of an expression is a promise that reports failure in its value instead of
   * rejecting: its type has an `unwrap` method (the call that rejects instead), and what it
   * resolves to is a union with a member that has an `error` property (`{ data } | { error }`).
   * Awaiting it never throws for that failure. `any` and `unknown` are false.
   */
  settlesWithError(node: ts.Node): boolean;
  /**
   * The JSDoc tag names (without `@`) written on what a call calls: the function itself, the
   * property or variable it is reached through (a prop destructured from a parameter included),
   * and the type alias of its type. A project's way to say what no type can (`@neverRejects`).
   * The project's JSDoc is parsed only when a rule that is on sets `needsJsDoc`.
   */
  calleeTags(call: ts.CallExpression): readonly string[];
};

export type ReportProblem = {
  message: string;
  hint: string;
  node: ts.Node;
  /** The kind of finding, one of the rule's `option.severities` kinds; its severity comes from there. */
  findingKind?: string;
  /**
   * A lower severity for a finding the rule itself judges a weaker signal: `"info"` (a `default`
   * that hides many cases often means "everything else"), or `"warning"` for a guess. It
   * only ever lowers the rule's severity, never raises it. A severity the config gives this
   * finding's kind (`option.severities`) still wins over it.
   */
  severity?: "info" | "warning";
  related?: readonly { node: ts.Node; message: string }[];
  fixes?: readonly Fix[];
  /**
   * What the finding is about, when another rule of the pack may report that same thing (the
   * table a lookup reads): with `RuleMeta.yieldsTo`, one cause gives one message.
   */
  about?: ts.Node;
};

/**
 * What the config says about a package's functions, by
 * package name, then by function: its name (`get`) or its path in the package's types
 * (`AxiosInstance.get`). `throws` names the classes a call throws, `rejects` those its promise
 * rejects with; a class is named as the package exports it (`AxiosError`) or as a built-in
 * (`TypeError`). An empty list says "nothing".
 */
export type FunctionFacts = {
  readonly throws?: readonly string[];
  readonly rejects?: readonly string[];
};
export type PackageFactsConfig = Readonly<Record<string, Readonly<Record<string, FunctionFacts>>>>;

/** Where a library fact comes from, in order of trust. */
export type FactSource = "config" | "declared" | "inferred" | "unknown";

/**
 * How a plugin knows the functions of one package the project calls, for `stateward deps`: each
 * function by its name, where its facts come from, and why what is unknown is unknown.
 */
export type LibraryUse = {
  readonly package: string;
  readonly version: string;
  readonly functions: readonly {
    readonly name: string;
    readonly source: FactSource;
    /** Why the function is not fully known; empty when it is. */
    readonly unknown: readonly string[];
  }[];
};

export type FileContext<O extends Options = Options> = {
  readonly file: string;
  /** The config's facts about packages (`facts`); `{}` when it gives none. */
  readonly facts: PackageFactsConfig;
  /** The rule's options: the config's values with the defaults filled in; `{}` when it declares none. */
  readonly options: O;
  readonly sourceFile: ts.SourceFile;
  readonly types: TypeQueries;
  /** The add-ons of this rule's plugin that the config switches on, without the plugin prefix. */
  readonly addons: readonly string[];
  report(problem: ReportProblem): void;
  unknown(input: { message: string; hint: string; node: ts.Node }): void;
};

/** Project rules decide from their JSON summaries alone, so their results can be cached. */
export type ProjectContext<O extends Options = Options> = {
  /** The rule's options, as in `FileContext`. */
  readonly options: O;
  report(problem: {
    message: string;
    hint: string;
    location: Location;
    /** As in `ReportProblem`. */
    findingKind?: string;
    /** As in `ReportProblem`. */
    severity?: "info" | "warning";
    related?: readonly RelatedLocation[];
    fixes?: readonly Fix[];
  }): void;
  unknown(input: { message: string; hint: string; location: Location }): void;
};

export type FileRule<S extends OptionSpecs = OptionSpecs, G extends string = string> = {
  kind: "file";
  meta: RuleMeta<S, G>;
  check(ctx: FileContext<OptionsOf<S>>): void;
};

export type ProjectRule<
  Summary extends Json = Json,
  S extends OptionSpecs = OptionSpecs,
  G extends string = string,
> = {
  kind: "project";
  meta: RuleMeta<S, G>;
  /** Per file and cacheable, hence JSON. */
  summarize(ctx: FileContext<OptionsOf<S>>): Summary | undefined;
  check(summaries: ReadonlyMap<string, Summary>, ctx: ProjectContext<OptionsOf<S>>): void;
  /**
   * For `stateward plan` and `coverage`: why this rule, though on, cannot report anything in this
   * project, as a short phrase after "silent: "; undefined when it can. Only for a reason that is
   * structural and known from the summaries (a root error boundary), never "no findings".
   */
  silentReason?(
    summaries: ReadonlyMap<string, Summary>,
    ctx: { readonly options: OptionsOf<S> },
  ): string | undefined;
};

export type Rule = FileRule | ProjectRule;

/** A rule as a pack declares it up front: its kind and its metadata (`RuleInfo`). */
export type RuleDeclaration<S extends OptionSpecs = OptionSpecs, G extends string = string> = {
  kind: "file" | "project";
  meta: RuleInfo<S, G>;
};

/**
 * A rule whose code is loaded only when it is on (`lazyRule`): core loads it before a check
 * (`loadRules`), so a rule that is off never loads, nor what only it imports.
 */
export type LazyRule<S extends OptionSpecs = OptionSpecs, G extends string = string> = {
  kind: "lazy";
  /** What the loaded rule is. */
  ruleKind: "file" | "project";
  meta: RuleInfo<S, G>;
  /** Loads the rule's module (once) and returns the rule, as its module defines it. */
  load(): Promise<Rule>;
  /** The rule once its module is loaded (by this plugin or another instance of it), else undefined. */
  loaded(): Rule | undefined;
};

/** A rule of a plugin: its code given directly, or loaded when it is on. */
export type PluginRule = Rule | LazyRule;

/** A subset of the LSP standard semantic token types. */
export type TokenType = "class" | "function" | "variable" | "type" | "decorator" | "keyword";

/**
 * One inline hint a plugin shows in the editor, at `offset`
 * (`EditorContributions.inlayHints`). `kind` names the sort of hint, so the editor can turn each
 * sort off on its own (the `stateward.inlayHints.<kind>` setting).
 */
export type EditorHint = {
  offset: number;
  kind: string;
  label: string;
  /** Space before the label (LSP `paddingLeft`). */
  paddingLeft?: true;
  /** Markdown shown on hover: where the label comes from. */
  tooltip?: string;
};

/**
 * A refactoring a plugin offers at a place in the editor, with no finding behind it
 * (`EditorContributions.codeActions`). Core tries its edits on a copy of the code like a fix's,
 * and offers it only when they compile (`Checker.refactors`).
 */
export type EditorAction = { title: string; edits: readonly TextEdit[] };

export type EditorContributions = {
  /** Returns markdown. */
  hover?(input: {
    file: string;
    offset: number;
    sourceFile: ts.SourceFile;
    types: TypeQueries;
    /**
     * The summaries a project rule produced in the last full `check` (JSON, by file), or undefined
     * when that rule did not run or no full check ran yet. The same `Map` object is handed out
     * until a full check produces different summaries, so a plugin may cache what it derives
     * from it.
     */
    projectSummaries(ruleId: string): ReadonlyMap<string, Json> | undefined;
  }): string | undefined;
  tokens?(input: {
    file: string;
    sourceFile: ts.SourceFile;
    types: TypeQueries;
  }): readonly { location: Location; type: TokenType }[];
  /**
   * Inline hints for a file, from the last full check's summaries (as `hover`: no new program, so
   * it is fast enough to run on every scroll). Any order; the editor sorts them.
   */
  inlayHints?(input: {
    file: string;
    sourceFile: ts.SourceFile;
    types: TypeQueries;
    projectSummaries(ruleId: string): ReadonlyMap<string, Json> | undefined;
  }): readonly EditorHint[];
  /**
   * Refactorings for the code between offsets `start` and `end` of a file, from the last full
   * check's summaries (as `hover`). None is a fix of a finding: the editor lists them as
   * refactorings, after core has tried each.
   */
  codeActions?(input: {
    file: string;
    start: number;
    end: number;
    sourceFile: ts.SourceFile;
    types: TypeQueries;
    projectSummaries(ruleId: string): ReadonlyMap<string, Json> | undefined;
  }): readonly EditorAction[];
  /**
   * The packages the project calls and how the plugin knows their functions, from the last full
   * check's summaries (as `hover`): what `stateward deps` prints.
   */
  libraryFacts?(input: {
    projectSummaries(ruleId: string): ReadonlyMap<string, Json> | undefined;
  }): readonly LibraryUse[];
};

/** Rule ids are "<plugin name>/<rule key>". */
export type Plugin = {
  name: string;
  /** One line, shown in the docs and by `stateward init`. */
  description: string;
  rules: Readonly<Record<string, PluginRule>>;
  editor?: EditorContributions;
};

/** A plugin that keeps its literal name and rule keys, as `definePlugin` returns it. */
export type PluginOf<N extends string, R extends Readonly<Record<string, PluginRule>>> = {
  name: N;
  description: string;
  rules: R;
  editor?: EditorContributions;
};

/** Every rule id ("<plugin>/<rule key>") a plugin type offers; any string pair for a wide `Plugin`. */
export type RuleIdOf<P extends Plugin> = P extends Plugin
  ? `${P["name"]}/${Extract<keyof P["rules"], string>}`
  : never;

/** Every group id ("<plugin>/<group>") a plugin type offers; any string pair for a wide `Plugin`. */
export type GroupIdOf<P extends Plugin> = P extends Plugin
  ? `${P["name"]}/${P["rules"][Extract<keyof P["rules"], string>]["meta"]["group"]}`
  : never;

/** `recommended`: coverage findings are info. `strict`: they are errors. */
export type Preset = (typeof PRESETS)[number];

/** What `ignores` in the config sets: how strict stateward is about `stateward-ignore` comments. */
export type IgnoreOptions = {
  /** A comment without a reason after the colon is a warning. */
  requireReason: boolean;
  /** A comment that covers nothing is reported at this level, or not at all. */
  reportUnused: "error" | "warning" | "off";
};

/**
 * One `overrides` entry, validated: settings for the files its globs match (relative to the config's
 * folder). Later entries win over earlier ones, and all win over the config's own settings.
 */
export type ConfigOverride = {
  files: readonly string[];
  /** Only set when the entry names a preset. */
  preset?: Preset;
  addons: readonly string[];
  groups: Readonly<Record<string, RuleSetting>>;
  rules: Readonly<Record<string, RuleSetting>>;
};

export type Config = {
  /**
   * The TypeScript projects to check, as absolute paths or absolute globs, in the order
   * given. Each is followed through its `references`; a file in two is checked in the first.
   */
  tsconfig: readonly string[];
  /**
   * The `tsconfig` entries exactly as the config wrote them (same order as `tsconfig`), for
   * messages; when absent, messages show `tsconfig` relative to the working folder.
   */
  tsconfigAsWritten?: readonly string[];
  include: readonly string[];
  exclude: readonly string[];
  /**
   * True when the config sets `exclude` without all of the default entries (`defaults.exclude`):
   * test and story files are then checked, which the CLI says once.
   */
  replacesDefaultExclude: boolean;
  plugins: readonly Plugin[];
  /**
   * The preset that turns rules on by tier, or undefined: then only what `groups`, `rules` and
   * `addons` name is on (a plugin alone turns nothing on).
   */
  preset: Preset | undefined;
  /** Add-ons switched on, each "<plugin>/<addon>". */
  addons: readonly string[];
  rules: Readonly<Record<string, RuleSetting>>;
  /** A setting for every rule of a group, by "<plugin>/<group>"; an explicit `rules` entry wins over it. */
  groups: Readonly<Record<string, RuleSetting>>;
  /**
   * The options of every rule that declares some, by rule id: the config's values with the
   * defaults filled in. Set by `parseConfig`.
   */
  ruleOptions: Readonly<Record<string, Options>>;
  /**
   * When true, only the rules listed in `stateward.rollout.json` (next to the config file) run:
   * adoption one rule at a time.
   */
  rollout: boolean;
  /** Absolute folder of the config file, where `stateward.rollout.json` lives. Set by `parseConfig`. */
  configDir: string;
  /** What the developer says about packages' functions. */
  facts: PackageFactsConfig;
  /** Settings for some files, in the order they apply (the later one wins). */
  overrides: readonly ConfigOverride[];
  ignores: IgnoreOptions;
  /**
   * What the config should change though it still works: an old rule, group or add-on id
   * (`renamed.ts`), one line each. Empty for most configs; the CLI and the editor show them.
   */
  warnings: readonly string[];
  /**
   * How the places stateward could not check (unknown findings) are shown: as infos (the
   * default), as warnings, or "off": left out of the list and the editor but still counted in the
   * summary, so nothing goes unchecked silently.
   */
  unknowns: UnknownsSetting;
  /**
   * The memory the stateward command may use, in MB (Node's `--max-old-space-size`), or undefined
   * to let it choose: 4 GB, or three quarters of the machine's memory if that is less. A large
   * project that runs out sets more here, which works on every system (`NODE_OPTIONS` cannot be
   * set the same way in every shell). `--max-memory` on the command line wins over it. The editor
   * extension does not read it.
   */
  maxMemory: number | undefined;
};

export type UnknownsSetting = "info" | "warning" | "off";

/**
 * A rule's entry in the config: a severity or `"off"`, or that and the rule's options. Without a
 * type argument the options are any names and values (the runtime check judges them); `UserConfig`
 * narrows them to the rule's own declared options (see `ConfigOptionsOf` in options.ts).
 */
export type RuleConfig<O extends object = Readonly<Record<string, OptionValue>>> =
  RuleSetting | readonly [RuleSetting, O];

/**
 * The plugins a config brings, and the ones the configs it extends bring, three levels down (a
 * shared config that extends a shared config that extends a third; more is rare, and the wide
 * `ExtendedConfig` would otherwise never end).
 */
export type PluginsOf<C, Depth extends readonly unknown[] = []> = Depth["length"] extends 3
  ? never
  : C extends { plugins?: infer Own extends readonly Plugin[] }
    ? | Own[number]
      | (C extends { extends?: infer Parents extends readonly unknown[] }
          ? PluginsOf<Parents[number], [...Depth, unknown]>
          : never)
    : never;

export type UserConfig<
  P extends readonly Plugin[] = readonly Plugin[],
  E extends readonly ExtendedConfig[] = readonly ExtendedConfig[],
> = Partial<
  Omit<
    Config,
    | "plugins"
    | "configDir"
    | "rules"
    | "groups"
    | "ruleOptions"
    | "overrides"
    | "ignores"
    | "replacesDefaultExclude"
    | "tsconfig"
    | "tsconfigAsWritten"
  >
> & {
  /**
   * The tsconfig to check, relative to this file's folder (`"tsconfig.json"` by default), or several,
   * with globs: each one found is checked as its own project.
   */
  tsconfig?: string | readonly string[];
  /** Required in the file that runs, unless a config it extends brings the plugins. */
  plugins?: P;
  /**
   * Shared configs (packages that export `defineConfig({...})`), merged in order; this file wins.
   * Plugins are joined by name, `rules`, `groups` and `facts` merged per key, `addons` joined, and
   * the other keys take the last value.
   */
  extends?: E;
  /** Settings for some files; later entries win. */
  overrides?: readonly OverrideOf<P[number] | PluginsOf<E[number]>>[];
  ignores?: Partial<IgnoreOptions>;
  /**
   * Keys are the rule ids of the plugins in `plugins`, so an editor completes them; the options
   * of a rule are the ones it declares, with their types.
   */
  rules?: RuleConfigsOf<P[number] | PluginsOf<E[number]>>;
  /** Keys are the groups of the plugins in `plugins` ("<plugin>/<group>"), completed the same way. */
  groups?: GroupConfigsOf<P[number] | PluginsOf<E[number]>>;
};

/**
 * A config another one extends. Its rule and group ids are not checked in the type (they are
 * checked against the merged plugins when the config loads).
 */
export type ExtendedConfig = Partial<
  Omit<
    Config,
    | "plugins"
    | "configDir"
    | "rules"
    | "groups"
    | "ruleOptions"
    | "overrides"
    | "ignores"
    | "replacesDefaultExclude"
    | "tsconfig"
    | "tsconfigAsWritten"
  >
> & {
  tsconfig?: string | readonly string[];
  plugins?: readonly Plugin[];
  extends?: readonly ExtendedConfig[];
  rules?: Readonly<Record<string, RuleConfig>>;
  groups?: Readonly<Record<string, RuleSetting>>;
  overrides?: readonly OverrideOf<Plugin>[];
  ignores?: Partial<IgnoreOptions>;
};

/** One `overrides` entry as written, with the rule and group ids of the plugins completed. */
export type OverrideOf<P extends Plugin> = {
  /** Globs relative to the config's folder, like `"src/legacy/**"`. */
  files: readonly string[];
  preset?: Preset;
  addons?: readonly string[];
  groups?: GroupConfigsOf<P>;
  /** Severities only: a rule's options are set once, in the config's own `rules`. */
  rules?: Readonly<Partial<Record<RuleIdOf<P>, RuleSetting>>>;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: readonly string[] };

/**
 * Which rules a run uses. `configured`: the config's rules, narrowed to the rollout file when
 * `rollout` is on. `all`: every rule the presets turn on, ignoring the rollout file (the plan).
 * `only`: that one rule, ignoring the rollout file (`check --rule`). `group`: the rules of one
 * group ("<plugin>/<group>") that are not off, ignoring the rollout file (`check --group`).
 */
export type RuleSelection =
  | { kind: "configured" }
  | { kind: "all" }
  | { kind: "only"; ruleId: string }
  | { kind: "group"; groupId: string };

export type HiddenFindings = { file: string; ruleId: string; count: number };

/** A finding that a `// stateward-ignore` comment covers, and the reason the comment gives ("" when it gives none). */
export type IgnoredFinding = { finding: Finding; reason: string };

export type CheckResult = {
  /** Sorted by file, start, ruleId. */
  findings: readonly Finding[];
  /** Findings of one rule in one file beyond the first 20, counted but not listed. Sorted by file, then rule id. */
  hidden: readonly HiddenFindings[];
  /**
   * Findings an ignore comment in the code covers, in the order of `findings`; they are not in
   * `findings`. Counted, never hidden: the CLI says how many. Empty when ignores are not applied.
   */
  ignored?: readonly IgnoredFinding[];
  stats: {
    files: number;
    durationMs: number;
    /**
     * Test and story files that were checked, only counted when the config's `exclude` replaces the
     * default list (`Config.replacesDefaultExclude`).
     */
    testFiles?: number;
    /** `testFiles` by the default `exclude` pattern each one matches (the first, in list order). */
    testFilesByPattern?: Readonly<Record<string, number>>;
    /**
     * The TypeScript projects the files came from (tsconfig, absolute, and how many of the files
     * each one checked), in the order they were checked; set only when there were several.
     */
    projects?: readonly { tsconfig: string; files: number }[];
  };
};
