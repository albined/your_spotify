import { Button, Stack, TextField, useTheme } from "@mui/material";
import { useState } from "react";
import { useSelector } from "react-redux";

import Text from "../../components/Text";
import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import { selectUser } from "../../services/redux/modules/user/selector";
import { checkLogged } from "../../services/redux/modules/user/thunk";
import { useAppDispatch } from "../../services/redux/tools";

export default function AllTimeStartDate() {
  const theme = useTheme();
  const user = useSelector(selectUser);
  const dispatch = useAppDispatch();
  const saved = user?.settings.allTimeStartDate ?? "";
  const [date, setDate] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: user?.statisticsTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const save = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.setSetting("allTimeStartDate", next || null);
      const refreshed = await dispatch(checkLogged()).unwrap();
      if (!refreshed) throw new Error("Could not refresh account");
      setDate(refreshed.settings.allTimeStartDate ?? "");
    } catch {
      setError("Could not save the start date. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TitleCard title="All-time start date">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          void save(date);
        }}>
        <Text size="normal">
          Applies whenever you select All. Earlier listening history is kept.
        </Text>
        <TextField
          label="Start date"
          type="date"
          size="small"
          value={date}
          disabled={saving}
          onChange={(event) => {
            setDate(event.target.value);
            setError(null);
          }}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: {
              min: "1900-01-01",
              max: today,
              style: { colorScheme: theme.palette.mode },
            },
          }}
          error={Boolean(error) || date > today}
          helperText={date > today ? "Choose today or an earlier date." : error}
        />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            type="submit"
            variant="contained"
            disabled={saving || date === saved || date > today}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            disabled={saving || (!date && !saved)}
            onClick={() => void save("")}>
            Use full history
          </Button>
        </Stack>
      </Stack>
    </TitleCard>
  );
}
