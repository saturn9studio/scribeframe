import { describe, expect, it } from "vitest";
import {
  absoluteOffset,
  collapsedSelection,
  createTransaction,
  documentFromText,
  documentToText,
  firstPosition,
  positionFromOffset,
  createTransactionMetaKey,
} from "../src";

describe("transactions", () => {
  it("roundtrips empty and trailing-paragraph display text", () => {
    ["", "\n", "one\n", "one\n\nthree\n"].forEach((text) => {
      expect(documentToText(documentFromText(text))).toBe(text);
    });
  });

  it("roundtrips absolute offsets at paragraph boundaries", () => {
    const text = "a\n\nbc\n";
    const doc = documentFromText(text);

    Array.from({ length: text.length + 1 }, (_value, offset) => {
      expect(absoluteOffset(doc, positionFromOffset(doc, offset))).toBe(offset);
    });
    expect(absoluteOffset(doc, positionFromOffset(doc, text.length + 10))).toBe(
      text.length,
    );
  });

  it("replaces text inside a paragraph immutably", () => {
    const doc = documentFromText("hello world");
    const selection = collapsedSelection({ paragraph: 0, offset: 5 });

    const tr = createTransaction(doc, selection)
      .replaceRange(
        { paragraph: 0, offset: 6 },
        { paragraph: 0, offset: 11 },
        "engine",
      )
      .build();

    expect(documentToText(doc)).toBe("hello world");
    expect(documentToText(tr.docAfter)).toBe("hello engine");
    expect(tr.selectionAfter.head).toEqual({ paragraph: 0, offset: 12 });
  });

  it("splits and rejoins paragraphs with range replacement", () => {
    const doc = documentFromText("one\ntwo\nthree");
    const selection = collapsedSelection(firstPosition());

    const tr = createTransaction(doc, selection)
      .replaceRange(
        { paragraph: 0, offset: 1 },
        { paragraph: 2, offset: 2 },
        "X\nY",
      )
      .build();

    expect(documentToText(tr.docAfter)).toBe("oX\nYree");
    expect(tr.selectionAfter.head).toEqual({ paragraph: 1, offset: 1 });
  });

  it("stores typed metadata without exposing an untyped map", () => {
    const key = createTransactionMetaKey<{ readonly reason: string }>("reason");
    const doc = documentFromText("");
    const selection = collapsedSelection(firstPosition());

    const tr = createTransaction(doc, selection)
      .setMeta(key, { reason: "demo" })
      .build();

    expect(tr.meta.get(key)).toEqual({ reason: "demo" });
  });

  it("keeps same-name metadata keys isolated by key identity", () => {
    const firstKey =
      createTransactionMetaKey<{ readonly value: string }>("shared");
    const secondKey =
      createTransactionMetaKey<{ readonly value: number }>("shared");
    const doc = documentFromText("");
    const selection = collapsedSelection(firstPosition());

    const tr = createTransaction(doc, selection)
      .setMeta(firstKey, { value: "first" })
      .setMeta(secondKey, { value: 2 })
      .build();

    expect(tr.meta.get(firstKey)).toEqual({ value: "first" });
    expect(tr.meta.get(secondKey)).toEqual({ value: 2 });
  });

  it("records display-space changes for text replacements", () => {
    const doc = documentFromText("one\ntwo");
    const selection = collapsedSelection(firstPosition());

    const tr = createTransaction(doc, selection)
      .replaceRange(
        { paragraph: 0, offset: 1 },
        { paragraph: 1, offset: 1 },
        "X\nY",
      )
      .setSelection({ anchor: firstPosition(), head: firstPosition() })
      .build();

    expect(tr.displayChanges).toEqual([{ from: 1, to: 5, insert: "X\nY" }]);
  });

  it("does not record display changes for selection updates", () => {
    const doc = documentFromText("text");
    const selection = collapsedSelection(firstPosition());

    const tr = createTransaction(doc, selection)
      .setSelection({
        anchor: { paragraph: 0, offset: 1 },
        head: { paragraph: 0, offset: 1 },
      })
      .build();

    expect(tr.displayChanges).toEqual([]);
  });
});
