import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_dry_run: "false",
      npm_config_json: "false",
      ...options.env,
    },
    stdio: "pipe",
    ...options,
  });

const tarballNameFromPackOutput = (output) => {
  const trimmed = output.trim();
  try {
    const packResult = JSON.parse(trimmed);
    const filename = packResult?.[0]?.filename;
    if (typeof filename === "string" && filename.length > 0) return filename;
  } catch {
    // npm prints the tarball filename in plain text outside JSON publish mode.
  }

  const filename = trimmed.split(/\r?\n/u).filter(Boolean).at(-1);
  if (!filename) throw new Error("npm pack did not report a tarball filename");
  return filename;
};

const tarballName = tarballNameFromPackOutput(
  run(npm, ["pack", "--silent", "--ignore-scripts", "--dry-run=false"]),
);
const tarballPath = join(packageRoot, tarballName);
const workspace = join(tmpdir(), `scribeframe-pack-smoke-${process.pid}`);

try {
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  run(npm, ["init", "-y", "--silent"], { cwd: workspace });
  run(npm, ["install", "--silent", "--ignore-scripts", tarballPath], {
    cwd: workspace,
  });

  run(
    node,
    [
      "--input-type=module",
      "--eval",
      [
        "const mod = await import('@saturn9/scribeframe');",
        "if (!mod.ScribeFrame || !mod.createTransaction || !mod.PluginId) throw new Error('missing public exports');",
        "if ('createPluginSlot' in mod) throw new Error('plugin slot internals are public');",
        "await import('@saturn9/scribeframe/dist/pluginSlot.js').then(",
        "  () => { throw new Error('plugin slot subpath is public'); },",
        "  (error) => { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; },",
        ");",
      ].join("\n"),
    ],
    { cwd: workspace },
  );

  run(
    node,
    [
      "--eval",
      "require.resolve('@saturn9/scribeframe/styles.css');",
    ],
    { cwd: workspace },
  );

  const sourceMap = JSON.parse(
    readFileSync(
      join(
        workspace,
        "node_modules",
        "@saturn9",
        "scribeframe",
        "dist",
        "index.js.map",
      ),
      "utf8",
    ),
  );
  if (
    !Array.isArray(sourceMap.sourcesContent) ||
    sourceMap.sourcesContent.length === 0
  ) {
    throw new Error("published source maps must include sourcesContent");
  }

  writeFileSync(
    join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
      },
      include: ["index.mts"],
    }),
  );
  writeFileSync(
    join(workspace, "index.mts"),
    [
      "import { ScribeFrame, PluginId, createDocument, createTransaction, type EditorPlugin } from '@saturn9/scribeframe';",
      "import '@saturn9/scribeframe/styles.css';",
      "// @ts-expect-error internal transaction helper should not be public",
      "import { applyStep } from '@saturn9/scribeframe';",
      "// @ts-expect-error internal metadata singleton should not be public",
      "import { emptyTransactionMeta } from '@saturn9/scribeframe';",
      "// @ts-expect-error internal render output helper should not be public",
      "import { emptyRenderOutput } from '@saturn9/scribeframe';",
      "// @ts-expect-error unused annotation API should not be public",
      "import type { AnnotationDecoration } from '@saturn9/scribeframe';",
      "const host = document.createElement('div');",
      "const pluginId = new PluginId<{ count: number }>('consumer');",
      "const plugin: EditorPlugin<{ count: number }> = {",
      "  id: pluginId,",
      "  init: () => ({ count: 0 }),",
      "  apply: ({ state }) => ({ count: state.count + 1 }),",
      "};",
      "const editor = new ScribeFrame(host, { doc: createDocument(), plugins: [plugin] });",
      [
        "editor.dispatch(createTransaction(editor.getDocument(), editor.getSelection())",
        "  .replaceSelection('x')",
        "  .build());",
      ].join("\n"),
    ].join("\n"),
  );

  run(
    npm,
    [
      "exec",
      "--",
      "tsc",
      "--noEmit",
      "--pretty",
      "false",
      "-p",
      join(workspace, "tsconfig.json"),
    ],
  );
} finally {
  rmSync(tarballPath, { force: true });
  rmSync(workspace, { recursive: true, force: true });
}
