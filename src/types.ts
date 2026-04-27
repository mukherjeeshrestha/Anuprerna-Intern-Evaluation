export type MetricKey =
  | "confirmed"
  | "deaths"
  | "recovered"
  | "active"
  | "dailyConfirmed"
  | "dailyDeaths"
  | "dailyRecovered"
  | "movingAverage";

export interface DailyTotals {
  confirmed: number;
  deaths: number;
  recovered: number;
}

export interface StateSeriesPoint extends DailyTotals {
  date: string;
  active: number;
  dailyConfirmed: number;
  dailyDeaths: number;
  dailyRecovered: number;
  movingAverage: number;
  recoveryRate: number;
  fatalityRate: number;
}

export interface StateSeries {
  state: string;
  points: StateSeriesPoint[];
  peakDay: { date: string; value: number };
  peakWeek: { startDate: string; endDate: string; value: number };
  fastestGrowthPeriod: { startDate: string; endDate: string; growthPercent: number };
}

export interface RankingRow {
  state: string;
  value: number;
}

export interface CovidDataset {
  states: string[];
  dateRange: { min: string; max: string };
  seriesByState: Record<string, StateSeries>;
}

export interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorType: "network" | "http" | "timeout" | "parse" | null;
}

export type FailureMode = "none" | "network" | "http404" | "timeout" | "malformed" | "empty";
