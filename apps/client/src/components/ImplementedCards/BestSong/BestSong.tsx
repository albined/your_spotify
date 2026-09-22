import BestListeningCard from "../BestListeningCard";
import { ImplementedCardProps } from "../types";

export default function BestSong(props: ImplementedCardProps) {
  return <BestListeningCard kind="song" {...props} />;
}
