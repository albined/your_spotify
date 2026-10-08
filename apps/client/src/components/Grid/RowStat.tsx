import s from "./index.module.css";

function listened(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// The phone form of a ranking row's figures: plays over listening time.
export function RowStat({
  count,
  duration,
}: {
  count: number;
  duration: number;
}) {
  return (
    <div className={s.stat}>
      <strong>
        {count} {count === 1 ? "play" : "plays"}
      </strong>
      <span>{listened(duration)}</span>
    </div>
  );
}
