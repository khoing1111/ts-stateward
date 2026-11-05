type Status = "idle" | "failed" | "done";

declare const theCurrentStatusOfTheUploadPipelineInTheApp: Status;
declare const labelsForEveryStatusOfTheUploadPipelineInTheApp: Record<string, string>;
declare const exactLabelsForEveryStatusOfTheUploadPipeline: { idle: string; [key: string]: string };

export const open = labelsForEveryStatusOfTheUploadPipelineInTheApp[theCurrentStatusOfTheUploadPipelineInTheApp];
export const mixed = exactLabelsForEveryStatusOfTheUploadPipeline[theCurrentStatusOfTheUploadPipelineInTheApp];
