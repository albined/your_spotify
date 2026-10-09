import clsx from "clsx";
import React from "react";
import { useSelector } from "react-redux";

import { usePageTransitions } from "../../services/pageTransition";
import {
  selectPublicToken,
  selectUser,
} from "../../services/redux/modules/user/selector";
import Text from "../Text";
import BottomNav from "./BottomNav";
import ScrollTop from "./ScrollTop";
import Sider from "./Sider";
import { useSider } from "./useSider";

import s from "./index.module.css";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { siderAllowed, siderIsDrawer } = useSider();
  usePageTransitions();

  const publicToken = useSelector(selectPublicToken);
  const user = useSelector(selectUser);
  const bottomNav = siderAllowed && siderIsDrawer && !!user;

  return (
    <div className={s.root}>
      <section className={s.sider}>
        {siderAllowed && !siderIsDrawer && <Sider />}
      </section>
      <section
        className={clsx({
          [s.content]: true,
          [s.contentdrawer]: siderAllowed && !siderIsDrawer,
          [s.contentbottomnav]: bottomNav,
        })}>
        {publicToken && (
          <div className={s.publictoken}>
            <Text size="normal">You are viewing as guest</Text>
          </div>
        )}
        {children}
      </section>
      <ScrollTop
        besideSider={siderAllowed && !siderIsDrawer}
        aboveBottomNav={bottomNav}
      />
      {bottomNav && <BottomNav />}
    </div>
  );
}
