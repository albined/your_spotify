import ListeningVolume from "../../ListeningOverview/ListeningVolume";
import { ImplementedChartProps } from "../types";

export default function SongsListenedPer({ className }: ImplementedChartProps) {
  return <ListeningVolume metric="songs" className={className} />;
}
