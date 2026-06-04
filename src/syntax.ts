import type { EditorDocument } from "./model";
import type { DisplayChange } from "./transaction";

export interface SyntaxSnapshot {
  readonly kind: string;
  readonly version: number;
}

export interface SyntaxProvider {
  create(doc: EditorDocument): SyntaxSnapshot;
  update(
    previous: SyntaxSnapshot,
    doc: EditorDocument,
    displayChanges: readonly DisplayChange[],
  ): SyntaxSnapshot;
}

export const emptySyntaxSnapshot: SyntaxSnapshot = Object.freeze({
  kind: "none",
  version: 0,
});

export const emptySyntaxProvider: SyntaxProvider = {
  create: (_doc) => emptySyntaxSnapshot,
  update: (previous, _doc, _displayChanges) => previous,
};
