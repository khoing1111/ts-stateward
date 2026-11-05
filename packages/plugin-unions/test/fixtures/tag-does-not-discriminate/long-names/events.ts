export type UploadPipelineProgressMessageFromTheServer =
  | { aVeryLongPropertyNameForTheKindOfMessage: "initialisingTheConnection"; id: number }
  | { aVeryLongPropertyNameForTheKindOfMessage: string; raw: unknown };
