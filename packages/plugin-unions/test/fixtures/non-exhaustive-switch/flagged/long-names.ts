type Upload = {
  currentProcessingStageOfTheUploadPipeline: "initialisingTheConnection" | "uploadingTheFirstChunk" | "x";
};

export function hidden(thisIsAVeryLongVariableNameForTheUploadStatusObject: Upload): number {
  switch (thisIsAVeryLongVariableNameForTheUploadStatusObject.currentProcessingStageOfTheUploadPipeline) {
    case "x":
      return 1;
    default:
      return 0;
  }
}

export function complete(thisIsAVeryLongVariableNameForTheUploadStatusObject: { stage: "x" | "y" }): number {
  switch (thisIsAVeryLongVariableNameForTheUploadStatusObject.stage) {
    case "x":
      return 1;
    case "y":
      return 2;
    default:
      return 0;
  }
}
