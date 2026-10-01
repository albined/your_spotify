import {
  BarChart,
  XAxis,
  Bar as RBar,
  Tooltip,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ContentType } from "recharts/types/component/Tooltip";

interface BarProps {
  data: { x: number | string; y: number }[];
  customXTick?: React.ComponentProps<typeof XAxis>["tick"];
  xFormat?: React.ComponentProps<typeof XAxis>["tickFormatter"];
  yFormat?: React.ComponentProps<typeof YAxis>["tickFormatter"];
  customTooltip?: ContentType<any, any>;
}

export default function Bar({
  data,
  xFormat,
  yFormat,
  customXTick,
  customTooltip,
}: BarProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid
          vertical={false}
          stroke="var(--chart-grid)"
          strokeDasharray="3 5"
        />
        <XAxis
          dataKey="x"
          tickFormatter={xFormat}
          tick={customXTick}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          dataKey="y"
          tickFormatter={yFormat}
          width="auto"
        />
        <RBar
          dataKey="y"
          fill="var(--accent-green)"
          fillOpacity={0.85}
          radius={[3, 3, 0, 0]}
        />
        <Tooltip
          wrapperStyle={{ zIndex: 10 }}
          contentStyle={{ backgroundColor: "var(--surface-raised)" }}
          labelStyle={{ color: "var(--text-on-light)" }}
          content={customTooltip}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
