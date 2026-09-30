"use client";

import Link from "next/link";
import { Tabs } from "@base-ui/react/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type UsagePoint = {
  date: string;
  requests: number;
  errors: number;
  tokens: number;
  latency: number | null;
};

const METRICS = [
  { key: "requests", label: "请求量", unit: "次" },
  { key: "tokens", label: "Token", unit: "个" },
  { key: "latency", label: "P95 延迟", unit: "ms" },
] as const;

function number(value: number | null) {
  return value === null ? "—" : value.toLocaleString("zh-CN");
}

export function UsageChart({
  rows,
  projectId,
  completeRange,
}: {
  rows: UsagePoint[];
  projectId?: string;
  completeRange: boolean;
}) {
  return (
    <Card className="tf-panel tf-trend-panel">
      <Tabs.Root defaultValue="requests">
        <CardHeader className="tf-panel-head">
          <div>
            <CardTitle>用量趋势</CardTitle>
            <CardDescription>按日汇总 · 上海时区</CardDescription>
          </div>
          <Tabs.List
            className="tf-chart-tabs"
            aria-label="趋势指标"
            activateOnFocus
          >
            {METRICS.map((metric) => (
              <Tabs.Tab key={metric.key} value={metric.key}>
                {metric.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </CardHeader>
        {METRICS.map((metric) => {
          const max = Math.max(1, ...rows.map((row) => row[metric.key] ?? 0));
          return (
            <Tabs.Panel
              key={metric.key}
              value={metric.key}
              className="tf-usage-chart"
            >
              <div className="tf-chart-meta">
                <span>单位：{metric.unit}</span>
                <div className="tf-chart-legend">
                  <span>{metric.label}</span>
                  {metric.key === "requests" ? <span>其中失败</span> : null}
                </div>
              </div>
              {rows.length === 0 ? (
                <div className="tf-chart-empty">所选范围暂无趋势数据</div>
              ) : (
                <div className="tf-chart-plot">
                  <div className="tf-chart-scale" aria-hidden="true">
                    <span>{number(max)}</span>
                    <span>{number(Math.floor(max / 2))}</span>
                    <span>0</span>
                  </div>
                  <div
                    className="tf-chart-bars"
                    style={{
                      gridTemplateColumns:
                        "repeat(" + rows.length + ", minmax(0, 1fr))",
                      minWidth: rows.length > 31 ? rows.length * 20 : undefined,
                    }}
                  >
                    {rows.map((row, index) => {
                      const value = row[metric.key];
                      const query = new URLSearchParams({
                        from: row.date,
                        to: row.date,
                      });
                      if (projectId) query.set("projectId", projectId);
                      const description =
                        row.date +
                        " · " +
                        metric.label +
                        " " +
                        number(value) +
                        (value === null ? "" : " " + metric.unit) +
                        (metric.key === "requests"
                          ? " · 失败 " + number(row.errors) + " 次"
                          : "");
                      const showLabel =
                        rows.length <= 8 ||
                        index === rows.length - 1 ||
                        index % Math.ceil(rows.length / 7) === 0;
                      return (
                        <Tooltip key={row.date}>
                          <TooltipTrigger
                            render={
                              <Link href={"/traces?" + query.toString()} />
                            }
                            className="tf-chart-column"
                            aria-label={description + "，查看当日追踪"}
                          >
                            <span className="tf-chart-track">
                              <span
                                className={
                                  value === null
                                    ? "tf-chart-missing"
                                    : undefined
                                }
                                style={{
                                  height:
                                    value === null
                                      ? "0%"
                                      : (value / max) * 100 + "%",
                                }}
                              />
                              {metric.key === "requests" ? (
                                <span
                                  className="tf-chart-errors"
                                  style={{
                                    height: (row.errors / max) * 100 + "%",
                                  }}
                                />
                              ) : null}
                            </span>
                            <small aria-hidden="true">
                              {showLabel ? row.date.slice(5) : ""}
                            </small>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {description}
                            <br />
                            点击查看当日追踪
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="tf-chart-summary">
                <span>悬停查看数值，点击日期下钻追踪</span>
                <span>
                  {metric.key === "latency"
                    ? "无延迟样本显示 —"
                    : completeRange
                      ? "无请求日期按 0 展示"
                      : "长区间仅展示有请求的日期"}
                </span>
              </div>
            </Tabs.Panel>
          );
        })}
      </Tabs.Root>
    </Card>
  );
}
