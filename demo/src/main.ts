import { ModernEditor } from "@saturn9/scribeframe";
import {
  codeBlockWidgetPlugin,
  markdownPlugin,
  markdownSyntaxProvider,
  requireMarkdownSyntaxSnapshot,
} from "./markdown";
import "@saturn9/scribeframe/styles.css";
import "./styles.css";

const initialMarkdown = `# Scribeframe Demo

This demo edits Markdown text directly. Try typing **bold** text, ==highlighting== something, or editing the code widget below.

~~~ts
const greeting = "hello from the widget";
console.log(greeting);
~~~

The code block above is rendered by a plugin and maps edits back through a typed widget context.

Undo and redo are editor-owned now. Try Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, or the toolbar buttons.`;

const demo = document.querySelector<HTMLDivElement>("#demo");

if (!demo) {
  throw new Error("Demo root not found");
}

demo.innerHTML = `
  <div class="demo-shell">
    <section class="demo-main">
      <div class="demo-toolbar">
        <span class="demo-title">Scribeframe</span>
        <span class="demo-status" data-role="status"></span>
        <button type="button" data-action="undo">Undo</button>
        <button type="button" data-action="redo">Redo</button>
        <button type="button" data-action="focus">Focus</button>
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="toggle-readonly">Read-only: off</button>
      </div>
      <div class="demo-editor-host"></div>
    </section>
    <aside class="demo-side">
      <section class="demo-panel">
        <h2>Document Text</h2>
        <pre class="demo-output" data-role="document-output"></pre>
      </section>
    </aside>
  </div>
`;

const host = demo.querySelector<HTMLDivElement>(".demo-editor-host");
const documentOutput = demo.querySelector<HTMLPreElement>(
  "[data-role='document-output']",
);
const status = demo.querySelector<HTMLSpanElement>("[data-role='status']");
const readOnlyButton = demo.querySelector<HTMLButtonElement>("[data-action='toggle-readonly']");
const undoButton = demo.querySelector<HTMLButtonElement>("[data-action='undo']");
const redoButton = demo.querySelector<HTMLButtonElement>("[data-action='redo']");

if (
  !host ||
  !documentOutput ||
  !status ||
  !readOnlyButton ||
  !undoButton ||
  !redoButton
) {
  throw new Error("Demo elements not found");
}

let readOnly = false;

const editor = new ModernEditor(host, {
  content: initialMarkdown,
  syntaxProvider: markdownSyntaxProvider,
  plugins: [markdownPlugin(), codeBlockWidgetPlugin()],
  onChange: () => updateDemo(),
});
const updateDemo = (): void => {
  const syntax = requireMarkdownSyntaxSnapshot(editor.getSyntaxSnapshot());
  documentOutput.textContent = editor.getContent();
  status.textContent = [
    `${editor.getDocument().paragraphs.length} paragraphs`,
    `${syntax.tokenViews.length} syntax tokens`,
  ].join(" · ");
  undoButton.disabled = !editor.canUndo();
  redoButton.disabled = !editor.canRedo();
};

updateDemo();

demo.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.action;
  if (action === "undo") {
    editor.undo();
    updateDemo();
  }

  if (action === "redo") {
    editor.redo();
    updateDemo();
  }

  if (action === "focus") {
    editor.focus();
  }

  if (action === "reset") {
    editor.setContent(initialMarkdown);
    editor.focus();
    updateDemo();
  }

  if (action === "toggle-readonly") {
    readOnly = !readOnly;
    editor.setReadOnly(readOnly);
    readOnlyButton.textContent = `Read-only: ${readOnly ? "on" : "off"}`;
    editor.focus();
    updateDemo();
  }
});
