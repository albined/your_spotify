import { FormControlLabel, Switch } from "@mui/material";
import { useState } from "react";
import { useSelector } from "react-redux";

import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import { selectUser } from "../../services/redux/modules/user/selector";
import { checkLogged } from "../../services/redux/modules/user/thunk";
import { useAppDispatch } from "../../services/redux/tools";

export default function CompetitionParticipation() {
  const user = useSelector(selectUser);
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async (checked: boolean) => {
    setSaving(true);
    setError(false);
    try {
      await api.setSetting("allowCompetitions", checked);
      const refreshed = await dispatch(checkLogged()).unwrap();
      if (!refreshed) throw new Error("Could not refresh account");
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <TitleCard title="Competition">
      <FormControlLabel
        label="Include me in competitions"
        control={
          <Switch
            checked={user?.settings.allowCompetitions !== false}
            disabled={saving}
            onChange={(_, checked) => void save(checked)}
          />
        }
      />
      {error && <p role="alert">Could not save. Please try again.</p>}
    </TitleCard>
  );
}
