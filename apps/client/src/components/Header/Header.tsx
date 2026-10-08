import clsx from "clsx";
import React, { ReactNode } from "react";
import { useSelector } from "react-redux";

import { IntervalDetail } from "../../services/intervals";
import { setDataInterval } from "../../services/redux/modules/user/reducer";
import { selectIntervalDetail } from "../../services/redux/modules/user/selector";
import { intervalDetailToRedux } from "../../services/redux/modules/user/utils";
import { useAppDispatch } from "../../services/redux/tools";
import { IntervalSelector } from "../IntervalSelector";
import { useSider } from "../Layout/useSider";
import Text from "../Text";
import ShareButton from "./ShareButton";

import s from "./index.module.css";

interface HeaderProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  title: React.ReactNode;
  tinyTitle?: string;
  // Shown in place of the title on phones, where the title stays for readers.
  phoneTitle?: React.ReactNode;
  subtitle?: ReactNode;
  hideInterval?: boolean;
  hideShare?: boolean;
}

export default function Header({
  left,
  right,
  title,
  tinyTitle,
  phoneTitle,
  subtitle,
  hideInterval,
  hideShare,
}: HeaderProps) {
  const dispatch = useAppDispatch();
  const intervalDetail = useSelector(selectIntervalDetail);
  const { siderIsDrawer } = useSider();
  const replaced = siderIsDrawer && !!phoneTitle;

  const changeInterval = (newInterval: IntervalDetail) => {
    dispatch(setDataInterval(intervalDetailToRedux(newInterval)));
  };

  return (
    <div className={s.root}>
      <div className={clsx(s.left, { [s.replaced]: replaced })}>
        {left}
        {replaced && phoneTitle}
        <div className={clsx(s.texts, { [s.hidden]: replaced })}>
          <Text element="h1" size="pagetitle">
            {siderIsDrawer && tinyTitle ? tinyTitle : title}
          </Text>
          {!siderIsDrawer && subtitle && <Text size="small">{subtitle}</Text>}
        </div>
      </div>
      {right}
      {!hideShare && <ShareButton />}
      {!hideInterval && (
        <div className={s.interval}>
          <IntervalSelector value={intervalDetail} onChange={changeInterval} />
        </div>
      )}
    </div>
  );
}
