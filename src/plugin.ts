import {
  EditorDecoration,
  EditorSnapshot,
  ExtensionInstance,
  WidgetDecoration,
} from "./decorations.js";
import type { EditorCommand, EditorKeyBinding } from "./commands.js";
import { EditorDocument, Selection } from "./model.js";
import { Step, Transaction } from "./transaction.js";

export class PluginId<S> {
  readonly state?: S;

  constructor(readonly name: string) {}
}

export interface PluginInitContext extends EditorSnapshot {}

export interface PluginApplyContext<S> extends EditorSnapshot {
  readonly state: S;
  readonly previousDoc: EditorDocument;
  readonly previousSelection: Selection;
  readonly transaction: Transaction;
}

export interface PluginOutputContext<S> extends EditorSnapshot {
  readonly state: S;
}

export interface PluginDestroyContext<S> extends PluginOutputContext<S> {}

export interface NormalizeContext<S> extends PluginOutputContext<S> {
  readonly instances: readonly ExtensionInstance[];
}

export interface PluginCommandContext<S> extends PluginOutputContext<S> {
  readonly dispatch: (transaction: Transaction) => void;
}

export interface PluginInputContext<S> extends PluginCommandContext<S> {
  readonly event: KeyboardEvent;
}

export interface EditorPluginProps<S> {
  handleKeyDown?(context: PluginInputContext<S>): boolean;
  readonly keymap?: readonly EditorKeyBinding[];
}

export interface EditorPlugin<S> {
  readonly id: PluginId<S>;
  init(context: PluginInitContext): S;
  apply(context: PluginApplyContext<S>): S;
  instances?(context: PluginOutputContext<S>): readonly ExtensionInstance[];
  decorations?(context: PluginOutputContext<S>): readonly EditorDecoration[];
  widgets?(context: PluginOutputContext<S>): readonly WidgetDecoration[];
  normalize?(context: NormalizeContext<S>): readonly Step[];
  commands?(context: PluginOutputContext<S>): readonly EditorCommand[];
  destroy?(context: PluginDestroyContext<S>): void;
  readonly props?: EditorPluginProps<S>;
}

export interface PluginSlot {
  readonly plugin: EditorPlugin<unknown>;
  readonly id: PluginId<unknown>;
  readonly getState: () => unknown;
  reconfigure(plugin: EditorPlugin<unknown>): void;
  apply(transaction: Transaction, snapshot: EditorSnapshot): void;
  output(snapshot: EditorSnapshot): {
    readonly instances: readonly ExtensionInstance[];
    readonly decorations: readonly EditorDecoration[];
    readonly widgets: readonly WidgetDecoration[];
  };
  normalize(
    snapshot: EditorSnapshot,
    instances: readonly ExtensionInstance[],
  ): readonly Step[];
  commands(snapshot: EditorSnapshot): readonly EditorCommand[];
  keymap(): readonly EditorKeyBinding[];
  destroy(snapshot: EditorSnapshot): void;
  handleKeyDown(
    snapshot: EditorSnapshot,
    event: KeyboardEvent,
    dispatch: (transaction: Transaction) => void,
  ): boolean;
}

export const createPluginSlot = <S>(
  plugin: EditorPlugin<S>,
  snapshot: EditorSnapshot,
): PluginSlot => {
  let currentPlugin = plugin;
  let pluginState = plugin.init(snapshot);

  return {
    get plugin() {
      return currentPlugin as EditorPlugin<unknown>;
    },
    id: currentPlugin.id as PluginId<unknown>,
    getState: () => pluginState,
    reconfigure(nextPlugin) {
      currentPlugin = nextPlugin as EditorPlugin<S>;
    },
    apply(transaction, snapshot) {
      pluginState = currentPlugin.apply({
        ...snapshot,
        state: pluginState,
        previousDoc: transaction.docBefore,
        previousSelection: transaction.selectionBefore,
        transaction,
      });
    },
    output(snapshot) {
      const context = { ...snapshot, state: pluginState };
      return {
        instances: currentPlugin.instances?.(context) ?? [],
        decorations: currentPlugin.decorations?.(context) ?? [],
        widgets: currentPlugin.widgets?.(context) ?? [],
      };
    },
    normalize(snapshot, instances) {
      return (
        currentPlugin.normalize?.({ ...snapshot, state: pluginState, instances }) ??
        []
      );
    },
    commands(snapshot) {
      return currentPlugin.commands?.({ ...snapshot, state: pluginState }) ?? [];
    },
    keymap() {
      return currentPlugin.props?.keymap ?? [];
    },
    destroy(snapshot) {
      currentPlugin.destroy?.({ ...snapshot, state: pluginState });
    },
    handleKeyDown(snapshot, event, dispatch) {
      return currentPlugin.props?.handleKeyDown?.({
        ...snapshot,
        state: pluginState,
        event,
        dispatch,
      }) ?? false;
    },
  };
};
