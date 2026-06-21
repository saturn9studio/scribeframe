import type { EditorCommand, EditorKeyBinding } from "./commands.js";
import type {
  EditorDecoration,
  EditorSnapshot,
  WidgetDecoration,
} from "./decorations.js";
import type { EditorInteraction } from "./interaction.js";
import type { Transaction } from "./transaction.js";
import type { EditorPlugin, PluginId } from "./plugin.js";

export interface PluginSlot {
  readonly plugin: EditorPlugin<unknown>;
  readonly id: PluginId<unknown>;
  readonly getState: () => unknown;
  reconfigure(plugin: EditorPlugin<unknown>): void;
  apply(transaction: Transaction, snapshot: EditorSnapshot): void;
  output(snapshot: EditorSnapshot): {
    readonly decorations: readonly EditorDecoration[];
    readonly widgets: readonly WidgetDecoration[];
  };
  commands(snapshot: EditorSnapshot): readonly EditorCommand[];
  keymap(): readonly EditorKeyBinding[];
  destroy(snapshot: EditorSnapshot): void;
  handleKeyDown(
    snapshot: EditorSnapshot,
    event: KeyboardEvent,
    dispatch: (transaction: Transaction) => void,
  ): boolean;
  handleInteraction(
    snapshot: EditorSnapshot,
    interaction: EditorInteraction,
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
        decorations: currentPlugin.decorations?.(context) ?? [],
        widgets: currentPlugin.widgets?.(context) ?? [],
      };
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
    handleInteraction(snapshot, interaction, dispatch) {
      return currentPlugin.props?.handleInteraction?.({
        ...snapshot,
        state: pluginState,
        interaction,
        dispatch,
      }) ?? false;
    },
  };
};
