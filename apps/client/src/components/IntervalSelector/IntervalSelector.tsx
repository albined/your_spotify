import { CalendarMonthOutlined } from "@mui/icons-material";
import {
  SelectProps,
  Button,
  IconButton,
  MenuItem,
  Select,
  useMediaQuery,
} from "@mui/material";
import { endOfDay, startOfDay } from "date-fns";
import React, { useId, useState } from "react";

import { getAppropriateTimesplitFromRange } from "../../services/date";
import {
  allIntervals,
  getAllIndexFromIntervalDetail,
  IntervalDetail,
} from "../../services/intervals";
import Dialog from "../Dialog";
import RangePicker from "./RangePicker";
import { Range } from "./RangePicker/RangePicker";

import s from "./index.module.css";

interface IntervalSelectorProps {
  value: IntervalDetail;
  onChange: (newDetails: IntervalDetail) => void;
  selectType?: SelectProps["variant"];
  forceTiny?: boolean;
}

export function IntervalSelector({
  value,
  onChange,
  selectType,
  forceTiny,
}: IntervalSelectorProps) {
  const upmd = useMediaQuery("(min-width: 1200px)") && !forceTiny;
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const [customIntervalDate, setCustomIntervalDate] = useState<Range>([
    undefined,
    undefined,
  ]);

  const existingInterval = getAllIndexFromIntervalDetail(value);

  const internOnChange = (index: number) => {
    if (index === -1) {
      setOpen(true);
    } else {
      const interval = allIntervals[index];
      if (!interval) {
        return;
      }
      onChange(interval);
    }
  };

  let content: React.ReactNode;

  if (!upmd) {
    content = (
      <Select
        variant={selectType ?? "outlined"}
        size="small"
        className={s.compact}
        inputProps={{ "aria-label": "Listening period" }}
        value={existingInterval}
        onChange={(ev) => internOnChange(ev.target.value as number)}>
        {allIntervals.map((inter, index) => (
          <MenuItem key={inter.name} value={index}>
            {inter.name}
          </MenuItem>
        ))}
        <MenuItem value={-1} onClick={() => setOpen(true)}>
          Custom
        </MenuItem>
      </Select>
    );
  } else {
    content = (
      <div className={s.segmented}>
        <div
          className={s.options}
          role="radiogroup"
          aria-label="Listening period">
          {allIntervals.map((inter, index) => (
            <label key={inter.name} className={s.segment}>
              <input
                type="radio"
                name={groupName}
                value={index}
                checked={existingInterval === index}
                onChange={() => internOnChange(index)}
              />
              <span>{inter.name}</span>
            </label>
          ))}
        </div>
        <IconButton
          size="small"
          aria-label="Custom date range"
          aria-haspopup="dialog"
          aria-pressed={existingInterval === -1}
          className={s.custom}
          onClick={() => setOpen(true)}>
          <CalendarMonthOutlined fontSize="small" />
        </IconButton>
      </div>
    );
  }

  const goodRange = Boolean(customIntervalDate[0] && customIntervalDate[1]);

  const setCustom = () => {
    const [start, end] = customIntervalDate;
    if (!start || !end) {
      return;
    }
    onChange({
      type: "custom",
      name: "custom",
      interval: {
        start: startOfDay(start),
        end: endOfDay(end),
        timesplit: getAppropriateTimesplitFromRange(start, end),
      },
    });
    setOpen(false);
  };

  return (
    <>
      {content}
      <Dialog
        title="Custom date range"
        open={open}
        onClose={() => setOpen(false)}>
        <div className={s.dialogcontent}>
          <RangePicker
            value={customIntervalDate}
            onChange={setCustomIntervalDate}
          />
          <Button variant="contained" onClick={setCustom} disabled={!goodRange}>
            Apply
          </Button>
        </div>
      </Dialog>
    </>
  );
}
