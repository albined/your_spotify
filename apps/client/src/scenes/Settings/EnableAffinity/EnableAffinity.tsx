import { Button } from "@mui/material";

import Text from "../../../components/Text";
import TitleCard from "../../../components/TitleCard";
import { enableAffinity } from "../../../services/redux/modules/settings/thunk";
import { useAppDispatch } from "../../../services/redux/tools";
import { GlobalPreferences } from "../../../services/types";
import SettingLine from "../SettingLine";

interface EnableAffinityProps {
  settings: GlobalPreferences;
}

export default function EnableAffinity({ settings }: EnableAffinityProps) {
  const dispatch = useAppDispatch();

  const handleEnable = () => {
    if (!settings) {
      return;
    }
    dispatch(enableAffinity(!settings.allowAffinity)).catch(console.error);
  };

  return (
    <TitleCard title="Competition">
      <SettingLine
        left={<Text size="normal">Enable competition</Text>}
        right={
          <Button onClick={handleEnable}>
            {settings.allowAffinity ? "YES" : "NO"}
          </Button>
        }
      />
    </TitleCard>
  );
}
