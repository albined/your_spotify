import { ArtistGroupModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("add reversible artist groups");
  await ArtistGroupModel.createIndexes();
}
