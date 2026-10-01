import s from "./index.module.css";

export default function ListeningChange({
  percent,
  unit,
}: {
  percent: number;
  unit: string;
}) {
  const direction = percent < 0 ? "less" : percent > 0 ? "more" : "same";
  return (
    <span
      className={s.delta}
      aria-label={`${Math.abs(percent)}% ${direction} than last ${unit}`}>
      <span aria-hidden="true">
        {percent < 0 ? "↓" : percent > 0 ? "↑" : "→"}
      </span>
      {Math.abs(percent)}% vs last {unit}
    </span>
  );
}
