import { ImportMappingModel, ImportReviewModel } from "../database/Models";
import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("allow saved no-match recording choices");
  // Optional ImportMapping.noMatch permits a choice without a trackId.
  // Review status 'no-match' retains its source evidence for reopening.
  // Old mappings and receipts need no rewrite; missing summary.noMatch is zero.
  await ImportMappingModel.createIndexes();
  await ImportReviewModel.createIndexes();
}
