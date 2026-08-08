/* eslint-disable no-magic-numbers -- chart geometry reads best inline */
/* eslint-disable react/no-array-index-key -- static, non-reordered PDF marks */
import type { ReactNode } from 'react';

import {
  Circle,
  G,
  Line,
  Path,
  Rect,
  StyleSheet,
  Svg,
  Text as SvgText,
  Text,
  View,
} from '@react-pdf/renderer';

import { chartPalette, reportTheme } from './theme';
import { niceAxisMax, stripEmoji, toArray, toChartSeries } from './utils';

import type { BarChartProps, LineChartProps, PieChartProps } from '../catalog';
import type { RenderProps } from './types';

const styles = StyleSheet.create({
  wrapper: { marginTop: 6 },
  title: { fontSize: 10, fontWeight: 'bold', color: reportTheme.text, marginBottom: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 2 },
  legendSwatch: { width: 8, height: 8, marginRight: 4 },
  legendLabel: { fontSize: 8, color: reportTheme.textSubtle },
  empty: { fontSize: 9, color: reportTheme.textMuted, paddingVertical: 6 },
});

const DEFAULT_MAX_ITEMS = 12;

const buildSeries = (props: BarChartProps) => {
  const series = toChartSeries(toArray(props.data), {
    xKey: props.xKey ?? undefined,
    yKey: props.yKey ?? undefined,
    groupBy: props.groupBy ?? undefined,
    aggregation: props.aggregation ?? undefined,
  });
  const limit = props.maxItems ?? DEFAULT_MAX_ITEMS;
  return limit > 0 ? series.slice(0, limit) : series;
};

const ChartFrame = ({
  title,
  children,
  legend,
}: {
  title?: string | null;
  children: ReactNode;
  legend?: ReactNode;
}) => (
  <View style={styles.wrapper}>
    {title === undefined || title === null ? null : (
      <Text style={styles.title}>{stripEmoji(title)}</Text>
    )}
    {children}
    {legend}
  </View>
);

const GRID_LINES = 4;

// Small maxima (e.g. a count of 2) would otherwise produce duplicate rounded
// tick labels like 2,2,1,1,0 — so use one interval per unit until it exceeds
// the default grid density.
const axisDivisions = (maxValue: number): number => {
  if (maxValue <= 1) {
    return 1;
  }
  if (maxValue <= GRID_LINES) {
    return Math.ceil(maxValue);
  }
  return GRID_LINES;
};

// Roughly 4pt per character at the 7pt label size; keeps adjacent device names
// distinguishable instead of clipping them all to the same prefix.
const truncateLabel = (label: string, slotWidth: number): string => {
  const clean = stripEmoji(label);
  const maxChars = Math.max(6, Math.floor(slotWidth / 4));
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
};

const formatTick = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const PLOT_PAD_LEFT = 38;
const PLOT_PAD_BOTTOM = 26;
const PLOT_PAD_TOP = 8;
const PLOT_PAD_RIGHT = 8;

/** Vertical bar chart drawn with react-pdf SVG primitives (vector, no rasterizing). */
export const BarChart = ({ props }: RenderProps<BarChartProps>) => {
  const series = buildSeries(props);
  const width = props.width ?? 500;
  const height = props.height ?? 200;

  if (series.length === 0) {
    return <Text style={styles.empty}>No chart data for this period.</Text>;
  }

  const plotWidth = width - PLOT_PAD_LEFT - PLOT_PAD_RIGHT;
  const plotHeight = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
  const maxValue = niceAxisMax(Math.max(...series.map((point) => point.value), 0));
  const divisions = axisDivisions(maxValue);
  const slot = plotWidth / series.length;
  const barWidth = Math.max(Math.min(slot * 0.62, 46), 2);
  const baseColor = props.color ?? chartPalette[0];

  return (
    <ChartFrame title={props.title}>
      <Svg height={height} width={width}>
        {(props.showGrid ?? true)
          ? Array.from({ length: divisions + 1 }, (unused, index) => {
              const y = PLOT_PAD_TOP + (plotHeight / divisions) * index;
              const value = maxValue - (maxValue / divisions) * index;
              return (
                <G key={`grid-${index}`}>
                  <Line
                    stroke={reportTheme.borderSubtle}
                    strokeWidth={0.5}
                    x1={PLOT_PAD_LEFT}
                    x2={PLOT_PAD_LEFT + plotWidth}
                    y1={y}
                    y2={y}
                  />
                  <SvgText
                    fill={reportTheme.textMuted}
                    style={{ fontSize: 7 }}
                    textAnchor="end"
                    x={PLOT_PAD_LEFT - 4}
                    y={y + 2}
                  >
                    {formatTick(value)}
                  </SvgText>
                </G>
              );
            })
          : null}

        {series.map((point, index) => {
          const barHeight = maxValue === 0 ? 0 : (point.value / maxValue) * plotHeight;
          const x = PLOT_PAD_LEFT + slot * index + (slot - barWidth) / 2;
          const y = PLOT_PAD_TOP + plotHeight - barHeight;
          return (
            <G key={`bar-${index}`}>
              <Rect fill={baseColor} height={barHeight} width={barWidth} x={x} y={y} />
              {(props.showValues ?? false) ? (
                <SvgText
                  fill={reportTheme.textSubtle}
                  style={{ fontSize: 7 }}
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y={y - 3}
                >
                  {String(point.value)}
                </SvgText>
              ) : null}
              <SvgText
                fill={reportTheme.textMuted}
                style={{ fontSize: 7 }}
                textAnchor="middle"
                x={PLOT_PAD_LEFT + slot * index + slot / 2}
                y={height - PLOT_PAD_BOTTOM + 12}
              >
                {truncateLabel(point.label, slot)}
              </SvgText>
            </G>
          );
        })}

        <Line
          stroke={reportTheme.border}
          strokeWidth={0.75}
          x1={PLOT_PAD_LEFT}
          x2={PLOT_PAD_LEFT + plotWidth}
          y1={PLOT_PAD_TOP + plotHeight}
          y2={PLOT_PAD_TOP + plotHeight}
        />
      </Svg>
    </ChartFrame>
  );
};

/** Line chart with optional filled area, drawn as an SVG polyline path. */
export const LineChart = ({ props }: RenderProps<LineChartProps>) => {
  const series = buildSeries(props);
  const width = props.width ?? 500;
  const height = props.height ?? 200;

  if (series.length === 0) {
    return <Text style={styles.empty}>No chart data for this period.</Text>;
  }

  const plotWidth = width - PLOT_PAD_LEFT - PLOT_PAD_RIGHT;
  const plotHeight = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
  const maxValue = niceAxisMax(Math.max(...series.map((point) => point.value), 0));
  const divisions = axisDivisions(maxValue);
  const stepX = series.length <= 1 ? 0 : plotWidth / (series.length - 1);
  const color = props.color ?? chartPalette[0];

  const points = series.map((point, index) => ({
    x: PLOT_PAD_LEFT + stepX * index,
    y: PLOT_PAD_TOP + plotHeight - (maxValue === 0 ? 0 : (point.value / maxValue) * plotHeight),
    label: point.label,
  }));

  // Label roughly 8 points regardless of series length, to avoid overlap.
  const labelEvery = Math.max(Math.ceil(points.length / 8), 1);

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1]?.x ?? PLOT_PAD_LEFT} ${PLOT_PAD_TOP + plotHeight} L${PLOT_PAD_LEFT} ${PLOT_PAD_TOP + plotHeight} Z`;

  return (
    <ChartFrame title={props.title}>
      <Svg height={height} width={width}>
        {(props.showGrid ?? true)
          ? Array.from({ length: divisions + 1 }, (unused, index) => {
              const y = PLOT_PAD_TOP + (plotHeight / divisions) * index;
              return (
                <G key={`grid-${index}`}>
                  <Line
                    stroke={reportTheme.borderSubtle}
                    strokeWidth={0.5}
                    x1={PLOT_PAD_LEFT}
                    x2={PLOT_PAD_LEFT + plotWidth}
                    y1={y}
                    y2={y}
                  />
                  <SvgText
                    fill={reportTheme.textMuted}
                    style={{ fontSize: 7 }}
                    textAnchor="end"
                    x={PLOT_PAD_LEFT - 4}
                    y={y + 2}
                  >
                    {formatTick(maxValue - (maxValue / divisions) * index)}
                  </SvgText>
                </G>
              );
            })
          : null}

        {(props.area ?? false) ? <Path d={areaPath} fill={color} fillOpacity={0.15} /> : null}
        <Path d={linePath} fill="none" stroke={color} strokeWidth={1.5} />

        {points.map((point, index) => (
          <G key={`point-${index}`}>
            <Circle cx={point.x} cy={point.y} fill={color} r={1.8} />
            {index % labelEvery === 0 ? (
              <SvgText
                fill={reportTheme.textMuted}
                style={{ fontSize: 7 }}
                textAnchor="middle"
                x={point.x}
                y={height - PLOT_PAD_BOTTOM + 12}
              >
                {truncateLabel(point.label, stepX * labelEvery)}
              </SvgText>
            ) : null}
          </G>
        ))}

        <Line
          stroke={reportTheme.border}
          strokeWidth={0.75}
          x1={PLOT_PAD_LEFT}
          x2={PLOT_PAD_LEFT + plotWidth}
          y1={PLOT_PAD_TOP + plotHeight}
          y2={PLOT_PAD_TOP + plotHeight}
        />
      </Svg>
    </ChartFrame>
  );
};

const polarPoint = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

/** Pie / donut chart. Set `innerRadius` above 0 for a donut. */
export const PieChart = ({ props }: RenderProps<PieChartProps>) => {
  const series = buildSeries(props);
  const width = props.width ?? 320;
  const height = props.height ?? 200;

  const total = series.reduce((sum, point) => sum + point.value, 0);
  if (series.length === 0 || total <= 0) {
    return <Text style={styles.empty}>No chart data for this period.</Text>;
  }

  const cx = height / 2 + 4;
  const cy = height / 2;
  const radius = Math.min(height, width) / 2 - 10;
  const innerRadius = props.innerRadius ?? 0;

  // Cumulative start angle per slice, precomputed so the map stays pure.
  const startAngles = series.reduce<number[]>((acc, point, index) => {
    const previous = index === 0 ? -Math.PI / 2 : (acc[index - 1] ?? 0);
    const previousSweep = index === 0 ? 0 : ((series[index - 1]?.value ?? 0) / total) * Math.PI * 2;
    acc.push(previous + previousSweep);
    return acc;
  }, []);

  const slices = series.map((point, index) => {
    const sweep = (point.value / total) * Math.PI * 2;
    const start = startAngles[index] ?? -Math.PI / 2;
    const end = start + sweep;

    const outerStart = polarPoint(cx, cy, radius, start);
    const outerEnd = polarPoint(cx, cy, radius, end);
    const largeArc = sweep > Math.PI ? 1 : 0;

    const path =
      innerRadius > 0
        ? [
            `M${outerStart.x} ${outerStart.y}`,
            `A${radius} ${radius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
            `L${polarPoint(cx, cy, innerRadius, end).x} ${polarPoint(cx, cy, innerRadius, end).y}`,
            `A${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${polarPoint(cx, cy, innerRadius, start).x} ${polarPoint(cx, cy, innerRadius, start).y}`,
            'Z',
          ].join(' ')
        : [
            `M${cx} ${cy}`,
            `L${outerStart.x} ${outerStart.y}`,
            `A${radius} ${radius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
            'Z',
          ].join(' ');

    return {
      path,
      color: chartPalette[index % chartPalette.length] ?? chartPalette[0],
      label: point.label,
      value: point.value,
    };
  });

  return (
    <ChartFrame
      legend={
        (props.showLegend ?? true) ? (
          <View style={styles.legend}>
            {slices.map((slice, index) => (
              <View key={`legend-${index}`} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: slice.color }]} />
                <Text style={styles.legendLabel}>
                  {`${stripEmoji(slice.label)} (${slice.value})`}
                </Text>
              </View>
            ))}
          </View>
        ) : null
      }
      title={props.title}
    >
      <Svg height={height} width={width}>
        {slices.map((slice, index) => (
          <Path key={`slice-${index}`} d={slice.path} fill={slice.color} />
        ))}
      </Svg>
    </ChartFrame>
  );
};
