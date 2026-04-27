import Papa from "papaparse";
import type { CovidDataset, DailyTotals, MetricKey, RankingRow, StateSeries, StateSeriesPoint } from "../types";
import { getDatesBetween } from "./date";

const DATE_COLUMN_PATTERN = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/;
const STATE_COLUMN_CANDIDATES = [
  "State/UnionTerritory",
  "Province/State",
  "State",
  "Region",
  "Name",
];

const DATASET_SOURCES = {
  confirmed: [
    "https://raw.githubusercontent.com/kalyaniuniversity/COVID-19-Datasets/master/India%20Statewise%20Confirmed%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_CONFIRMED.csv",
    "https://cdn.jsdelivr.net/gh/kalyaniuniversity/COVID-19-Datasets@master/India%20Statewise%20Confirmed%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_CONFIRMED.csv",
  ],
  deaths: [
    "https://raw.githubusercontent.com/kalyaniuniversity/COVID-19-Datasets/master/India%20Statewise%20Death%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_DEATH.csv",
    "https://cdn.jsdelivr.net/gh/kalyaniuniversity/COVID-19-Datasets@master/India%20Statewise%20Death%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_DEATH.csv",
  ],
  recovered: [
    "https://raw.githubusercontent.com/kalyaniuniversity/COVID-19-Datasets/master/India%20Statewise%20Recovery%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_RECOVERY.csv",
    "https://cdn.jsdelivr.net/gh/kalyaniuniversity/COVID-19-Datasets@master/India%20Statewise%20Recovery%20Cases/COVID19_INDIA_STATEWISE_TIME_SERIES_RECOVERY.csv",
  ],
} as const;

const cleanStateName = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const EXCLUDED_STATE_ROWS = new Set(["Total", "India", "State Unassigned", "Unknown"]);

const parseDateColumn = (raw: string) => {
  const normalized = raw.replace(/-/g, "/");
  const parts = normalized.split("/").map((part) => Number(part));

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return null;
  }

  let [month, day, year] = parts;

  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  if (month > 12 && day <= 12) {
    [month, day] = [day, month];
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

async function fetchFirstAvailable(urls: readonly string[]) {
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown fetch failure");
    }
  }

  throw lastError ?? new Error("Unable to fetch dataset");
}

function parseCsvRows(csvText: string) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  }) as {
    data: Record<string, string>[];
    errors: Array<{ message: string }>;
  };

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data;
}

function discoverColumns(row: Record<string, string>) {
  const stateColumn =
    STATE_COLUMN_CANDIDATES.find((candidate) => candidate in row) ??
    Object.keys(row).find((key) => !DATE_COLUMN_PATTERN.test(key) && key.toLowerCase() !== "country/region");

  if (!stateColumn) {
    throw new Error("Could not find the state column in the dataset");
  }

  const dateColumns = Object.keys(row)
    .filter((key) => DATE_COLUMN_PATTERN.test(key))
    .map((key) => {
      const iso = parseDateColumn(key);
      return iso ? { raw: key, iso } : null;
    })
    .filter((item): item is { raw: string; iso: string } => item !== null)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  if (dateColumns.length === 0) {
    throw new Error("Could not find time-series date columns in the dataset");
  }

  return { stateColumn, dateColumns };
}

function rowsToSeries(rows: Record<string, string>[]) {
  if (rows.length === 0) {
    throw new Error("Dataset is empty");
  }

  const { stateColumn, dateColumns } = discoverColumns(rows[0]);
  const result: Record<string, Record<string, number>> = {};

  for (const row of rows) {
    const stateName = cleanStateName(row[stateColumn]);
    if (!stateName || EXCLUDED_STATE_ROWS.has(stateName)) continue;

    const values: Record<string, number> = result[stateName] ?? {};
    for (const { raw, iso } of dateColumns) {
      values[iso] = Math.max(0, toNumber(row[raw]));
    }
    result[stateName] = values;
  }

  return result;
}

function clampPoint(point: DailyTotals): DailyTotals {
  return {
    confirmed: Math.max(0, point.confirmed),
    deaths: Math.max(0, point.deaths),
    recovered: Math.max(0, point.recovered),
  };
}

function buildStateSeries(
  state: string,
  allDates: string[],
  confirmedMap: Record<string, number>,
  deathsMap: Record<string, number>,
  recoveredMap: Record<string, number>,
): StateSeries {
  let previous: DailyTotals = { confirmed: 0, deaths: 0, recovered: 0 };
  const points: StateSeriesPoint[] = [];

  for (let index = 0; index < allDates.length; index += 1) {
    const date = allDates[index];
    const current = clampPoint({
      confirmed: confirmedMap[date] ?? previous.confirmed,
      deaths: deathsMap[date] ?? previous.deaths,
      recovered: recoveredMap[date] ?? previous.recovered,
    });

    const dailyConfirmed = Math.max(0, current.confirmed - previous.confirmed);
    const dailyDeaths = Math.max(0, current.deaths - previous.deaths);
    const dailyRecovered = Math.max(0, current.recovered - previous.recovered);
    const movingWindow = points
      .slice(Math.max(0, points.length - 6))
      .map((point) => point.dailyConfirmed)
      .concat(dailyConfirmed);
    const movingAverage = movingWindow.reduce((sum, value) => sum + value, 0) / movingWindow.length;
    const active = Math.max(0, current.confirmed - current.recovered - current.deaths);

    points.push({
      date,
      ...current,
      active,
      dailyConfirmed,
      dailyDeaths,
      dailyRecovered,
      movingAverage,
      recoveryRate: current.confirmed > 0 ? current.recovered / current.confirmed : 0,
      fatalityRate: current.confirmed > 0 ? current.deaths / current.confirmed : 0,
    });

    previous = current;
  }

  const peakDayPoint = points.reduce((best, point) =>
    point.dailyConfirmed > best.dailyConfirmed ? point : best,
  );

  let peakWeek = { startDate: points[0].date, endDate: points[0].date, value: 0 };
  let fastestGrowthPeriod = { startDate: points[0].date, endDate: points[0].date, growthPercent: 0 };

  for (let start = 0; start < points.length; start += 1) {
    const weekPoints = points.slice(start, start + 7);
    if (weekPoints.length === 0) continue;

    const weeklyCases = weekPoints.reduce((sum, point) => sum + point.dailyConfirmed, 0);
    if (weeklyCases > peakWeek.value) {
      peakWeek = {
        startDate: weekPoints[0].date,
        endDate: weekPoints[weekPoints.length - 1].date,
        value: weeklyCases,
      };
    }

    if (weekPoints.length === 7) {
      const startValue = weekPoints[0].confirmed;
      const endValue = weekPoints[6].confirmed;
      const growthPercent = startValue > 0 ? ((endValue - startValue) / startValue) * 100 : endValue > 0 ? 100 : 0;

      if (growthPercent > fastestGrowthPeriod.growthPercent) {
        fastestGrowthPeriod = {
          startDate: weekPoints[0].date,
          endDate: weekPoints[6].date,
          growthPercent,
        };
      }
    }
  }

  return {
    state,
    points,
    peakDay: { date: peakDayPoint.date, value: peakDayPoint.dailyConfirmed },
    peakWeek,
    fastestGrowthPeriod,
  };
}

export async function loadCovidDataset(): Promise<CovidDataset> {
  const [confirmedCsv, deathsCsv, recoveredCsv] = await Promise.all([
    fetchFirstAvailable(DATASET_SOURCES.confirmed),
    fetchFirstAvailable(DATASET_SOURCES.deaths),
    fetchFirstAvailable(DATASET_SOURCES.recovered),
  ]);

  const confirmedRows = rowsToSeries(parseCsvRows(confirmedCsv));
  const deathsRows = rowsToSeries(parseCsvRows(deathsCsv));
  const recoveredRows = rowsToSeries(parseCsvRows(recoveredCsv));

  const states = Array.from(new Set([...Object.keys(confirmedRows), ...Object.keys(deathsRows), ...Object.keys(recoveredRows)])).sort();
  const allDates = Array.from(
    new Set(
      states.flatMap((state) => [
        ...Object.keys(confirmedRows[state] ?? {}),
        ...Object.keys(deathsRows[state] ?? {}),
        ...Object.keys(recoveredRows[state] ?? {}),
      ]),
    ),
  ).sort();

  if (allDates.length === 0) {
    throw new Error("No time-series dates were found in the datasets");
  }

  const normalizedDates = getDatesBetween(allDates[0], allDates[allDates.length - 1]);
  const seriesByState = Object.fromEntries(
    states.map((state) => [
      state,
      buildStateSeries(state, normalizedDates, confirmedRows[state] ?? {}, deathsRows[state] ?? {}, recoveredRows[state] ?? {}),
    ]),
  );

  return {
    states,
    dateRange: { min: normalizedDates[0], max: normalizedDates[normalizedDates.length - 1] },
    seriesByState,
  };
}

export function filterStatePoints(series: StateSeries, startDate: string, endDate: string) {
  return series.points.filter((point) => point.date >= startDate && point.date <= endDate);
}

export function getMetricValue(point: StateSeriesPoint, metric: MetricKey) {
  return point[metric];
}

export function getRankings(dataset: CovidDataset, states: string[], metric: MetricKey, date: string): RankingRow[] {
  return states
    .map((state) => {
      const point = dataset.seriesByState[state]?.points.find((entry) => entry.date === date);
      return {
        state,
        value: point ? getMetricValue(point, metric) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function summarizeInsights(dataset: CovidDataset, selectedStates: string[], startDate: string, endDate: string) {
  return selectedStates.map((state) => {
    const series = dataset.seriesByState[state];
    const window = filterStatePoints(series, startDate, endDate);
    const first = window[0];
    const last = window[window.length - 1];
    const totalNewCases = window.reduce((sum, point) => sum + point.dailyConfirmed, 0);
    const trendDelta = last && first ? last.movingAverage - first.movingAverage : 0;
    const averageRecoveryRate =
      window.length > 0 ? window.reduce((sum, point) => sum + point.recoveryRate, 0) / window.length : 0;

    return {
      state,
      totalNewCases,
      trendDelta,
      averageRecoveryRate,
      peakDay: series.peakDay,
      peakWeek: series.peakWeek,
      fastestGrowthPeriod: series.fastestGrowthPeriod,
    };
  });
}
