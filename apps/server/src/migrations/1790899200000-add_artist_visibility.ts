import { UserModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add reversible artist visibility preferences");
  await UserModel.updateMany(
    { "settings.artistVisibility": { $exists: false } },
    { $set: { "settings.artistVisibility": [] } },
  );
}
