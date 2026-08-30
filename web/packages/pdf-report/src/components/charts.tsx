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

import { useReportPalette } from './palette-context';
import { displayable } from './text';
import { reportTheme } from './theme';

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

const PAD_LEFT = 38;
const PAD_BOTTOM = 26;
const PAD_TOP = 8;
const PAD_RIGHT = 8;
const GRID_LINES = 4;

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
      <Text style={styles.title}>{displayable(title)}</Text>
    )}
    {children}
    {legend}
  </View>
);

const Empty = () => <Text style={styles.empty}>No chart data for this period.</Text>;

/** Chooses "nice" round axis ticks so charts don't show ragged max values. */
const niceAxisMax = (max: number): number => {
  if (max <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((entry) => normalized <= entry) ?? 10;
  return step * magnitude;
};

// Small maxima would otherwise produce duplicate rounded tick labels like
// 2,2,1,1,0 — so use one interval per unit until it exceeds the grid density.
const axisDivisions = (maxValue: number): number => {
  if (maxValue <= 1) {
    return 1;
  }
  return maxValue <= GRID_LINES ? Math.ceil(maxValue) : GRID_LINES;
};

// Roughly 4pt per character at the 7pt label size; keeps adjacent labels
// distinguishable instead of clipping them all to the same prefix.
const truncate = (raw: string, slotWidth: number): string => {
  const label = displayable(raw);
  const maxChars = Math.max(6, Math.floor(slotWidth / 4));
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1)}…`;
};

const formatTick = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const Grid = ({
  divisions,
  maxValue,
  plotWidth,
  plotHeight,
  minValue = 0,
}: {
  divisions: number;
  maxValue: number;
  plotWidth: number;
  plotHeight: number;
  /** Bottom of the domain; below zero when a series contains negatives. */
  minValue?: number;
}) => (
  <>
    {Array.from({ length: divisions + 1 }, (unused, index) => {
      const y = PAD_TOP + (plotHeight / divisions) * index;
      return (
        <G key={`grid-${index}`}>
          <Line
            stroke={reportTheme.borderSubtle}
            strokeWidth={0.5}
            x1={PAD_LEFT}
            x2={PAD_LEFT + plotWidth}
            y1={y}
            y2={y}
          />
          <SvgText
            fill={reportTheme.textMuted}
            style={{ fontSize: 7 }}
            textAnchor="end"
            x={PAD_LEFT - 4}
            y={y + 2}
          >
            {formatTick(maxValue - ((maxValue - minValue) / divisions) * index)}
          </SvgText>
        </G>
      );
    })}
  </>
);

const Baseline = ({
  plotWidth,
  plotHeight,
  y,
}: {
  plotWidth: number;
  plotHeight: number;
  /** Where zero falls; defaults to the bottom, which is where it is when every value is positive. */
  y?: number;
}) => (
  <Line
    stroke={reportTheme.border}
    strokeWidth={0.75}
    x1={PAD_LEFT}
    x2={PAD_LEFT + plotWidth}
    y1={y ?? PAD_TOP + plotHeight}
    y2={y ?? PAD_TOP + plotHeight}
  />
);

/** Vertical bar chart over pre-aggregated points, drawn as vector SVG. */
export const BarChart = ({ props }: RenderProps<BarChartProps>) => {
  const palette = useReportPalette();
  const { series } = props;
  if (series.length === 0) {
    return <Empty />;
  }

  const width = props.width ?? 500;
  const height = props.height ?? 200;
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  // A signed domain: the zero line sits wherever it falls between the extremes,
  // so a negative bar hangs below it instead of being drawn with a negative
  // height and having its label land on the category axis. An all-positive
  // series puts zero back on the baseline and renders exactly as before.
  const highest = Math.max(...series.map((point) => point.value), 0);
  const lowest = Math.min(...series.map((point) => point.value), 0);
  const above = niceAxisMax(highest);
  const below = niceAxisMax(Math.abs(lowest));
  const span = above + below;
  const zeroY = PAD_TOP + (span === 0 ? plotHeight : (above / span) * plotHeight);
  const unit = span === 0 ? 0 : plotHeight / span;
  const slot = plotWidth / series.length;
  const barWidth = Math.max(Math.min(slot * 0.62, 46), 2);
  const color = props.color ?? palette.chartPalette[0];

  return (
    <ChartFrame title={props.title}>
      <Svg height={height} width={width}>
        {(props.showGrid ?? true) ? (
          <Grid
            divisions={axisDivisions(span)}
            maxValue={above}
            minValue={-below}
            plotHeight={plotHeight}
            plotWidth={plotWidth}
          />
        ) : null}

        {series.map((point, index) => {
          const magnitude = Math.abs(point.value) * unit;
          const negative = point.value < 0;
          const x = PAD_LEFT + slot * index + (slot - barWidth) / 2;
          const y = negative ? zeroY : zeroY - magnitude;
          // Labels sit outside the bar on whichever side it grows.
          const labelY = negative ? y + magnitude + 8 : y - 3;
          return (
            <G key={`bar-${index}`}>
              <Rect fill={color} height={magnitude} width={barWidth} x={x} y={y} />
              {(props.showValues ?? false) ? (
                <SvgText
                  fill={reportTheme.textSubtle}
                  style={{ fontSize: 7 }}
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y={labelY}
                >
                  {String(point.value)}
                </SvgText>
              ) : null}
              <SvgText
                fill={reportTheme.textMuted}
                style={{ fontSize: 7 }}
                textAnchor="middle"
                x={PAD_LEFT + slot * index + slot / 2}
                y={height - PAD_BOTTOM + 12}
              >
                {truncate(point.label, slot)}
              </SvgText>
            </G>
          );
        })}

        <Baseline plotHeight={plotHeight} plotWidth={plotWidth} />
      </Svg>
    </ChartFrame>
  );
};

/** Line chart over pre-aggregated points, with an optional filled area. */
export const LineChart = ({ props }: RenderProps<LineChartProps>) => {
  const palette = useReportPalette();
  const { series } = props;
  if (series.length === 0) {
    return <Empty />;
  }

  const width = props.width ?? 500;
  const height = props.height ?? 200;
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const maxValue = niceAxisMax(Math.max(...series.map((point) => point.value), 0));
  const stepX = series.length <= 1 ? 0 : plotWidth / (series.length - 1);
  const color = props.color ?? palette.chartPalette[0];

  const points = series.map((point, index) => ({
    x: PAD_LEFT + stepX * index,
    y: PAD_TOP + plotHeight - (maxValue === 0 ? 0 : (point.value / maxValue) * plotHeight),
    label: point.label,
  }));

  // Label roughly 8 points regardless of series length, to avoid overlap.
  const labelEvery = Math.max(Math.ceil(points.length / 8), 1);
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ');

  return (
    <ChartFrame title={props.title}>
      <Svg height={height} width={width}>
        {(props.showGrid ?? true) ? (
          <Grid
            divisions={axisDivisions(maxValue)}
            maxValue={maxValue}
            plotHeight={plotHeight}
            plotWidth={plotWidth}
          />
        ) : null}

        {(props.area ?? false) ? (
          <Path
            d={`${linePath} L${points[points.length - 1]?.x ?? PAD_LEFT} ${PAD_TOP + plotHeight} L${PAD_LEFT} ${PAD_TOP + plotHeight} Z`}
            fill={color}
            fillOpacity={0.15}
          />
        ) : null}
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
                y={height - PAD_BOTTOM + 12}
              >
                {truncate(point.label, stepX * labelEvery)}
              </SvgText>
            ) : null}
          </G>
        ))}

        <Baseline plotHeight={plotHeight} plotWidth={plotWidth} />
      </Svg>
    </ChartFrame>
  );
};

const polarPoint = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

/** Pie / donut chart over pre-aggregated points. */
export const PieChart = ({ props }: RenderProps<PieChartProps>) => {
  const palette = useReportPalette();
  const { series } = props;
  const total = series.reduce((sum, point) => sum + point.value, 0);
  if (series.length === 0 || total <= 0) {
    return <Empty />;
  }

  const width = props.width ?? 320;
  const height = props.height ?? 200;
  const cx = height / 2 + 4;
  const cy = height / 2;
  const radius = Math.min(height, width) / 2 - 10;
  const innerRadius = props.innerRadius ?? 0;

  // Cumulative start angle per slice, precomputed so the map stays pure.
  const startAngles = series.reduce<number[]>((angles, point, index) => {
    const previous = index === 0 ? -Math.PI / 2 : (angles[index - 1] ?? 0);
    const sweep = index === 0 ? 0 : ((series[index - 1]?.value ?? 0) / total) * Math.PI * 2;
    angles.push(previous + sweep);
    return angles;
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
      color: palette.chartPalette[index % palette.chartPalette.length] ?? palette.chartPalette[0],
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
                <Text
                  style={styles.legendLabel}
                >{`${displayable(slice.label)} (${slice.value})`}</Text>
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
