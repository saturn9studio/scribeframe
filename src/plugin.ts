import {
  EditorDecoration,
  EditorSnapshot,
  WidgetDecoration,
} from "./decorations.js";
import type { EditorCommand, EditorKeyBinding } from "./commands.js";
import type { EditorInteraction } from "./interaction.js";
import { EditorDocument, Selection } from "./model.js";
import { Transaction } from "./transaction.js";

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

export interface PluginCommandContext<S> extends PluginOutputContext<S> {
  readonly dispatch: (transaction: Transaction) => void;
}

export interface PluginInputContext<S> extends PluginCommandContext<S> {
  readonly event: KeyboardEvent;
}

export interface PluginInteractionContext<S> extends PluginCommandContext<S> {
  readonly interaction: EditorInteraction;
}

export interface EditorPluginProps<S> {
  handleKeyDown?(context: PluginInputContext<S>): boolean;
  handleInteraction?(context: PluginInteractionContext<S>): boolean;
  readonly keymap?: readonly EditorKeyBinding[];
}

export interface EditorPlugin<S> {
  readonly id: PluginId<S>;
  init(context: PluginInitContext): S;
  apply(context: PluginApplyContext<S>): S;
  decorations?(context: PluginOutputContext<S>): readonly EditorDecoration[];
  widgets?(context: PluginOutputContext<S>): readonly WidgetDecoration[];
  commands?(context: PluginOutputContext<S>): readonly EditorCommand[];
  destroy?(context: PluginDestroyContext<S>): void;
  readonly props?: EditorPluginProps<S>;
}
