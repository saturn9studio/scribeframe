import {
  PluginId,
  type EditorPlugin,
  type InlineDecoration,
} from "@saturn9/scribeframe";

export const hiddenInlineFixtureContent = "before METADATAafter";

const hiddenInlineFixturePluginId = new PluginId<null>(
  "demo-hidden-inline-fixture",
);

const inline = (
  from: number,
  to: number,
  className: string,
): InlineDecoration => ({
  kind: "inline",
  from,
  to,
  attrs: { class: className },
});

export const hiddenInlineFixturePlugin = (): EditorPlugin<null> => ({
  id: hiddenInlineFixturePluginId,
  init: () => null,
  apply: () => null,
  decorations: () => [
    inline(7, 15, "demo-hidden-inline"),
    inline(15, 16, "demo-inline-affordance-start"),
  ],
});
