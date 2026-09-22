import { UserModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add all-time start date to user");
  await UserModel.updateMany(
    { "settings.allTimeStartDate": { $exists: false } },
    { $set: { "settings.allTimeStartDate": null } },
  );
}
