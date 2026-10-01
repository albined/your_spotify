import { ImporterStateModel, InfosModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add opt-in legacy Deezer recording repairs");
  await ImporterStateModel.updateMany(
    { repairLegacyDeezer: { $exists: false } },
    { $set: { repairLegacyDeezer: false } },
  );
  // Infos.recordingRepair is optional: only actual repairs store a snapshot.
  await InfosModel.collection.createIndex({ owner: 1, played_at: 1 });
}
