import { api } from "../../../apis/api";
import { myAsyncThunk } from "../../tools";
import { selectImportStates } from "./selector";
import { ImporterState } from "./types";

export const getImports = myAsyncThunk<
  ImporterState[] | null,
  boolean | undefined
>("@import/get", async (force, tapi) => {
  if (!force && selectImportStates(tapi.getState())) {
    return null;
  }
  const { data: imports } = await api.getImports();
  return imports;
});
