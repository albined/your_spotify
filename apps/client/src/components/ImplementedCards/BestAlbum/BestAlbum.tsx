import BestListeningCard from "../BestListeningCard";
import { ImplementedCardProps } from "../types";

export default function BestAlbum(props: ImplementedCardProps) {
  return <BestListeningCard kind="album" {...props} />;
}
