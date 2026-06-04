import { expect, test, type Page } from "@playwright/test";

const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";

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
