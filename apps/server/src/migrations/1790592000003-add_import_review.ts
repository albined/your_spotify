import { ImportMappingModel, ImportReviewModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("persist unresolved import rows and user recording choices");
  await ImportReviewModel.createIndexes();
  await ImportMappingModel.createIndexes();
  // Old receipts only retained examples. Reimporting rebuilds their full queue.
  // issueCounts, fingerprintVersion and Infos.recordingMappingId are optional;
  // old prepared jobs retain their original fingerprint algorithm.
}
