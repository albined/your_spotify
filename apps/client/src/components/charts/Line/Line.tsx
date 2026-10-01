import {
  LineChart,
  Line as RLine,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { ContentType } from "recharts/types/component/Tooltip";

import { DateWithPrecision } from "../../../services/stats";

interface LineProps<
  D extends { x: number; y: number; dateWithPrecision: DateWithPrecision },
> {
  data: D[];
  xFormat?: React.ComponentProps<typeof XAxis>["tickFormatter"];
  yFormat?: React.ComponentProps<typeof YAxis>["tickFormatter"];
  customTooltip?: ContentType<any, any>;
}

export default function Line<
  D extends { x: number; y: number; dateWithPrecision: DateWithPrecision },
>({ data, xFormat, yFormat, customTooltip }: LineProps<D>) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <RLine
          connectNulls
          type="monotone"
          dataKey="y"
          fill="var(--accent-green)"
          stroke="var(--accent-green)"
          strokeWidth={2}
          dot={false}
        />
        <CartesianGrid
          vertical={false}
          stroke="var(--chart-grid)"
          strokeDasharray="3 5"
        />
        <XAxis
          name="X"
          domain={["dataMin", "dataMax"]}
          dataKey="x"
          tickFormatter={xFormat}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          domain={["dataMin", "dataMax"]}
          tickFormatter={yFormat}
          width="auto"
        />
        <Tooltip
          wrapperStyle={{ zIndex: 10 }}
          contentStyle={{ backgroundColor: "var(--surface-raised)" }}
          labelStyle={{ color: "var(--text-on-light)" }}
          content={customTooltip}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
