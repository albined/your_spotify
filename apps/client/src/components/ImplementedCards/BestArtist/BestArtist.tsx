import BestListeningCard from "../BestListeningCard";
import { ImplementedCardProps } from "../types";

export default function BestArtist(props: ImplementedCardProps) {
  return <BestListeningCard kind="artist" {...props} />;
}
