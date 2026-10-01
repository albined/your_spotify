import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { MongoClient } from "mongodb";

import { getWithDefault } from "./env";
import { logger } from "./logger";

const exec = promisify(execFile);
let active: Promise<string> | undefined;
let lastError: string | null = null;
let stopping = false;
const archivePattern =
  /^your-spotify-\d{4}-\d\d-\d\dT[\d-]+Z-(daily|import)\.archive\.gz$/;
export const backupsEnabled = () => getWithDefault("BACKUPS_ENABLED", false);

export async function backupStatus() {
  const dir = getWithDefault("BACKUP_DIR", "/backups");
  const files = await readdir(dir).catch(() => [] as string[]);
  return {
    enabled: backupsEnabled(),
    beforeImport: getWithDefault("BACKUP_BEFORE_IMPORT", true),
    schedule: getWithDefault("BACKUP_SCHEDULE", "0 3 * * *"),
    retentionDays: getWithDefault("BACKUP_RETENTION_DAYS", 14),
    running: Boolean(active),
    lastError,
    latest:
      files
        .filter((f) => archivePattern.test(f))
        .sort()
        .at(-1) ?? null,
  };
}

async function createBackup(reason: "daily" | "import") {
  const dir = getWithDefault("BACKUP_DIR", "/backups");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `your-spotify-${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}.archive.gz`;
  const target = join(dir, name);
  const temporary = `${target}.partial`;
  const uri = getWithDefault(
    "MONGO_ENDPOINT",
    "mongodb://mongo:27017/your_spotify",
  );
  const client = new MongoClient(uri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
  });
  const configDir = await mkdtemp(join(tmpdir(), "your-spotify-backup-"));
  const config = join(configDir, "config.yml");
  let locked = false;
  try {
    // Keep credentials out of argv and logs.
    await writeFile(config, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });
    await writeFile(temporary, "", { mode: 0o600, flag: "wx" });
    await client.connect();
    // The existing Compose deployment uses standalone Mongo. A database-level
    // write lock gives a consistent dump, including writes outside this process.
    await client.db("admin").command({ fsync: 1, lock: true });
    locked = true;
    try {
      await exec(
        "mongodump",
        ["--config", config, "--archive=" + temporary, "--gzip"],
        { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
      );
    } catch {
      throw new Error(
        "Database backup failed. Check mongodump installation, permissions and backup disk space.",
      );
    }
    const info = await stat(temporary);
    if (!info.size)
      throw new Error("Database backup produced an empty archive");
    await client.db("admin").command({ fsyncUnlock: 1 });
    locked = false;
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    lastError = null;
    // Prune only this application's completed archives, after a successful dump.
    const cutoff =
      Date.now() - getWithDefault("BACKUP_RETENTION_DAYS", 14) * 86400000;
    for (const file of await readdir(dir)) {
      if (!archivePattern.test(file) || file === name) continue;
      if ((await stat(join(dir, file))).mtimeMs < cutoff)
        await rm(join(dir, file));
    }
    return basename(target);
  } finally {
    try {
      if (locked) await client.db("admin").command({ fsyncUnlock: 1 });
    } finally {
      await client.close();
      await rm(configDir, { recursive: true, force: true });
      await rm(temporary, { force: true });
    }
  }
}

export async function runBackup(reason: "daily" | "import") {
  if (stopping)
    throw new Error("Server is shutting down; retry the import after restart");
  // Each pre-import request gets a backup taken after earlier backups finish.
  while (active) await active;
  if (stopping)
    throw new Error("Server is shutting down; retry the import after restart");
  active = createBackup(reason);
  try {
    return await active;
  } catch (error) {
    lastError = "Backup failed; check database permissions, tools and storage.";
    logger.error(lastError);
    throw error;
  } finally {
    active = undefined;
  }
}

export async function backupBeforeImport() {
  if (!backupsEnabled() || !getWithDefault("BACKUP_BEFORE_IMPORT", true))
    return null;
  return runBackup("import");
}

export function startBackupSchedule() {
  if (!backupsEnabled()) return;
  const shutdown = () => {
    stopping = true;
    // Give the finally block time to release Mongo's lock on normal shutdown.
    void (active ?? Promise.resolve())
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGUSR2", shutdown);
  // Intentionally support one daily UTC schedule, not an unrestricted cron engine.
  const schedule = getWithDefault("BACKUP_SCHEDULE", "0 3 * * *");
  const parts = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule);
  if (!parts || Number(parts[1]) > 59 || Number(parts[2]) > 23) {
    lastError =
      "BACKUP_SCHEDULE must be a daily UTC schedule, for example 0 3 * * *.";
    logger.error(lastError);
    return;
  }
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(Number(parts[2]), Number(parts[1]), 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    setTimeout(() => {
      runBackup("daily")
        .catch(() => {})
        .finally(scheduleNext);
    }, next.getTime() - now.getTime()).unref();
  };
  scheduleNext();
}
