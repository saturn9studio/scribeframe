import { describe, expect, it } from "vitest";
import {
  ModernEditor,
  PluginKey,
  createTransaction,
  type EditorPlugin,
} from "../src";

describe("plugin lifecycle", () => {
  it("destroys plugins once with their latest state and snapshot", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const destroyed: Array<{
      readonly content: string;
      readonly count: number;
    }> = [];
    const key = new PluginKey<{ readonly count: number }>("destroy-once");
    const plugin: EditorPlugin<{ readonly count: number }> = {
      key,
      init: () => ({ count: 0 }),
      apply: ({ state, transaction }) => ({
        count: transaction.displayChanges.length > 0 ? state.count + 1 : state.count,
      }),
      destroy: ({ content, state }) => {
        destroyed.push({ content, count: state.count });
      },
    };
    const editor = new ModernEditor(container, {
      content: "a",
      plugins: [plugin],
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("b")
        .build(),
    );
    editor.destroy();
    editor.destroy();

    expect(destroyed).toEqual([{ content: "ba", count: 1 }]);
    container.remove();
  });

  it("reconfigures plugins by cleaning up removed plugins and initializing new ones from the current snapshot", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const removedDestroySnapshots: string[] = [];
    const newInitSnapshots: string[] = [];
    const removedKey = new PluginKey<null>("removed");
    const addedKey = new PluginKey<{ readonly initialContent: string }>("added");
    const removedPlugin: EditorPlugin<null> = {
      key: removedKey,
      init: () => null,
      apply: () => null,
      destroy: ({ content }) => {
        removedDestroySnapshots.push(content);
      },
    };
    const addedPlugin: EditorPlugin<{ readonly initialContent: string }> = {
      key: addedKey,
      init: ({ content }) => {
        newInitSnapshots.push(content);
        return { initialContent: content };
      },
      apply: ({ state }) => state,
    };
    const editor = new ModernEditor(container, {
      content: "start",
      plugins: [removedPlugin],
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("now ")
        .build(),
    );
    editor.setPlugins([addedPlugin]);

    expect(removedDestroySnapshots).toEqual(["now start"]);
    expect(newInitSnapshots).toEqual(["now start"]);
    expect(editor.getPluginState(removedKey)).toBeUndefined();
    expect(editor.getPluginState(addedKey)).toEqual({
      initialContent: "now start",
    });

    editor.destroy();
    container.remove();
  });

  it("preserves state for plugin instances that remain installed", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const retainedKey = new PluginKey<{ readonly count: number }>("retained");
    const removedKey = new PluginKey<null>("removed-after-reconfigure");
    const counts = { retainedInit: 0, retainedDestroy: 0, removedDestroy: 0 };
    const retainedPlugin: EditorPlugin<{ readonly count: number }> = {
      key: retainedKey,
      init: () => {
        counts.retainedInit += 1;
        return { count: 0 };
      },
      apply: ({ state, transaction }) => ({
        count: transaction.displayChanges.length > 0 ? state.count + 1 : state.count,
      }),
      destroy: () => {
        counts.retainedDestroy += 1;
      },
    };
    const removedPlugin: EditorPlugin<null> = {
      key: removedKey,
      init: () => null,
      apply: () => null,
      destroy: () => {
        counts.removedDestroy += 1;
      },
    };
    const editor = new ModernEditor(container, {
      content: "",
      plugins: [retainedPlugin, removedPlugin],
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("x")
        .build(),
    );
    editor.setPlugins([retainedPlugin]);

    expect(counts).toEqual({
      retainedInit: 1,
      retainedDestroy: 0,
      removedDestroy: 1,
    });
    expect(editor.getPluginState(retainedKey)).toEqual({ count: 1 });

    editor.destroy();
    expect(counts.retainedDestroy).toBe(1);
    container.remove();
  });
});
