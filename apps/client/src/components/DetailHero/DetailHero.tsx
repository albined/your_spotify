import { CSSProperties, ReactNode } from "react";

import { useArtworkTint } from "../../services/artworkTint";
import ShareButton from "../Header/ShareButton";

import s from "./index.module.css";

interface DetailHeroProps {
  kind: "Artist" | "Album" | "Song";
  image?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

// Opens an artist, album or song page: its artwork, tinted like the best
// cards that lead here, with its place in the ranking beneath.
export default function DetailHero({
  kind,
  image,
  title,
  subtitle,
  actions,
  children,
}: DetailHeroProps) {
  const tint = useArtworkTint(image);
  return (
    <div className={s.wrapper}>
      <div
        className={s.root}
        style={tint ? ({ "--hero-tint": tint } as CSSProperties) : undefined}>
        <div className={s.main}>
          {image && <img className={s.cover} src={image} alt="" />}
          <div className={s.texts}>
            <span className={s.kind}>{kind}</span>
            <h1 className={s.title} title={title}>
              {title}
            </h1>
            {subtitle && <div className={s.subtitle}>{subtitle}</div>}
          </div>
          <div className={s.actions}>
            {actions}
            <ShareButton />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
