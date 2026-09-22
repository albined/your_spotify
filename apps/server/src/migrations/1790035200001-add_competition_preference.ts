import { UserModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add competition participation preference");
  await UserModel.updateMany(
    { "settings.allowCompetitions": { $exists: false } },
    { $set: { "settings.allowCompetitions": true } },
  );
}
