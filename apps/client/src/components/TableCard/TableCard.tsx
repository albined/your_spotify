import { CSSProperties, ReactNode } from "react";

import { useArtworkTint } from "../../services/artworkTint";
import TitleCard from "../TitleCard";

import s from "./index.module.css";

interface TableCardProps {
  artwork?: string;
  right?: ReactNode;
  children: ReactNode;
}

export default function TableCard({
  artwork,
  right,
  children,
}: TableCardProps) {
  const tint = useArtworkTint(artwork);
  return (
    <TitleCard
      noBorder
      className={s.root}
      style={tint ? ({ "--hero-tint": tint } as CSSProperties) : undefined}
      right={right}>
      {children}
    </TitleCard>
  );
}
