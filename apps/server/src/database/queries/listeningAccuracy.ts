import { reportedDuration } from "../listeningDuration";
import { ImporterStateModel, InfosModel } from "../Models";
import { User } from "../schemas/user";

export async function listeningAccuracy(user: User) {
  const [rows, latest] = await Promise.all([
    InfosModel.aggregate<{
      total: number;
      reported: number;
      latestReported: Date | null;
    }>([
      { $match: { owner: user._id, blacklistedBy: { $exists: false } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          reported: { $sum: { $cond: [reportedDuration, 1, 0] } },
          latestReported: {
            $max: { $cond: [reportedDuration, "$sourceEndedAt", null] },
          },
        },
      },
    ]),
    ImporterStateModel.findOne({ user: user._id, status: "success" })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean(),
  ]);
  return {
    total: rows[0]?.total ?? 0,
    reported: rows[0]?.reported ?? 0,
    latestReported: rows[0]?.latestReported ?? null,
    lastImport: latest?.updatedAt ?? null,
  };
}
