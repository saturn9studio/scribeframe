# Scribeframe

`@saturn9/scribeframe` is a format-agnostic text editor engine with owned
document state, rendering, input, plugins, and widget lifecycle.

## Install

```bash
npm install @saturn9/scribeframe
```

## Quick start

```ts
import { ScribeFrame } from "@saturn9/scribeframe";
import "@saturn9/scribeframe/styles.css";

const host = document.querySelector<HTMLElement>("#editor");
if (!host) throw new Error("Editor host not found");

const editor = new ScribeFrame(host, {
  content: "Hello, Scribeframe",
  ariaLabel: "Document editor",
  onChange: (state) => {
    console.log(state.content);
  },
});
```

Scribeframe runs in browser environments and owns the DOM inside the host
element. Import `@saturn9/scribeframe/styles.css` once, then theme the documented
CSS variables from your app stylesheet.

The current scope is intentionally small:

- Immutable paragraph document model.
- Transaction-based editing.
- Plugin state and typed metadata.
- Owned DOM rendering with a focus-proxy textarea.
- Virtualized paragraph rendering with explicit scroll/reveal APIs.
- Renderer-owned widget mount/update/destroy lifecycle.
- A vanilla browser demo that shows Markdown as one possible adapter.

Markdown support is not part of the runtime package API; the demo is an example
adapter. Treat `0.x` releases as pre-1.0: public APIs are intended to be stable
within a minor line, but breaking changes may ship in minor releases until 1.0.

## Development

Run the demo:

```bash
npm run demo -w=@saturn9/scribeframe
```

Read the public API reference: [docs/API.md](docs/API.md).

Build and test:

```bash
npm run build -w=@saturn9/scribeframe
npm run test -w=@saturn9/scribeframe
```

## License

Scribeframe is licensed under the MIT License. See [LICENSE](LICENSE).
