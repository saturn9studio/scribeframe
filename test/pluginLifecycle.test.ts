import { describe, expect, it } from "vitest";
import {
  ScribeFrame,
  PluginId,
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
    const id = new PluginId<{ readonly count: number }>("destroy-once");
    const plugin: EditorPlugin<{ readonly count: number }> = {
      id,
      init: () => ({ count: 0 }),
      apply: ({ state, transaction }) => ({
        count: transaction.displayChanges.length > 0 ? state.count + 1 : state.count,
      }),
      destroy: ({ content, state }) => {
        destroyed.push({ content, count: state.count });
      },
    };
    const editor = new ScribeFrame(container, {
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
    const removedId = new PluginId<null>("removed");
    const addedId = new PluginId<{ readonly initialContent: string }>("added");
    const removedPlugin: EditorPlugin<null> = {
      id: removedId,
      init: () => null,
      apply: () => null,
      destroy: ({ content }) => {
        removedDestroySnapshots.push(content);
      },
    };
    const addedPlugin: EditorPlugin<{ readonly initialContent: string }> = {
      id: addedId,
      init: ({ content }) => {
        newInitSnapshots.push(content);
        return { initialContent: content };
      },
      apply: ({ state }) => state,
    };
    const editor = new ScribeFrame(container, {
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
    expect(editor.getPluginState(removedId)).toBeUndefined();
    expect(editor.getPluginState(addedId)).toEqual({
      initialContent: "now start",
    });

    editor.destroy();
    container.remove();
  });

  it("preserves state for plugin instances that remain installed", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const retainedId = new PluginId<{ readonly count: number }>("retained");
    const removedId = new PluginId<null>("removed-after-reconfigure");
    const counts = { retainedInit: 0, retainedDestroy: 0, removedDestroy: 0 };
    const retainedPlugin: EditorPlugin<{ readonly count: number }> = {
      id: retainedId,
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
      id: removedId,
      init: () => null,
      apply: () => null,
      destroy: () => {
        counts.removedDestroy += 1;
      },
    };
    const editor = new ScribeFrame(container, {
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
    expect(editor.getPluginState(retainedId)).toEqual({ count: 1 });

    editor.destroy();
    expect(counts.retainedDestroy).toBe(1);
    container.remove();
  });

  it("preserves state and rebinds behavior for new plugin objects with the same id", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const id = new PluginId<{ readonly count: number }>("rebound");
    const plugin = (
      increment: number,
    ): EditorPlugin<{ readonly count: number }> => ({
      id,
      init: () => ({ count: 0 }),
      apply: ({ state, transaction }) => ({
        count:
          transaction.displayChanges.length > 0
            ? state.count + increment
            : state.count,
      }),
    });
    const editor = new ScribeFrame(container, {
      content: "",
      plugins: [plugin(1)],
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("a")
        .build(),
    );
    editor.setPlugins([plugin(10)]);
    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("b")
        .build(),
    );

    expect(editor.getPluginState(id)).toEqual({ count: 11 });

    editor.destroy();
    container.remove();
  });

  it("rejects duplicate plugin ids before initialization or reconfiguration", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const id = new PluginId<null>("duplicate");
    const destroyCounts = { retained: 0 };
    const plugin = (destroy?: () => void): EditorPlugin<null> => ({
      id,
      init: () => null,
      apply: () => null,
      destroy,
    });
    const retainedId = new PluginId<null>("retained-duplicate-test");
    const retainedPlugin: EditorPlugin<null> = {
      id: retainedId,
      init: () => null,
      apply: () => null,
      destroy: () => {
        destroyCounts.retained += 1;
      },
    };

    expect(
      () =>
        new ScribeFrame(document.createElement("div"), {
          plugins: [plugin(), plugin()],
        }),
    ).toThrow("Duplicate plugin id: duplicate");

    const editor = new ScribeFrame(container, {
      plugins: [retainedPlugin],
    });
    expect(() => editor.setPlugins([retainedPlugin, retainedPlugin])).toThrow(
      "Duplicate plugin id: retained-duplicate-test",
    );

    expect(destroyCounts.retained).toBe(0);
    expect(editor.getPluginState(retainedId)).toBeNull();

    editor.destroy();
    container.remove();
  });

  it("treats same-name plugin ids as distinct identities", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const firstId = new PluginId<{ readonly value: string }>("same-name");
    const secondId = new PluginId<{ readonly value: string }>("same-name");
    const plugin = (
      id: PluginId<{ readonly value: string }>,
      value: string,
    ): EditorPlugin<{ readonly value: string }> => ({
      id,
      init: () => ({ value }),
      apply: ({ state }) => state,
    });
    const editor = new ScribeFrame(container, {
      plugins: [plugin(firstId, "first"), plugin(secondId, "second")],
    });

    expect(editor.getPluginState(firstId)).toEqual({ value: "first" });
    expect(editor.getPluginState(secondId)).toEqual({ value: "second" });
    expect(
      editor.getPluginState(
        new PluginId<{ readonly value: string }>("same-name"),
      ),
    ).toBeUndefined();

    editor.destroy();
    container.remove();
  });
});
