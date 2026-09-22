import ListeningVolume from "../../ListeningOverview/ListeningVolume";
import { ImplementedChartProps } from "../types";

export default function TimeListenedPer({ className }: ImplementedChartProps) {
  return <ListeningVolume metric="hours" className={className} />;
}
