import { IosShare } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import { CopyToClipboard } from "react-copy-to-clipboard";

import { useIsGuest, useSharePage } from "../../services/hooks/hooks";
import { useSider } from "../Layout/useSider";

import s from "./index.module.css";

// Phones have no sidebar to share the page from.
export default function ShareButton() {
  const { siderAllowed, siderIsDrawer } = useSider();
  const isGuest = useIsGuest();
  const { toCopy, onCopy } = useSharePage();

  if (!siderAllowed || !siderIsDrawer || isGuest || !toCopy) return null;
  return (
    <CopyToClipboard onCopy={onCopy} text={toCopy}>
      <IconButton aria-label="Share this page" className={s.share}>
        <IosShare fontSize="small" />
      </IconButton>
    </CopyToClipboard>
  );
}
