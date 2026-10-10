import { describe, expect, it } from "vitest";
import {
  PluginId,
  ScribeFrame,
  createTransaction,
  type EditorPlugin,
  type WidgetDecoration,
  type WidgetRenderer,
} from "../src";

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

const setViewport = (element: HTMLElement, clientHeight: number): void => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
};

const renderedParagraphs = (container: HTMLElement): number[] =>
  [...container.querySelectorAll<HTMLElement>(".s9-paragraph")].map((item) =>
    Number(item.dataset.paragraph),
  );

const blockWidgetPlugin = (
  height: () => number,
  mirrorScale = 1,
): EditorPlugin<null> => ({
  id: new PluginId<null>("mirror-layout-widget"),
  init: () => null,
  apply: () => null,
  widgets: ({ doc }): readonly WidgetDecoration[] => [{
    key: "mirror-layout-widget:ten",
    placement: "block",
    range: {
      from: { paragraph: 10, offset: 0 },
      to: {
        paragraph: 10,
        offset: doc.paragraphs[10]?.text.length ?? 0,
      },
    },
    props: {},
    render: {
      mount(host) {
        host.getBoundingClientRect = () =>
          ({
            left: 0,
            top: 0,
            right: 400,
            bottom: height() * (
              host.closest(".s9-editor-mirror") ? mirrorScale : 1
            ),
            width: 400,
            height: height() * (
              host.closest(".s9-editor-mirror") ? mirrorScale : 1
            ),
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect;
        return {
          update() {},
          destroy() {},
        };
      },
    },
    selection: "block",
  }],
});

describe("read-only render mirrors", () => {
  it("renders the complete document while the editor remains virtualized", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 60);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(renderedParagraphs(container)).toEqual([0, 1, 2]);
    expect(renderedParagraphs(mirrorElement)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    expect(mirrorElement.querySelector(".s9-virtual-spacer")).toBeNull();
    expect(mirrorElement.inert).toBe(true);
    expect(mirrorElement.getAttribute("aria-hidden")).toBe("true");

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("derives mirror output from a read-only plugin snapshot", () => {
    const outputReadOnlyStates: boolean[] = [];
    const renderer: WidgetRenderer<{
      readonly label: string;
      readonly readOnly: boolean;
    }> = {
      mount(host, props, context) {
        const input = document.createElement("input");
        input.className = "shared-widget-input";
        input.value = props.label;
        input.readOnly = props.readOnly;
        input.dataset.contextReadOnly = `${context.readOnly}`;
        host.replaceChildren(input);
        return {
          update(nextProps) {
            input.value = nextProps.label;
            input.readOnly = nextProps.readOnly;
            input.dataset.contextReadOnly = `${context.readOnly}`;
          },
          destroy() {
            host.replaceChildren();
          },
        };
      },
    };
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("mirror-output"),
      init: () => null,
      apply: () => null,
      decorations: () => [{
        kind: "inline",
        from: 0,
        to: 6,
        attrs: { class: "shared-decoration" },
      }],
      widgets: ({ doc, readOnly }): readonly WidgetDecoration[] => {
        outputReadOnlyStates.push(readOnly);
        return [{
          key: "mirror-output:widget",
          placement: "block",
          range: {
            from: { paragraph: 1, offset: 0 },
            to: {
              paragraph: 1,
              offset: doc.paragraphs[1]?.text.length ?? 0,
            },
          },
          props: {
            label: doc.paragraphs[1]?.text ?? "",
            readOnly,
          },
          render: renderer,
          selection: "block",
        }];
      },
    };
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: "before\nwidget\nafter",
      plugins: [plugin],
      virtualization: false,
    });
    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(
      container.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.readOnly,
    ).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.dataset.contextReadOnly,
    ).toBe("false");
    expect(
      mirrorElement.querySelector(".shared-decoration")?.textContent,
    ).toBe("before");
    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.value,
    ).toBe("widget");
    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.readOnly,
    ).toBe(true);
    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.dataset.contextReadOnly,
    ).toBe("true");
    expect(outputReadOnlyStates).toContain(false);
    expect(outputReadOnlyStates).toContain(true);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 1, offset: 0 },
          { paragraph: 1, offset: 6 },
          "updated",
        )
        .build(),
    );

    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.value,
    ).toBe("updated");

    mirror.destroy();
    expect(mirrorElement.childElementCount).toBe(0);
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("mounts and destroys independent widget instances for each surface", () => {
    let mounts = 0;
    let destroys = 0;
    const renderer: WidgetRenderer<Record<string, never>> = {
      mount(host) {
        mounts += 1;
        const instance = document.createElement("span");
        instance.className = "widget-instance";
        instance.dataset.instance = `${mounts}`;
        host.replaceChildren(instance);
        return {
          update() {},
          destroy() {
            destroys += 1;
            host.replaceChildren();
          },
        };
      },
    };
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("mirror-widget-lifecycle"),
      init: () => null,
      apply: () => null,
      widgets: ({ doc }): readonly WidgetDecoration[] => [{
        key: "mirror-widget-lifecycle:widget",
        placement: "block",
        range: {
          from: { paragraph: 0, offset: 0 },
          to: { paragraph: 0, offset: doc.paragraphs[0]?.text.length ?? 0 },
        },
        props: {},
        render: renderer,
        selection: "block",
      }],
    };
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: "widget",
      plugins: [plugin],
      virtualization: false,
    });

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(mounts).toBe(2);
    expect(
      container.querySelector<HTMLElement>(".widget-instance")?.dataset.instance,
    ).not.toBe(
      mirrorElement.querySelector<HTMLElement>(".widget-instance")?.dataset
        .instance,
    );

    mirror.destroy();
    expect(destroys).toBe(1);
    expect(container.querySelector(".widget-instance")).not.toBeNull();

    editor.destroy();
    expect(destroys).toBe(2);
    container.remove();
    mirrorElement.remove();
  });

  it("destroys attached mirrors with the editor", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, { content: "content" });
    const mirror = editor.attachRenderMirror(mirrorElement);

    editor.destroy();

    expect(mirrorElement.childElementCount).toBe(0);
    expect(mirrorElement.classList.contains("s9-editor-root")).toBe(false);
    expect(mirrorElement.classList.contains("s9-editor-mirror")).toBe(false);
    expect(mirrorElement.inert).toBe(false);
    expect(() => mirror.destroy()).not.toThrow();
    container.remove();
    mirrorElement.remove();
  });

  it("shares complete-document widget measurements with virtualization", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [blockWidgetPlugin(() => 100)],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(editor.getScrollState().scrollHeight).toBe(400);

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(editor.getScrollState().scrollHeight).toBe(480);
    expect(renderedParagraphs(container)).toEqual([0, 1]);

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("does not delete primary-only widget measurements", () => {
    const primaryOnlyPlugin: EditorPlugin<null> = {
      id: new PluginId<null>("primary-only-widget"),
      init: () => null,
      apply: () => null,
      widgets: ({ doc, readOnly }): readonly WidgetDecoration[] =>
        readOnly
          ? []
          : [{
              key: "primary-only-widget:ten",
              placement: "block",
              range: {
                from: { paragraph: 10, offset: 0 },
                to: {
                  paragraph: 10,
                  offset: doc.paragraphs[10]?.text.length ?? 0,
                },
              },
              props: {},
              render: {
                mount(host) {
                  host.getBoundingClientRect = () =>
                    ({
                      left: 0,
                      top: 0,
                      right: 400,
                      bottom: 100,
                      width: 400,
                      height: 100,
                      x: 0,
                      y: 0,
                      toJSON: () => ({}),
                    }) as DOMRect;
                  return { update() {}, destroy() {} };
                },
              },
              selection: "block",
            }],
    };
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [primaryOnlyPlugin],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    editor.revealPosition({ paragraph: 10, offset: 0 }, { block: "start" });
    expect(editor.getScrollState().scrollHeight).toBe(480);
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll"));

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(mirrorElement.querySelector(".s9-widget-block")).toBeNull();
    expect(editor.getScrollState().scrollHeight).toBe(480);

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("normalizes scaled mirror measurements before sharing geometry", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    mirrorElement.style.transform = "scale(0.25)";
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [blockWidgetPlugin(() => 100, 0.25)],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(editor.getScrollState().scrollHeight).toBe(480);

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("normalizes mirror measurements using effective ancestor scale", () => {
    const container = document.createElement("div");
    const mirrorWrapper = document.createElement("div");
    const mirrorElement = document.createElement("div");
    mirrorWrapper.append(mirrorElement);
    Object.defineProperty(mirrorElement, "offsetHeight", {
      configurable: true,
      value: 400,
    });
    mirrorElement.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    setViewport(container, 40);
    document.body.append(container, mirrorWrapper);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [blockWidgetPlugin(() => 100, 0.25)],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(editor.getScrollState().scrollHeight).toBe(480);

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorWrapper.remove();
  });

  it("refreshes virtual geometry when mirror widgets resize", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    let widgetHeight = 40;

    try {
      const editor = new ScribeFrame(container, {
        content: lines(20),
        plugins: [blockWidgetPlugin(() => widgetHeight)],
        virtualization: { estimateParagraphHeight: 20, overscan: 0 },
      });
      const mirror = editor.attachRenderMirror(mirrorElement);
      expect(editor.getScrollState().scrollHeight).toBe(420);

      widgetHeight = 120;
      callbacks.forEach((callback) =>
        callback([], {} as ResizeObserver)
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      expect(editor.getScrollState().scrollHeight).toBe(500);

      mirror.destroy();
      editor.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      container.remove();
      mirrorElement.remove();
    }
  });

  it("keeps mounted primary widget measurements authoritative", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("surface-specific-widget-height"),
      init: () => null,
      apply: () => null,
      widgets: ({ doc, readOnly }): readonly WidgetDecoration[] => [{
        key: "surface-specific-widget-height:first",
        placement: "block",
        range: {
          from: { paragraph: 0, offset: 0 },
          to: { paragraph: 0, offset: doc.paragraphs[0]?.text.length ?? 0 },
        },
        props: { height: readOnly ? 120 : 40 },
        render: {
          mount(host, props) {
            let height = props.height as number;
            host.getBoundingClientRect = () =>
              ({
                left: 0,
                top: 0,
                right: 400,
                bottom: height,
                width: 400,
                height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              }) as DOMRect;
            return {
              update(nextProps) {
                height = nextProps.height as number;
              },
              destroy() {},
            };
          },
        },
        selection: "block",
      }],
    };
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);

    try {
      const editor = new ScribeFrame(container, {
        content: lines(20),
        plugins: [plugin],
        virtualization: { estimateParagraphHeight: 20, overscan: 0 },
      });
      const mirror = editor.attachRenderMirror(mirrorElement);

      expect(editor.getScrollState().scrollHeight).toBe(420);

      [...callbacks].reverse().forEach((callback) =>
        callback([], {} as ResizeObserver)
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      expect(editor.getScrollState().scrollHeight).toBe(420);

      mirror.destroy();
      editor.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      container.remove();
      mirrorElement.remove();
    }
  });

  it("rebuilds fallback geometry from only active mirrors", () => {
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("mirror-owned-widget-height"),
      init: () => null,
      apply: () => null,
      widgets: ({ doc }): readonly WidgetDecoration[] => [{
        key: "mirror-owned-widget-height:ten",
        placement: "block",
        range: {
          from: { paragraph: 10, offset: 0 },
          to: {
            paragraph: 10,
            offset: doc.paragraphs[10]?.text.length ?? 0,
          },
        },
        props: {},
        render: {
          mount(host) {
            host.getBoundingClientRect = () => {
              const mirrorHeight = Number(
                host.closest<HTMLElement>(".s9-editor-mirror")
                  ?.dataset.widgetHeight,
              );
              const height = Number.isFinite(mirrorHeight) && mirrorHeight > 0
                ? mirrorHeight
                : 40;
              return {
                left: 0,
                top: 0,
                right: 400,
                bottom: height,
                width: 400,
                height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              } as DOMRect;
            };
            return { update() {}, destroy() {} };
          },
        },
        selection: "block",
      }],
    };
    const container = document.createElement("div");
    const firstMirrorElement = document.createElement("div");
    const secondMirrorElement = document.createElement("div");
    firstMirrorElement.dataset.widgetHeight = "80";
    secondMirrorElement.dataset.widgetHeight = "120";
    setViewport(container, 40);
    document.body.append(container, firstMirrorElement, secondMirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [plugin],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    const firstMirror = editor.attachRenderMirror(firstMirrorElement);
    expect(editor.getScrollState().scrollHeight).toBe(460);

    const secondMirror = editor.attachRenderMirror(secondMirrorElement);
    expect(editor.getScrollState().scrollHeight).toBe(500);

    secondMirror.destroy();
    expect(editor.getScrollState().scrollHeight).toBe(460);

    firstMirror.destroy();
    expect(editor.getScrollState().scrollHeight).toBe(400);

    editor.setContent(lines(5));
    const replacementHeight = editor.getScrollState().scrollHeight;
    const baselineContainer = document.createElement("div");
    setViewport(baselineContainer, 40);
    document.body.append(baselineContainer);
    const baseline = new ScribeFrame(baselineContainer, {
      content: lines(5),
      plugins: [plugin],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });
    expect(replacementHeight).toBe(baseline.getScrollState().scrollHeight);

    baseline.destroy();
    editor.destroy();
    baselineContainer.remove();
    container.remove();
    firstMirrorElement.remove();
    secondMirrorElement.remove();
  });
});
