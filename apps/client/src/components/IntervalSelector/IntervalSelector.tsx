import { CalendarMonthOutlined } from "@mui/icons-material";
import { Button, IconButton } from "@mui/material";
import { endOfDay, startOfDay } from "date-fns";
import { useEffect, useId, useRef, useState } from "react";

import { getAppropriateTimesplitFromRange } from "../../services/date";
import { IntervalDetail, selectorIntervals } from "../../services/intervals";
import Dialog from "../Dialog";
import RangePicker from "./RangePicker";
import { Range } from "./RangePicker/RangePicker";

import s from "./index.module.css";

interface IntervalSelectorProps {
  value: IntervalDetail;
  onChange: (newDetails: IntervalDetail) => void;
}

export function IntervalSelector({ value, onChange }: IntervalSelectorProps) {
  const groupName = useId();
  const options = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [customIntervalDate, setCustomIntervalDate] = useState<Range>([
    undefined,
    undefined,
  ]);

  const existingInterval = selectorIntervals.findIndex(
    (inter) => inter.type === value.type && inter.name === value.name,
  );

  // Bring the selected period into view when the row is scrolled sideways.
  useEffect(() => {
    const row = options.current;
    const selected =
      row?.querySelector<HTMLElement>("input:checked")?.parentElement;
    if (!row || !selected) return;
    row.scrollLeft =
      selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2;
  }, [existingInterval]);

  const internOnChange = (index: number) => {
    const interval = selectorIntervals[index];
    if (!interval) {
      return;
    }
    onChange(interval);
  };

  const content = (
    <div className={s.segmented}>
      <div
        ref={options}
        className={s.options}
        role="radiogroup"
        aria-label="Listening period">
        {selectorIntervals.map((inter, index) => (
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
    </div>
  );

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
