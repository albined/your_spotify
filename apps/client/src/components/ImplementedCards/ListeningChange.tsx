import s from "./index.module.css";

export default function ListeningChange({
  percent,
  unit,
}: {
  percent: number;
  unit: string;
}) {
  const description =
    percent === 0
      ? `No change from last ${unit}`
      : `${Math.abs(percent)}% ${percent < 0 ? "less" : "more"} than last ${unit}`;
  return (
    <span className={s.delta}>
      <span className={s.screenReaderOnly}>{description}</span>
      <span className={s.deltaVisual} aria-hidden="true">
        <span>{percent < 0 ? "↓" : percent > 0 ? "↑" : "→"}</span>
        {Math.abs(percent)}%<span className={s.wide}> vs last {unit}</span>
      </span>
    </span>
  );
}
