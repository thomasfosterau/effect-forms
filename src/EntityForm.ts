/**
 * @copyright Thomas Foster
 *
 * The typed entity-form definition builder — the composition layer of the
 * schema-driven form phase. `defineEntityForm(commands, (f) => [...])` pairs a
 * `Command.plan` derivation (form-input schemas, blank defaults, tri-state
 * adapters — see `effect-forms/Command`) with an ordered list of typed field
 * entries: shared scalar primitives by kind, and arbitrary widget components
 * for the bespoke fields (pickers, contributor lists). One generic renderer
 * component walks `definition.entries`; per-entity code shrinks to one
 * definition module.
 *
 * Field keys are type-constrained to the command structs' keys, and the
 * builder enforces exhaustiveness at definition time (a runtime check, kept
 * deliberately simple over deep conditional types): every derivable command
 * field must be declared exactly once, so adding a field to a command struct
 * breaks the entity's definition module until the form declares it.
 *
 * Labels and other message-bearing props are **thunks** (`() => string`,
 * Paraglide message function references) resolved at render time, never at
 * module scope — module-scope resolution would freeze the import-time locale.
 *
 * @module effect-forms-svelte/EntityForm
 */

import type { Component } from "svelte";
import { Command } from "@thomasfosterau/effect-forms";
import * as Schema from "effect/Schema";

/** A render-time message thunk — pass the Paraglide function itself, uncalled. */
export type MessageThunk = () => string;

/** Presentation options for a scalar text entry. */
export interface TextEntryOptions {
  readonly label: MessageThunk;
  /** Presentation `type` attribute (`url`, `date`). Omitted → text input. */
  readonly type?: "text" | "url" | "date";
  /** Keyboard hint for numeric text fields; defaults from the field's derived kind. */
  readonly inputmode?: "numeric";
  /** Force required-ness (defaults to the schema-derived constraint). */
  readonly required?: boolean;
  readonly placeholder?: MessageThunk;
}

/** A scalar field rendered by the shared text/textarea primitives. */
export interface ScalarEntry {
  readonly _tag: "scalar";
  readonly key: string;
  readonly multiline: boolean;
  readonly options: TextEntryOptions;
}

/** Options for a widget entry (picker / rows list). */
export interface WidgetEntryOptions {
  /** Gate the submit button while this field's value is empty (required pickers). */
  readonly gate?: boolean;
}

/**
 * A bespoke widget field. The renderer bridges the store to the widget through
 * the stage-1 wrapper contract — `name`, `value`, `onChange`, `errors` — which
 * are **reserved keys**: the bridge is spread last, so a `props()` thunk or a
 * load-supplied field prop can never silently sever the store binding.
 */
export interface WidgetEntry {
  readonly _tag: "widget";
  readonly key: string;
  /** `"value"` bridges a string FK; `"rows"` bridges a controlled row list. */
  readonly bridge: "value" | "rows";
  // reason: the renderer composes arbitrary widgets; per-widget prop checking
  // happens in the definition module via the builder's generic signature.
  readonly component: Component<any>;
  readonly props: () => Record<string, unknown>;
  readonly options: WidgetEntryOptions;
}

/** One ordered entry in an entity form definition. */
export type EntityFormEntry = ScalarEntry | WidgetEntry;

/** The per-mode submit labels. */
export interface SubmitMessages {
  readonly create: MessageThunk;
  readonly update: MessageThunk;
}

/** The runtime shape `defineEntityForm` accepts for a command struct. */
export interface CommandStructLike {
  readonly fields: Record<string, Schema.Top>;
}

/** The value `defineEntityForm` returns — everything one renderer needs. */
export interface EntityFormDefinition {
  readonly plan: Command.CommandPlan;
  readonly entries: readonly EntityFormEntry[];
  readonly createInput: Schema.Top;
  readonly updateInput: Schema.Top;
  readonly createDefaults: Readonly<Record<string, string>>;
  readonly updateDefaults: Readonly<Record<string, string>>;
  readonly adaptCreate: (input: Command.FormInputRecord) => Record<string, unknown>;
  readonly adaptUpdate: (input: Command.FormInputRecord) => Record<string, unknown>;
  readonly submit: SubmitMessages;
  /** The create struct carries a client-generated id (idempotent retries). */
  readonly clientId: boolean;
  /** Entries visible in one mode, in declaration order. */
  readonly entriesFor: (mode: "create" | "update") => readonly EntityFormEntry[];
  /** The plan field behind an entry key. */
  readonly fieldFor: (key: string) => Command.FieldPlan;
}

/** The writable command keys a definition may declare (the `id` key is renderer-owned). */
export type CommandKeys<C extends CommandStructLike, U extends CommandStructLike> = Exclude<
  Extract<keyof C["fields"] | keyof U["fields"], string>,
  "id"
>;

/** The entry builders handed to the definition callback, key-typed to the command pair. */
export interface EntryBuilders<K extends string> {
  /** A scalar field rendered by the shared `TextInputField`. */
  text(key: K, options: TextEntryOptions): EntityFormEntry;
  /** A scalar field rendered by the shared `TextAreaInputField`. */
  textarea(key: K, options: TextEntryOptions): EntityFormEntry;
  /**
   * A bespoke string-valued widget (an FK picker). The renderer supplies
   * `name` / `value` / `onChange` / `errors`; `props()` supplies the rest at
   * render time (labels stay thunk-resolved).
   */
  custom<P extends Record<string, unknown>>(
    key: K,
    component: Component<never>,
    props: () => P,
    options?: WidgetEntryOptions,
  ): EntityFormEntry;
  /**
   * A bespoke row-list widget (a contributor list). The renderer owns the row
   * state and supplies `name` / `value` / `onChange` / `errors`; the widget
   * owns the wire serialisation (its hidden input).
   */
  rows<P extends Record<string, unknown>>(
    key: K,
    component: Component<never>,
    props: () => P,
    options?: WidgetEntryOptions,
  ): EntityFormEntry;
}

/** Everything `defineEntityForm` needs beyond the entries. */
export interface DefineEntityFormOptions<C extends CommandStructLike, U extends CommandStructLike> {
  readonly create: C;
  readonly update: U;
  readonly submit: SubmitMessages;
  /** Per-field adapter overrides, per mode — the irregular-coercion escape hatch. */
  readonly adaptOverrides?: {
    readonly create?: Command.AdaptOverrides;
    readonly update?: Command.AdaptOverrides;
  };
  /** Per-field Form-Input schema overrides, per mode (e.g. an optional create title with a server default). */
  readonly inputOverrides?: {
    readonly create?: Readonly<Record<string, Schema.Top>>;
    readonly update?: Readonly<Record<string, Schema.Top>>;
  };
  /**
   * Command fields deliberately absent from the standalone form (a carve-out,
   * e.g. BookSeries' `editors` — managed through the Book form's inline-create
   * path instead). Omitted fields are stripped from the create/update field
   * records before `Command.plan` runs, so they need no entry, are never
   * classified (a kind-less omitted field can't throw at definition time),
   * and never appear in the derived input schema, defaults, or adapters.
   */
  readonly omit?: readonly CommandKeys<C, U>[];
}

const builders: EntryBuilders<string> = {
  text: (key, options) => ({ _tag: "scalar", key, multiline: false, options }),
  textarea: (key, options) => ({ _tag: "scalar", key, multiline: true, options }),
  custom: (key, component, props, options = {}) => ({
    _tag: "widget",
    key,
    bridge: "value",
    component: component as Component<any>,
    props,
    options,
  }),
  rows: (key, component, props, options = {}) => ({
    _tag: "widget",
    key,
    bridge: "rows",
    component: component as Component<any>,
    props,
    options,
  }),
};

/**
 * Build an entity-form definition from a command-struct pair and an ordered
 * entry list. Runs once at module load. Throws when the entries don't cover
 * the derivable command fields exactly (exhaustiveness) or name an unknown
 * key — a command-struct change must surface here, at definition time.
 */
export const defineEntityForm = <C extends CommandStructLike, U extends CommandStructLike>(
  options: DefineEntityFormOptions<C, U>,
  build: (f: EntryBuilders<CommandKeys<C, U>>) => readonly EntityFormEntry[],
): EntityFormDefinition => {
  const omitted = new Set<string>(options.omit ?? []);
  const withoutOmitted = (struct: CommandStructLike): CommandStructLike => {
    if (omitted.size === 0) return struct;
    const fields: Record<string, Schema.Top> = {};
    for (const key in struct.fields) if (!omitted.has(key)) fields[key] = struct.fields[key];
    return { fields };
  };
  const plan = Command.plan(withoutOmitted(options.create), withoutOmitted(options.update));
  const entries = build(builders as EntryBuilders<CommandKeys<C, U>>);

  const byKey = new Map<string, Command.FieldPlan>(plan.fields.map((field) => [field.key, field]));
  const declared = new Set<string>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) {
      throw new Error(
        `defineEntityForm: entry "${entry.key}" is not a field of either command struct`,
      );
    }
    if (declared.has(entry.key)) {
      throw new Error(`defineEntityForm: entry "${entry.key}" is declared twice`);
    }
    declared.add(entry.key);
  }
  const missing = plan.fields.filter((field) => !declared.has(field.key)).map((field) => field.key);
  if (missing.length > 0) {
    throw new Error(
      `defineEntityForm: command fields not declared by any entry: ${missing.join(", ")} — declare or explicitly widget them`,
    );
  }

  const entriesFor = (mode: "create" | "update") =>
    entries.filter((entry) => {
      const field = byKey.get(entry.key);
      return field !== undefined && (mode === "create" ? field.inCreate : field.inUpdate);
    });

  return {
    plan,
    entries,
    createInput: Schema.Struct(
      Command.formInputFields(plan, "create", options.inputOverrides?.create) as Record<
        string,
        never
      >,
    ),
    updateInput: Schema.Struct(
      Command.formInputFields(plan, "update", options.inputOverrides?.update) as Record<
        string,
        never
      >,
    ),
    createDefaults: Command.blankDefaults(plan, "create"),
    updateDefaults: Command.blankDefaults(plan, "update"),
    adaptCreate: Command.createAdapter(plan, options.adaptOverrides?.create),
    adaptUpdate: Command.updateAdapter(plan, options.adaptOverrides?.update),
    submit: options.submit,
    clientId: plan.clientId,
    entriesFor,
    fieldFor: (key: string) => {
      const field = byKey.get(key);
      if (field === undefined) throw new Error(`EntityFormDefinition: unknown field "${key}"`);
      return field;
    },
  };
};
