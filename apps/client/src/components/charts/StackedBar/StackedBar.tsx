import React from "react";
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

import { getColor } from "../../../services/colors";

export interface StackedBarProps {
  data: ({ x: number | string } & { [o: string]: number })[];
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
}: StackedBarProps) {
  const allKeys = data.reduce<Set<string>>((acc, curr) => {
    Object.keys(curr)
      .filter((key) => key !== "x")
      .forEach((key) => acc.add(key));
    return acc;
  }, new Set());

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
          tickFormatter={yFormat}
          width="auto"
        />
        {Array.from(allKeys).map((k, index) => (
          <RBar
            key={k}
            stackId="only"
            dataKey={k}
            fill={getColor(index)}
            isAnimationActive={false}
          />
        ))}
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
