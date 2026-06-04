import {
  EditorDecoration,
  EditorSnapshot,
  ExtensionInstance,
  WidgetDecoration,
} from "./decorations";
import type { EditorCommand, EditorKeyBinding } from "./commands";
import { EditorDocument, Selection } from "./model";
import { Step, Transaction } from "./transaction";

export class PluginKey<S> {
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

export interface PluginKeyDownContext<S> extends PluginCommandContext<S> {
  readonly event: KeyboardEvent;
}

export interface EditorPluginProps<S> {
  handleKeyDown?(context: PluginKeyDownContext<S>): boolean;
  readonly keymap?: readonly EditorKeyBinding[];
}

export interface EditorPlugin<S> {
  readonly key: PluginKey<S>;
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
  readonly key: PluginKey<unknown>;
  readonly getState: () => unknown;
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
  let pluginState = plugin.init(snapshot);

  return {
    plugin: plugin as EditorPlugin<unknown>,
    key: plugin.key as PluginKey<unknown>,
    getState: () => pluginState,
    apply(transaction, snapshot) {
      pluginState = plugin.apply({
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
        instances: plugin.instances?.(context) ?? [],
        decorations: plugin.decorations?.(context) ?? [],
        widgets: plugin.widgets?.(context) ?? [],
      };
    },
    normalize(snapshot, instances) {
      return plugin.normalize?.({ ...snapshot, state: pluginState, instances }) ?? [];
    },
    commands(snapshot) {
      return plugin.commands?.({ ...snapshot, state: pluginState }) ?? [];
    },
    keymap() {
      return plugin.props?.keymap ?? [];
    },
    destroy(snapshot) {
      plugin.destroy?.({ ...snapshot, state: pluginState });
    },
    handleKeyDown(snapshot, event, dispatch) {
      return plugin.props?.handleKeyDown?.({
        ...snapshot,
        state: pluginState,
        event,
        dispatch,
      }) ?? false;
    },
  };
};
