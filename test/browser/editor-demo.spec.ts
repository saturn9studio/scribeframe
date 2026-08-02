import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";
const selectAllShortcut = process.platform === "darwin" ? "Meta+A" : "Control+A";

const documentOutput = "[data-role='document-output']";
const focusButton = "[data-action='focus']";

const pointForEditorText = async (
  page: Page,
  targetText: string,
): Promise<{ readonly x: number; readonly y: number }> =>
  page.evaluate((target) => {
    const host = document.querySelector(".demo-editor-host");
    if (!host) throw new Error("Editor host not found");

    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const from = text.indexOf(target);
      if (from >= 0) {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + target.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
      node = walker.nextNode();
    }

    throw new Error(`Target text not found: ${target}`);
  }, targetText);

const caretX = async (page: Page): Promise<number> => {
  const box = await page.locator(".s9-caret").boundingBox();
  if (!box) throw new Error("Caret is not measurable");
  return box.x;
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("typing, undo, and redo run through real keyboard events", async ({ page }) => {
  await page.locator(focusButton).click();

  await page.keyboard.type("Browser ");

  await expect(page.locator(documentOutput)).toContainText(
    "Browser # Scribeframe Demo",
  );

  await page.keyboard.press("Control+Z");
  await expect(page.locator(documentOutput)).not.toContainText(
    "Browser # Scribeframe Demo",
  );

  await page.keyboard.press("Control+Y");
  await expect(page.locator(documentOutput)).toContainText(
    "Browser # Scribeframe Demo",
  );
});

test("read-only mode suppresses real keyboard input", async ({ page }) => {
  const documentText = page.locator(documentOutput);
  const initialContent = await documentText.textContent();

  await page.locator("[data-action='toggle-readonly']").click();
  await expect(page.locator("[role='textbox']")).toHaveAttribute(
    "aria-readonly",
    "true",
  );

  await page.keyboard.type("SHOULD_NOT_APPEAR");

  await expect(documentText).toHaveText(initialContent ?? "");
});

test("caret is hidden when editor focus leaves", async ({ page }) => {
  const caret = page.locator(".s9-caret");

  await page.locator(focusButton).click();
  await expect(caret).toBeVisible();

  await page.locator(".s9-code-widget-textarea").focus();
  await expect(caret).toBeHidden();

  await page.locator(focusButton).click();
  await expect(caret).toBeVisible();

  await page.locator(focusButton).evaluate((button: HTMLButtonElement) => {
    button.focus();
  });
  await expect(caret).toBeHidden();
});

test("empty and typed paragraphs keep matching caret geometry", async ({ page }) => {
  await page.locator(focusButton).click();
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.press("Backspace");
  await expect(page.locator(documentOutput)).toHaveText("");

  const emptyCaret = await page.locator(".s9-caret").boundingBox();
  expect(emptyCaret).not.toBeNull();

  await page.keyboard.type("A");
  await expect(page.locator(documentOutput)).toHaveText("A");

  const typedCaret = await page.locator(".s9-caret").boundingBox();
  expect(typedCaret).not.toBeNull();
  if (!emptyCaret || !typedCaret) return;

  expect(Math.abs(emptyCaret.height - typedCaret.height)).toBeLessThan(1);
  expect(Math.abs(emptyCaret.y - typedCaret.y)).toBeLessThan(1);
});

test("caret geometry stays at adjacent text while crossing hidden inline source", async ({
  page,
}) => {
  const modulePath =
    `/@fs/${resolve("src/index.ts").replace(/\\/gu, "/")}`;
  await page.addScriptTag({
    type: "module",
    content: `
      import { PluginId, ScribeFrame } from ${JSON.stringify(modulePath)};
      const host = document.createElement("div");
      const style = document.createElement("style");
      style.textContent =
        ".browser-test-hidden-inline { display: none; } " +
        ".browser-test-inline-affordance::before { display: inline-block; " +
        "width: 12px; height: 12px; margin-right: 4px; background: currentColor; " +
        "content: ''; vertical-align: -1px; }";
      document.head.append(style);
      document.body.replaceChildren(host);
      const editor = new ScribeFrame(host, {
        content: "before METADATAafter",
        plugins: [{
          id: new PluginId("browser-test-hidden-inline"),
          init: () => null,
          apply: () => null,
          decorations: () => [
            {
              kind: "inline",
              from: 7,
              to: 15,
              attrs: { class: "browser-test-hidden-inline" },
            },
            {
              kind: "inline",
              from: 15,
              to: 16,
              attrs: { class: "browser-test-inline-affordance" },
            },
          ],
        }],
      });
      editor.focus();
      window.browserTestEditorReady = true;
    `,
  });
  await page.waitForFunction("window.browserTestEditorReady === true");
  await page.keyboard.press("Home");

  const boundaries = await page.evaluate(() => {
    const measure = (
      selector: string,
      offset: number,
    ): number => {
      const element = document.querySelector<HTMLElement>(selector);
      const text = element?.firstChild;
      if (!(text instanceof Text)) throw new Error(`Missing text for ${selector}`);
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset);
      return range.getBoundingClientRect().x;
    };
    return {
      before: measure("[data-from='0'][data-to='7']", 7),
      after: measure("[data-from='15'][data-to='16']", 0),
    };
  });

  const fromLeft: number[] = [];
  for (let offset = 1; offset <= 15; offset += 1) {
    await page.keyboard.press("ArrowRight");
    if (offset >= 7) fromLeft.push(await caretX(page));
  }

  const fromRight: number[] = [await caretX(page)];
  for (let offset = 14; offset >= 7; offset -= 1) {
    await page.keyboard.press("ArrowLeft");
    fromRight.push(await caretX(page));
  }
  fromRight.reverse();

  for (const positions of [fromLeft, fromRight]) {
    expect(positions[0]).toBeCloseTo(boundaries.before, 0);
    expect(positions[positions.length - 1]).toBeCloseTo(boundaries.after, 0);
    positions.forEach((position) => {
      expect(position).toBeGreaterThanOrEqual(boundaries.before - 1);
      expect(position).toBeLessThanOrEqual(boundaries.after + 1);
    });
  }
});

test("paragraph minimum height follows configured line height", async ({ page }) => {
  const metrics = await page.locator(".s9-editor-root").evaluate((root) => {
    const element = root as HTMLElement;
    const paragraph = element.querySelector<HTMLElement>(".s9-paragraph");
    if (!paragraph) throw new Error("Paragraph not found");
    paragraph.style.fontSize = "20px";
    paragraph.style.lineHeight = "1.3";

    const style = getComputedStyle(paragraph);
    return {
      lineHeight: Number.parseFloat(style.lineHeight),
      minHeight: Number.parseFloat(style.minHeight),
    };
  });

  expect(metrics.lineHeight).toBeCloseTo(26, 1);
  expect(metrics.minHeight).toBeCloseTo(metrics.lineHeight, 1);
});

test("code block widget edits update document text", async ({ page }) => {
  const code = page.locator(".s9-code-widget-textarea");

  await code.fill('console.log("from browser widget");');

  await expect(page.locator(documentOutput)).toContainText(
    'console.log("from browser widget");',
  );
});

test("native clipboard paste inserts plain text", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "Browser clipboard permissions are only reliable in headless Chromium here.",
  );

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("Clipboard "));
  await page.locator(focusButton).click();

  await page.keyboard.press(pasteShortcut);

  await expect(page.locator(documentOutput)).toContainText(
    "Clipboard # Scribeframe Demo",
  );
});

test("double-clicking a word selects it for replacement", async ({ page }) => {
  const wordPoint = await pointForEditorText(page, "Markdown");

  await page.mouse.dblclick(wordPoint.x, wordPoint.y);
  await page.keyboard.type("plain text");

  await expect(page.locator(documentOutput)).toContainText(
    "This demo edits plain text text directly.",
  );
});

test("triple-clicking text selects the paragraph for replacement", async ({
  page,
}) => {
  const paragraphPoint = await pointForEditorText(page, "Markdown");

  await page.mouse.click(paragraphPoint.x, paragraphPoint.y, { clickCount: 3 });
  await page.keyboard.type("Replacement paragraph");

  await expect(page.locator(documentOutput)).toContainText(
    "# Scribeframe Demo\n\nReplacement paragraph\n\n~~~ts",
  );
});

test("mobile layout stacks document output below the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const layout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".demo-shell");
    const main = document.querySelector<HTMLElement>(".demo-main");
    const side = document.querySelector<HTMLElement>(".demo-side");
    const host = document.querySelector<HTMLElement>(".demo-editor-host");
    const output = document.querySelector<HTMLElement>(".demo-output");

    if (!shell || !main || !side || !host || !output) {
      throw new Error("Demo layout elements not found");
    }

    const shellColumns = getComputedStyle(shell).gridTemplateColumns
      .split(" ")
      .filter(Boolean).length;

    return {
      shellColumns,
      mainBottom: main.getBoundingClientRect().bottom,
      sideTop: side.getBoundingClientRect().top,
      hostHeight: host.getBoundingClientRect().height,
      outputHeight: output.getBoundingClientRect().height,
    };
  });

  expect(layout.shellColumns).toBe(1);
  expect(layout.sideTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
  expect(layout.hostHeight).toBeGreaterThanOrEqual(300);
  expect(layout.outputHeight).toBeGreaterThan(0);
});
