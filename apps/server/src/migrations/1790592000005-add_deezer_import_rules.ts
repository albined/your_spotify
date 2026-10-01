import { ImportReviewModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("version Deezer duplicate and estimated-duration rules");
  // New jobs opt in with deezerPolicyVersion; old resumable jobs retain their
  // original behavior and fingerprints. Reimporting resolves old review rows.
  // Infos.timestampUncertain and ImportReview.policyVersion are optional.
  await ImportReviewModel.createIndexes();
}
