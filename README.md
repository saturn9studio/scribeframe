# Scribeframe

`@saturn9/scribeframe` is a format-agnostic text editor engine with owned
document state, rendering, input, plugins, and widget lifecycle.

The current scope is intentionally small:

- Immutable paragraph document model.
- Transaction-based editing.
- Plugin state and typed metadata.
- Owned DOM rendering with a focus-proxy textarea.
- Virtualized paragraph rendering with explicit scroll/reveal APIs.
- Renderer-owned widget mount/update/destroy lifecycle.
- A vanilla browser demo that shows Markdown as one possible adapter.

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
