import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import { useAPI } from "../../services/hooks/hooks";

import s from "./ListeningSettings.module.css";

export default function Backups() {
  const status = useAPI(api.backupStatus);
  return (
    <TitleCard title="Database backups" contentClassName={s.content}>
      {!status ? (
        <p>Loading backup status…</p>
      ) : (
        <>
          <p>
            {status.enabled ? "Enabled" : "Disabled"} · Configured by the server
            administrator.
          </p>
          {status.enabled && (
            <>
              <p>
                Daily UTC schedule: {status.schedule}. Retention:{" "}
                {status.retentionDays} days.
              </p>
              <p>
                Backup before imports:{" "}
                {status.beforeImport ? "Enabled" : "Disabled"}
              </p>
            </>
          )}
          <p>
            {status.running
              ? "Backup in progress"
              : status.latest
                ? `Latest archive: ${status.latest}`
                : "No backup archive found"}
          </p>
          {status.lastError && <p role="alert">{status.lastError}</p>}
          <p>
            A full restore rolls back the database, including changes made since
            the backup.
          </p>
        </>
      )}
    </TitleCard>
  );
}
