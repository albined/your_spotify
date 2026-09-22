import { Types } from "mongoose";

import { YourSpotifyError } from "../../tools/errors/error";
import { UserModel } from "../Models";

class CompetitionNotAllowed extends YourSpotifyError {
  type = "FORBIDDEN" as const;
  constructor() {
    super("A selected person is unavailable for competitions.");
  }
}

export async function listCompetitionParticipants() {
  const users = await UserModel.find({
    "settings.allowCompetitions": { $ne: false },
  })
    .select("username")
    .sort({ username: 1, _id: 1 })
    .lean();
  return users.map((user) => ({
    id: user._id.toHexString(),
    name: user.username,
  }));
}

// Check every requested person before querying any listening data. Missing
// preferences default in, but neither a stale selection nor a direct API call
// can include someone who opted out. Preserve the requested color/series order.
export async function requireCompetitionParticipants(userIds: string[]) {
  const ids = [
    ...new Set(userIds.map((id) => new Types.ObjectId(id).toHexString())),
  ];
  const users = await UserModel.find({ _id: { $in: ids } })
    .select("username settings.timezone settings.allowCompetitions")
    .lean();
  const byId = new Map(users.map((user) => [user._id.toHexString(), user]));
  return ids.map((id) => {
    const user = byId.get(id);
    if (!user || user.settings?.allowCompetitions === false) {
      throw new CompetitionNotAllowed();
    }
    return user;
  });
}
