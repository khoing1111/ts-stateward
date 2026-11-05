import { dispatch, getFolder } from "./api.js";

// A real project's loader: `isError` destructured from the result and tested before the
// success path is a check.
export async function loadFolderName(id: string): Promise<string> {
  const { data, isError } = await dispatch(getFolder.initiate(id));
  if (isError) throw new Error("Could not load the folder");
  return data?.name ?? "";
}

export async function loadFolderSucceeded(id: string): Promise<string> {
  const { data, isSuccess } = await dispatch(getFolder.initiate(id));
  if (!isSuccess) return "";
  return data.name;
}
