import { InfosModel, UserModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add reported listening durations and import identities");
  await UserModel.updateMany(
    { "settings.useFullSongDurations": { $exists: false } },
    { $set: { "settings.useFullSongDurations": false } },
  );
  // Old durations remain estimates. Their actual listening time is unknown.
  await InfosModel.collection.createIndex({ owner: 1, id: 1, played_at: 1 });
  await InfosModel.collection.createIndex(
    { owner: 1, sourceKeys: 1 },
    {
      unique: true,
      partialFilterExpression: { sourceKeys: { $type: "string" } },
    },
  );
}
