import { describe, expect, it } from "vitest";
import {
  ModernEditor,
  PluginId,
  createTransaction,
  editorCommandNames,
  firstPosition,
  type EditorPlugin,
} from "../src";

const inputFor = (container: HTMLElement): HTMLTextAreaElement => {
  const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");
  if (!input) throw new Error("Input proxy not found");
  return input;
};

const keyDown = (
  container: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  inputFor(container).dispatchEvent(event);
  return event;
};

describe("editor commands and keymaps", () => {
  it("executes built-in commands through the public command API", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc\ndef" });

    expect(editor.executeCommand(editorCommandNames.selectAll)).toBe(true);
    expect(editor.getSelection()).toEqual({
      anchor: firstPosition(),
      head: { paragraph: 1, offset: 3 },
    });
    expect(editor.executeCommand("missing.command")).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("lets app keymaps override default key bindings", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc",
      commands: [
        {
          name: "demo.insertBang",
          run({ doc, dispatch, selection }) {
            dispatch(
              createTransaction(doc, selection)
                .replaceSelection("!")
                .build(),
            );
            return true;
          },
        },
      ],
      keymap: [{ key: "Mod+A", command: "demo.insertBang" }],
    });

    const event = keyDown(container, "a", { metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getContent()).toBe("!abc");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });

    editor.destroy();
    container.remove();
  });

  it("falls back to default key bindings when a custom command declines", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc",
      commands: [{ name: "demo.noop", run: () => false }],
      keymap: [{ key: "Mod+A", command: "demo.noop" }],
    });

    keyDown(container, "a", { ctrlKey: true });

    expect(editor.getSelection()).toEqual({
      anchor: firstPosition(),
      head: { paragraph: 0, offset: 3 },
    });

    editor.destroy();
    container.remove();
  });

  it("runs plugin commands from plugin keymaps with current plugin state", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const plugin: EditorPlugin<{ readonly text: string }> = {
      id: new PluginId("insert-plugin"),
      init: () => ({ text: "plugin" }),
      apply: ({ state }) => state,
      commands: ({ state }) => [
        {
          name: "plugin.insert",
          run({ doc, dispatch, selection }) {
            dispatch(
              createTransaction(doc, selection)
                .replaceSelection(state.text)
                .build(),
            );
            return true;
          },
        },
      ],
      props: {
        keymap: [{ key: "Mod+K", command: "plugin.insert" }],
      },
    };
    const editor = new ModernEditor(container, {
      content: "",
      plugins: [plugin],
    });

    keyDown(container, "k", { metaKey: true });

    expect(editor.getContent()).toBe("plugin");

    editor.destroy();
    container.remove();
  });

  it("prevents default browser behavior when a plugin handles keydown", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const plugin: EditorPlugin<null> = {
      id: new PluginId("handle-keydown"),
      init: () => null,
      apply: () => null,
      props: {
        handleKeyDown: () => true,
      },
    };
    const editor = new ModernEditor(container, {
      content: "",
      plugins: [plugin],
    });

    const event = keyDown(container, "Tab");

    expect(event.defaultPrevented).toBe(true);

    editor.destroy();
    container.remove();
  });
});
