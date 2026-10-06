import clsx from "clsx";

import { ITooltip } from "../iTooltip/iTooltip";
import Text from "../Text";

import s from "./index.module.css";

interface TitleCardProps {
  className?: string;
  style?: React.CSSProperties;
  contentClassName?: string;
  title?: string;
  children: React.ReactNode;
  fade?: boolean;
  right?: React.ReactNode;
  noPadding?: boolean;
  noBorder?: boolean;
  info?: string;
}

export default function TitleCard({
  className,
  style,
  contentClassName,
  title,
  children,
  fade,
  right,
  noPadding,
  noBorder,
  info,
}: TitleCardProps) {
  return (
    <div
      style={style}
      className={clsx(s.root, className, { [s.noborder]: noBorder })}>
      <div className={clsx(s.container, { [s.nopadding]: noPadding })}>
        {(title || info || right) && (
          <div className={s.title}>
            <div className={s.left}>
              {title && (
                <Text element="h3" size="normal">
                  {title}
                </Text>
              )}
              <ITooltip content={info} />
            </div>
            <div>{right}</div>
          </div>
        )}
        <div className={clsx(s.content, { fade }, contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
