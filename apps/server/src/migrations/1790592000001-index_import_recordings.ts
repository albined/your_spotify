import { TrackModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("index recording identities for historical imports");
  await TrackModel.collection.createIndex({ "external_ids.isrc": 1 });
  await TrackModel.collection.createIndex({ name: 1 });
}
