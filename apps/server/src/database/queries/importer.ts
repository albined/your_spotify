import { ImporterStateModel } from "../Models";

export const getUserImporterState = (userId: string) =>
  ImporterStateModel.find({ user: userId }).sort({ createdAt: -1 });

export const fixRunningImportsAtStart = () =>
  ImporterStateModel.updateMany(
    { status: "progress" },
    {
      status: "failure",
      stage: "failed",
      error: "Server restarted. Retry to resume from the last saved row.",
    },
  );
