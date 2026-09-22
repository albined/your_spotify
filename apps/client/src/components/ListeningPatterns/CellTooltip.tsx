import { Tooltip } from "@mui/material";
import { ReactNode, useEffect, useState } from "react";

// One tooltip per grid, rather than mounting one for every square. Cells keep
// their own accessible labels and keyboard navigation.
export default function CellTooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{
    element: HTMLButtonElement;
    label: string;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    const label = active.element.isConnected
      ? active.element.getAttribute("aria-label")
      : null;
    if (!label) setActive(null);
    else if (label !== active.label) setActive({ ...active, label });
  }, [active, children]);

  const selectCell = (target: EventTarget | null) => {
    const element =
      target instanceof Element
        ? target.closest<HTMLButtonElement>("button[data-cell]")
        : null;
    const label = element?.getAttribute("aria-label");
    setActive((previous) =>
      element && label
        ? previous?.element === element && previous.label === label
          ? previous
          : { element, label }
        : null,
    );
  };
  return (
    <Tooltip
      title={active?.label ?? ""}
      open={open && Boolean(active)}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      arrow
      describeChild
      enterTouchDelay={0}
      slotProps={{ popper: { anchorEl: active?.element } }}>
      <div
        onPointerOver={(event) => selectCell(event.target)}
        onPointerMove={(event) => selectCell(event.target)}
        onPointerDown={(event) => {
          selectCell(event.target);
          if (event.pointerType === "touch") setOpen(true);
        }}
        onFocusCapture={(event) => selectCell(event.target)}>
        {children}
      </div>
    </Tooltip>
  );
}
