type NoteId = string & { readonly brand: "NoteId" };

// A real project's case: both are set for a note, only one is forgotten on delete.
export const savedRelevanceByNoteId: Record<NoteId, number> = {};
export const viewEpochByNoteId: Record<NoteId, number> = {};

export function openNote(id: NoteId, relevance: number, epoch: number): void {
  savedRelevanceByNoteId[id] = relevance;
  viewEpochByNoteId[id] = epoch;
}

export function removeNote(id: NoteId): void {
  delete viewEpochByNoteId[id];
}
