// The parts of Firestore's types the fixture uses.
export interface DocumentReference {
  readonly id: string;
}
export type Unsubscribe = () => void;
export declare function doc(path: string): DocumentReference;
export declare function onSnapshot(
  reference: DocumentReference,
  onNext: (snapshot: unknown) => void,
): Unsubscribe;
