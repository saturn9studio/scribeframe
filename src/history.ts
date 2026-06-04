import { createTransactionMetaKey, emptyTransactionMeta } from "./metadata";
import type { EditorDocument, Selection } from "./model";
import { documentToText } from "./model";
import type { SyntaxSnapshot } from "./syntax";
import type { DisplayChange, Transaction } from "./transaction";

export type HistoryEvent =
  | { readonly kind: "typing"; readonly text: string }
  | { readonly kind: "deleteBackward" }
  | { readonly kind: "deleteForward" }
  | { readonly kind: "widgetEdit"; readonly source: string }
  | { readonly kind: "boundary" };

export const historyEventMetaKey =
  createTransactionMetaKey<HistoryEvent>("historyEvent");

export interface HistorySnapshot {
  readonly doc: EditorDocument;
  readonly selection: Selection;
  readonly syntax: SyntaxSnapshot;
}

export interface HistoryEntry {
  readonly before: HistorySnapshot;
  readonly after: HistorySnapshot;
}

export interface HistoryRestore {
  readonly snapshot: HistorySnapshot;
  readonly transaction: Transaction;
}

export interface EditorHistoryOptions {
  readonly limit?: number;
  readonly mergeWindowMs?: number;
}

type BatchKind =
  | "typing"
  | "deleteBackward"
  | "deleteForward"
  | `widgetEdit:${string}`;

interface HistoryBatch {
  readonly kind: BatchKind;
  readonly updatedAt: number;
  readonly open: boolean;
}

interface HistoryRecord extends HistoryEntry {
  readonly batch?: HistoryBatch;
}

const fullDocumentChange = (
  before: EditorDocument,
  after: EditorDocument,
): readonly DisplayChange[] => {
  const beforeText = documentToText(before);
  const afterText = documentToText(after);
  return beforeText === afterText
    ? []
    : [{ from: 0, to: beforeText.length, insert: afterText }];
};

const restoreTransaction = (
  before: HistorySnapshot,
  after: HistorySnapshot,
): Transaction => ({
  steps: [],
  displayChanges: fullDocumentChange(before.doc, after.doc),
  docBefore: before.doc,
  docAfter: after.doc,
  selectionBefore: before.selection,
  selectionAfter: after.selection,
  meta: emptyTransactionMeta,
});

export class EditorHistory {
  private readonly undoStack: HistoryRecord[] = [];
  private readonly redoStack: HistoryRecord[] = [];
  private readonly limit: number;
  private readonly mergeWindowMs: number;

  constructor(options: EditorHistoryOptions = {}) {
    this.limit = options.limit ?? 100;
    this.mergeWindowMs = options.mergeWindowMs ?? 1500;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(
    entry: HistoryEntry,
    event: HistoryEvent = { kind: "boundary" },
    timestamp = Date.now(),
  ): void {
    const batch = this.batchForEvent(event, timestamp);
    const previous = this.undoStack[this.undoStack.length - 1];

    if (previous && batch && this.canMerge(previous, batch, timestamp)) {
      this.undoStack[this.undoStack.length - 1] = {
        ...previous,
        after: entry.after,
        batch: {
          ...batch,
          open: batch.open && !this.closesBatchAfterRecord(event),
        },
      };
      this.redoStack.length = 0;
      return;
    }

    this.undoStack.push({
      ...entry,
      batch: batch
        ? {
            ...batch,
            open: batch.open && !this.closesBatchAfterRecord(event),
          }
        : undefined,
    });
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack.length = 0;
  }

  undo(): HistoryRestore | null {
    this.closeBatch();
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.redoStack.push(this.closedRecord(entry));
    return {
      snapshot: entry.before,
      transaction: restoreTransaction(entry.after, entry.before),
    };
  }

  redo(): HistoryRestore | null {
    this.closeBatch();
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.undoStack.push(this.closedRecord(entry));
    return {
      snapshot: entry.after,
      transaction: restoreTransaction(entry.before, entry.after),
    };
  }

  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  closeBatch(): void {
    const previous = this.undoStack[this.undoStack.length - 1];
    if (!previous?.batch?.open) return;

    this.undoStack[this.undoStack.length - 1] = this.closedRecord(previous);
  }

  private batchForEvent(
    event: HistoryEvent,
    timestamp: number,
  ): HistoryBatch | undefined {
    switch (event.kind) {
      case "typing":
        return { kind: "typing", updatedAt: timestamp, open: true };
      case "deleteBackward":
        return { kind: "deleteBackward", updatedAt: timestamp, open: true };
      case "deleteForward":
        return { kind: "deleteForward", updatedAt: timestamp, open: true };
      case "widgetEdit":
        return {
          kind: `widgetEdit:${event.source}`,
          updatedAt: timestamp,
          open: true,
        };
      case "boundary":
        return undefined;
    }
  }

  private canMerge(
    previous: HistoryRecord,
    batch: HistoryBatch,
    timestamp: number,
  ): boolean {
    return (
      previous.batch?.open === true &&
      previous.batch.kind === batch.kind &&
      timestamp - previous.batch.updatedAt <= this.mergeWindowMs
    );
  }

  private closesBatchAfterRecord(event: HistoryEvent): boolean {
    return event.kind === "typing" && /\s/u.test(event.text);
  }

  private closedRecord(record: HistoryRecord): HistoryRecord {
    return record.batch
      ? { ...record, batch: { ...record.batch, open: false } }
      : record;
  }
}
