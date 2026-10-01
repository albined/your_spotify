import { startMigration } from "../tools/migrations";

export async function up() {
  startMigration("retain per-listen import exclusions");
  // ImportReview.excluded is optional. Existing evidence and listening events
  // remain unchanged; only an explicit review choice sets the flag.
  // Import receipts may now include summary.excluded (absent means zero).
}
