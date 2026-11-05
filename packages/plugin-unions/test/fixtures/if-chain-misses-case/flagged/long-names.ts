type UploadStatus =
  | { stage: "initialisingTheConnection" }
  | { stage: "uploadingTheFirstChunk" }
  | { stage: "finished" };

export function longNames(thisIsAVeryLongVariableNameForTheUploadStatusObject: UploadStatus): number {
  if (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage === "finished") {
    return 0;
  } else if (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage === "finished") {
    return 1;
  }
  return 2;
}

export function longComplete(thisIsAVeryLongVariableNameForTheUploadStatusObject: UploadStatus): number {
  if (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage === "finished") {
    return 0;
  } else if (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage === "uploadingTheFirstChunk") {
    return 1;
  } else if (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage === "initialisingTheConnection") {
    return 3;
  } else {
    return 2;
  }
}

export function many(word: "alpha" | "bravo" | "charlie" | "delta" | "echo" | "foxtrot"): number {
  if (word === "alpha") {
    return 0;
  } else if (word === "alpha") {
    return 1;
  }
  return 2;
}

// Enum members with long names (found on real apps: generated protobuf enums). The subject stays
// readable; the members are listed by their own names.
export enum InstanceSetting_StorageType {
  STORAGE_TYPE_UNSPECIFIED = 0,
  DATABASE = 1,
  LOCAL = 2,
  S3 = 3,
}

export function canSave(selectedStorageType: InstanceSetting_StorageType): boolean {
  if (selectedStorageType === InstanceSetting_StorageType.LOCAL) {
    return true;
  } else if (selectedStorageType === InstanceSetting_StorageType.S3) {
    return false;
  }
  return false;
}
