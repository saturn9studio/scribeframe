import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { ScribeFrame, emptySyntaxSnapshot } from "../src";
import {
  markdownPlugin,
  markdownSyntaxProvider,
  requireMarkdownSyntaxSnapshot,
} from "../demo/src/markdown";

const collectFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });

const srcRoot = resolve(cwd(), "src");

describe("scribeframe core boundary", () => {
  it("uses neutral syntax until an adapter provider is supplied", () => {
    const coreEditor = new ScribeFrame(document.createElement("div"), {
      content: "# Heading",
    });
    expect(coreEditor.getSyntaxSnapshot()).toBe(emptySyntaxSnapshot);
    coreEditor.destroy();

    const markdownEditor = new ScribeFrame(document.createElement("div"), {
      content: "# Heading",
      syntaxProvider: markdownSyntaxProvider,
    });
    expect(
      requireMarkdownSyntaxSnapshot(markdownEditor.getSyntaxSnapshot()).projection
        .markdownText,
    ).toBe("# Heading");
    markdownEditor.destroy();
  });

  it("requires Markdown plugins to be paired with the Markdown syntax provider", () => {
    expect(
      () =>
        new ScribeFrame(document.createElement("div"), {
          content: "# Heading",
          plugins: [markdownPlugin()],
        }),
    ).toThrow('Expected markdown syntax snapshot, received "none" syntax');
  });

  it("keeps core modules independent from Markdown projection and parser code", () => {
    const offenders = collectFiles(srcRoot)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const importsMarkdown =
          /from\s+["'][^"']*markdown/.test(source) ||
          /from\s+["'][^"']*projection/.test(source);
        const importsParser = source.includes("@saturn9/markoffset");
        return importsMarkdown || importsParser ? [relative(srcRoot, file)] : [];
      });

    expect(offenders).toEqual([]);
  });

  it("keeps published core styles free of demo adapter classes", () => {
    const offenders = collectFiles(srcRoot)
      .filter((file) => file.endsWith(".css") || file.endsWith(".ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return /s9-md-|s9-code-widget|markdown|markoffset/i.test(source)
          ? [relative(srcRoot, file)]
          : [];
      });

    expect(offenders).toEqual([]);
  });

  it("does not export the Markdown adapter from the core barrel", () => {
    expect(readFileSync(`${srcRoot}/index.ts`, "utf8")).not.toMatch(
      /["']\.\/markdown/,
    );
  });

  it("does not expose a Markdown package subpath", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(cwd(), "package.json"), "utf8"),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };

    expect(Object.keys(manifest.exports ?? {})).not.toContain("./markdown");
  });
});
