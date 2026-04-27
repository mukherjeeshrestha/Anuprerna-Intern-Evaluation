import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CovidDataset, FailureMode, MetricKey, RequestState } from "./types";
import { filterStatePoints, getRankings, loadCovidDataset, summarizeInsights } from "./utils/covid";
import { formatDate } from "./utils/date";
import { ApiError, requestJson } from "./utils/api";

interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

const metricOptions: Array<{ value: MetricKey; label: string }> = [
  { value: "confirmed", label: "Confirmed" },
  { value: "active", label: "Active" },
  { value: "deaths", label: "Deaths" },
  { value: "recovered", label: "Recovered" },
  { value: "dailyConfirmed", label: "Daily cases" },
  { value: "dailyDeaths", label: "Daily deaths" },
  { value: "dailyRecovered", label: "Daily recoveries" },
  { value: "movingAverage", label: "7-day average" },
];

const failureLabels: Array<{ value: FailureMode; label: string }> = [
  { value: "none", label: "Normal" },
  { value: "network", label: "Network failure" },
  { value: "http404", label: "HTTP 404" },
  { value: "timeout", label: "Timeout" },
  { value: "malformed", label: "Malformed payload" },
  { value: "empty", label: "Empty results" },
];

const initialRequestState = <T,>(): RequestState<T> => ({
  data: null,
  loading: false,
  error: null,
  errorType: null,
});

function App() {
  const [activeView, setActiveView] = useState<"home" | "task1" | "task2">("home");
  const [datasetState, setDatasetState] = useState<RequestState<CovidDataset>>(initialRequestState);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [stateQuery, setStateQuery] = useState("");
  const [metric, setMetric] = useState<MetricKey>("dailyConfirmed");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [failureMode, setFailureMode] = useState<FailureMode>("none");
  const [postsState, setPostsState] = useState<RequestState<Post[]>>(initialRequestState);
  const [singlePostState, setSinglePostState] = useState<RequestState<Post>>(initialRequestState);
  const [mutationState, setMutationState] = useState<RequestState<Post>>(initialRequestState);
  const [search, setSearch] = useState("");
  const [selectedPostId, setSelectedPostId] = useState(1);
  const [page, setPage] = useState(1);
  const [mutationMode, setMutationMode] = useState<"POST" | "PATCH" | "DELETE">("POST");

  useEffect(() => {
    let cancelled = false;

    setDatasetState({ data: null, loading: true, error: null, errorType: null });

    loadCovidDataset()
      .then((data) => {
        if (cancelled) return;
        setDatasetState({ data, loading: false, error: null, errorType: null });
        const defaultStates = data.states.slice(0, 3);
        setSelectedStates(defaultStates);
        setStartDate(data.dateRange.min);
        setEndDate(data.dateRange.max);
      })
      .catch((error) => {
        if (cancelled) return;
        setDatasetState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load the dataset.",
          errorType: "network",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadPosts = async () => {
    setPostsState((current) => ({ ...current, loading: true, error: null, errorType: null }));
    try {
      const response = await requestJson<Post[]>("/posts", { failureMode, timeoutMs: 5000 });
      if (!Array.isArray(response)) {
        throw new ApiError("Expected a list of posts.", "parse");
      }
      const sanitized = response.filter((item) => item && typeof item.id === "number" && typeof item.title === "string");
      setPostsState({ data: sanitized, loading: false, error: null, errorType: null });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("Request failed.", "network");
      setPostsState({ data: null, loading: false, error: apiError.message, errorType: apiError.kind });
    }
  };

  const loadPostById = async () => {
    setSinglePostState((current) => ({ ...current, loading: true, error: null, errorType: null }));
    try {
      const response = await requestJson<Post>(`/posts/${selectedPostId}`, { failureMode, timeoutMs: 5000 });
      if (!response || typeof response.id !== "number" || typeof response.title !== "string") {
        throw new ApiError("Expected a valid post payload.", "parse");
      }
      setSinglePostState({ data: response, loading: false, error: null, errorType: null });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("Request failed.", "network");
      setSinglePostState({ data: null, loading: false, error: apiError.message, errorType: apiError.kind });
    }
  };

  const runMutation = async () => {
    setMutationState((current) => ({ ...current, loading: true, error: null, errorType: null }));
    const body =
      mutationMode === "DELETE"
        ? undefined
        : JSON.stringify({
            title: "Codex generated post",
            body: "Mutation demo for the evaluation task.",
            userId: 77,
          });

    try {
      const response = await requestJson<Post>(mutationMode === "POST" ? "/posts" : "/posts/1", {
        method: mutationMode,
        body,
        failureMode,
        timeoutMs: 5000,
      });
      setMutationState({ data: response, loading: false, error: null, errorType: null });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("Request failed.", "network");
      setMutationState({ data: null, loading: false, error: apiError.message, errorType: apiError.kind });
    }
  };

  useEffect(() => {
    loadPosts();
  }, [failureMode]);

  const filteredPosts = useMemo(() => {
    const posts = postsState.data ?? [];
    const filtered = posts.filter(
      (post) =>
        post.title.toLowerCase().includes(search.toLowerCase()) ||
        post.body.toLowerCase().includes(search.toLowerCase()),
    );

    return filtered;
  }, [postsState.data, search]);

  const paginatedPosts = useMemo(() => {
    const pageSize = 8;
    const startIndex = (page - 1) * pageSize;
    return filteredPosts.slice(startIndex, startIndex + pageSize);
  }, [filteredPosts, page]);

  const pageCount = Math.max(1, Math.ceil(filteredPosts.length / 8));

  useEffect(() => {
    setPage(1);
  }, [search, failureMode]);

  const chartStates = selectedStates.slice(0, 3);

  const dailyCasesData = useMemo(() => {
    if (!datasetState.data || selectedStates.length === 0) return [];

    const baseSeries = filterStatePoints(datasetState.data.seriesByState[selectedStates[0]], startDate, endDate);
    return baseSeries.map((point) => {
      const matchedPoints = selectedStates
        .map((state) => datasetState.data?.seriesByState[state]?.points.find((item) => item.date === point.date))
        .filter(Boolean);
      const dailyNew = matchedPoints.reduce((sum, item) => sum + (item?.dailyConfirmed ?? 0), 0);
      const movingAverage = matchedPoints.reduce((sum, item) => sum + (item?.movingAverage ?? 0), 0);

      return {
        date: point.date,
        label: formatDate(point.date),
        dailyNew,
        movingAverage,
      };
    });
  }, [datasetState.data, selectedStates, startDate, endDate]);

  const cumulativeComparisonData = useMemo(() => {
    if (!datasetState.data || chartStates.length === 0) return [];

    const baseSeries = filterStatePoints(datasetState.data.seriesByState[chartStates[0]], startDate, endDate);
    return baseSeries.map((point) => {
      const entry: Record<string, string | number> = {
        date: point.date,
        label: formatDate(point.date),
      };

      for (const state of chartStates) {
        const statePoint = datasetState.data?.seriesByState[state]?.points.find((item) => item.date === point.date);
        entry[state] = statePoint?.confirmed ?? 0;
      }

      return entry;
    });
  }, [datasetState.data, chartStates, startDate, endDate]);

  const rateTrendData = useMemo(() => {
    if (!datasetState.data || selectedStates.length === 0) return [];
    const primaryState = selectedStates[0];

    return filterStatePoints(datasetState.data.seriesByState[primaryState], startDate, endDate).map((point) => ({
      date: point.date,
      label: formatDate(point.date),
      recoveryRate: point.recoveryRate * 100,
      fatalityRate: point.fatalityRate * 100,
    }));
  }, [datasetState.data, selectedStates, startDate, endDate]);

  const activeTrendData = useMemo(() => {
    if (!datasetState.data || chartStates.length === 0) return [];

    const baseSeries = filterStatePoints(datasetState.data.seriesByState[chartStates[0]], startDate, endDate);
    return baseSeries.map((point) => {
      const entry: Record<string, string | number> = {
        date: point.date,
        label: formatDate(point.date),
      };

      for (const state of chartStates) {
        const statePoint = datasetState.data?.seriesByState[state]?.points.find((item) => item.date === point.date);
        entry[state] = statePoint?.active ?? 0;
      }

      return entry;
    });
  }, [datasetState.data, chartStates, startDate, endDate]);

  const summaryCards = useMemo(() => {
    if (!datasetState.data) return [];

    return selectedStates.map((state) => {
      const points = filterStatePoints(datasetState.data!.seriesByState[state], startDate, endDate);
      const latest = points[points.length - 1];
      const totalCases = points.reduce((sum, point) => sum + point.dailyConfirmed, 0);

      return {
        state,
        totalCases,
        active: latest?.active ?? 0,
        recoveryRate: latest?.recoveryRate ?? 0,
        fatalityRate: latest?.fatalityRate ?? 0,
      };
    });
  }, [datasetState.data, selectedStates, startDate, endDate]);

  const rankingData = useMemo(() => {
    if (!datasetState.data || !endDate) return [];
    return getRankings(datasetState.data, datasetState.data.states, metric, endDate).slice(0, 10);
  }, [datasetState.data, metric, endDate]);

  const rankingMax = rankingData[0]?.value ?? 1;

  const insights = useMemo(() => {
    if (!datasetState.data || selectedStates.length === 0) return [];
    return summarizeInsights(datasetState.data, selectedStates, startDate, endDate);
  }, [datasetState.data, selectedStates, startDate, endDate]);

  const filteredStates = useMemo(() => {
    if (!datasetState.data) return [];
    const query = stateQuery.trim().toLowerCase();
    const matches = datasetState.data.states.filter((state) => state.toLowerCase().includes(query));
    return matches.slice(0, 12);
  }, [datasetState.data, stateQuery]);

  const toggleState = (state: string) => {
    setSelectedStates((current) => {
      if (current.includes(state)) {
        return current.filter((item) => item !== state);
      }

      if (current.length >= 5) {
        return [...current.slice(1), state];
      }

      return [...current, state];
    });
  };

  return (
    <div className="app-shell">
      {activeView === "home" && (
        <header className="hero">
          <div className="hero-intro">
            <p className="hero-label">Anuprerna Intern Evaluation</p>
            <h1 className="hero-name">
              <span>Shrestha</span>
              <span>Mukherjee</span>
            </h1>
            <p className="hero-meta">shresthamuk@gmail.com · React / TypeScript / Vite</p>
          </div>

          <div className="hero-task-grid">
            <button className="hero-task-card" onClick={() => setActiveView("task1")}>
              <p className="hero-task-kicker">Task 01</p>
              <h2>COVID-19 India Dashboard</h2>
              <p>State selector, date range, metric switcher, multi-state comparison, insights panel, and computed metrics.</p>
              <span className="hero-task-arrow">→</span>
            </button>

            <button className="hero-task-card" onClick={() => setActiveView("task2")}>
              <p className="hero-task-kicker">Task 02</p>
              <h2>REST API Explorer</h2>
              <p>JSONPlaceholder integration with record views, mutations, search, pagination, and error-state simulation.</p>
              <span className="hero-task-arrow">→</span>
            </button>
          </div>
        </header>
      )}

      {activeView !== "home" && (
        <div className="view-toolbar">
          <button className="secondary-button" onClick={() => setActiveView("home")}>
            Back to landing
          </button>
        </div>
      )}

      {activeView === "task1" && (
        <main className="content">
        <section className="section" id="task-1">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Task 1</p>
              <h2>COVID-19 India Insights Dashboard</h2>
            </div>
            {datasetState.data && (
              <div className="date-chip">
                Coverage: {formatDate(datasetState.data.dateRange.min)} to {formatDate(datasetState.data.dateRange.max)}
              </div>
            )}
          </div>

          {datasetState.loading && <div className="panel skeleton">Loading COVID datasets and calculating trends...</div>}

          {datasetState.error && (
            <div className="panel error-panel">
              <p>{datasetState.error}</p>
              <button className="primary-button" onClick={() => window.location.reload()}>
                Retry dashboard load
              </button>
            </div>
          )}

          {datasetState.data && (
            <>
              <div className="filters-panel panel">
                <div className="filters-layout">
                  <div className="state-picker">
                    <div className="filters-title-row">
                      <div>
                        <h3>States</h3>
                        <p>Compare up to five states at a time.</p>
                      </div>
                      <button className="secondary-button" onClick={() => setSelectedStates(datasetState.data!.states.slice(0, 3))}>
                        Reset picks
                      </button>
                    </div>

                    <label className="field">
                      <span>Search states</span>
                      <input
                        type="search"
                        value={stateQuery}
                        placeholder="Type a state or union territory"
                        onChange={(event) => setStateQuery(event.target.value)}
                      />
                    </label>

                    <div className="selected-state-chips">
                      {selectedStates.map((state) => (
                        <button key={state} className="state-chip active" onClick={() => toggleState(state)}>
                          <span>{state}</span>
                          <strong>×</strong>
                        </button>
                      ))}
                      {selectedStates.length === 0 && <div className="empty-inline">Pick at least one state to populate the dashboard.</div>}
                    </div>

                    <div className="state-results">
                      {filteredStates.map((state) => {
                        const active = selectedStates.includes(state);
                        return (
                          <button
                            key={state}
                            className={active ? "state-chip active" : "state-chip"}
                            onClick={() => toggleState(state)}
                          >
                            <span>{state}</span>
                            <strong>{active ? "Selected" : "Add"}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="filter-controls">
                    <div className="filter-control-grid">
                      <label className="field">
                        <span>Start date</span>
                        <input type="date" value={startDate} min={datasetState.data.dateRange.min} max={endDate} onChange={(event) => setStartDate(event.target.value)} />
                      </label>

                      <label className="field">
                        <span>End date</span>
                        <input type="date" value={endDate} min={startDate} max={datasetState.data.dateRange.max} onChange={(event) => setEndDate(event.target.value)} />
                      </label>

                      <label className="field">
                        <span>Metric</span>
                        <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
                          {metricOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="range-presets">
                      <button className="secondary-button" onClick={() => setStartDate(datasetState.data!.dateRange.min)}>
                        Full range
                      </button>
                      <button className="secondary-button" onClick={() => setStartDate("2020-03-01")}>
                        From Mar 2020
                      </button>
                      <button className="secondary-button" onClick={() => setMetric("movingAverage")}>
                        7-day trend
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card-grid">
                {summaryCards.map((card) => (
                  <article key={card.state} className="panel stat-card">
                    <p className="stat-label">{card.state}</p>
                    <h3>{Math.round(card.totalCases).toLocaleString("en-IN")} new cases</h3>
                    <dl>
                      <div>
                        <dt>Active</dt>
                        <dd>{Math.round(card.active).toLocaleString("en-IN")}</dd>
                      </div>
                      <div>
                        <dt>Recovery rate</dt>
                        <dd>{(card.recoveryRate * 100).toFixed(1)}%</dd>
                      </div>
                      <div>
                        <dt>Fatality ratio</dt>
                        <dd>{(card.fatalityRate * 100).toFixed(2)}%</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="analytics-grid">
                <div className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Daily New Cases</h3>
                      <p>Combined selected states with 7-day moving average</p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={dailyCasesData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                      <XAxis dataKey="label" minTickGap={28} stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="dailyNew" name="Daily New" dot={false} stroke="#22d3ee" strokeWidth={2} />
                      <Line type="monotone" dataKey="movingAverage" name="7-day MA" dot={false} stroke="#67e8f9" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Multi-State Cumulative</h3>
                      <p>Confirmed cases for the selected states</p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={cumulativeComparisonData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                      <XAxis dataKey="label" minTickGap={28} stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Legend />
                      {chartStates.map((state, index) => (
                        <Line
                          key={state}
                          type="monotone"
                          dataKey={state}
                          name={state}
                          dot={false}
                          stroke={["#22d3ee", "#fb7185", "#64ff4d"][index % 3]}
                          strokeWidth={2.5}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="panel chart-panel compact-chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Recovery vs Fatality Rate</h3>
                      <p>{selectedStates[0]} trend</p>
                    </div>
                  </div>
                  <div className="series-key">
                    <span className="series-pill green">Recovery Rate %</span>
                    <span className="series-pill red">Fatality Rate %</span>
                  </div>
                  <ResponsiveContainer width="100%" height={228}>
                    <LineChart data={rateTrendData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                      <XAxis dataKey="label" minTickGap={28} stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="recoveryRate" name="Recovery Rate %" dot={false} stroke="#64ff4d" strokeWidth={2.5} />
                      <Line type="monotone" dataKey="fatalityRate" name="Fatality Rate %" dot={false} stroke="#fb7185" strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="panel chart-panel compact-chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Active Cases Trend</h3>
                      <p>Selected states over time</p>
                    </div>
                  </div>
                  <div className="series-key">
                    {chartStates.map((state, index) => (
                      <span
                        key={state}
                        className={["series-pill cyan", "series-pill red", "series-pill green"][index % 3]}
                      >
                        {state}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={228}>
                    <LineChart data={activeTrendData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                      <XAxis dataKey="label" minTickGap={28} stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      {chartStates.map((state, index) => (
                        <Line
                          key={state}
                          type="monotone"
                          dataKey={state}
                          name={state}
                          dot={false}
                          stroke={["#22d3ee", "#fb7185", "#64ff4d"][index % 3]}
                          strokeWidth={2.5}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="panel rankings-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>State Rankings</h3>
                      <p>Top 10 by {metricOptions.find((option) => option.value === metric)?.label?.toLowerCase()}</p>
                    </div>
                  </div>
                  <div className="rankings-list">
                    {rankingData.map((row, index) => (
                      <div key={row.state} className="ranking-item">
                        <div className="ranking-item-top">
                          <span className={index < 3 ? "rank-badge top" : "rank-badge"}>{index + 1}</span>
                          <div className="ranking-copy">
                            <strong>{row.state}</strong>
                            <span>{Math.round(row.value).toLocaleString("en-IN")}</span>
                          </div>
                          <span className="ranking-share">{((row.value / rankingMax) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="share-bar">
                          <div style={{ width: `${(row.value / rankingMax) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="panel insight-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Insights panel</h3>
                    <p>Patterns surfaced from the computed data window.</p>
                  </div>
                </div>
                <div className="insight-list">
                  {insights.map((item) => (
                    <article key={item.state} className="insight-card">
                      <h4>{item.state}</h4>
                      <p>
                        {item.totalNewCases.toLocaleString("en-IN")} new cases in the selected range, with the 7-day
                        trend {item.trendDelta >= 0 ? "rising" : "cooling"} by {Math.abs(item.trendDelta).toFixed(1)}.
                      </p>
                      <p>
                        Peak day: {formatDate(item.peakDay.date)} ({item.peakDay.value.toLocaleString("en-IN")} daily
                        cases). Peak week: {formatDate(item.peakWeek.startDate)} to {formatDate(item.peakWeek.endDate)}.
                      </p>
                      <p>
                        Average recovery rate in view: {(item.averageRecoveryRate * 100).toFixed(1)}%. Fastest growth
                        period: {formatDate(item.fastestGrowthPeriod.startDate)} to{" "}
                        {formatDate(item.fastestGrowthPeriod.endDate)} ({item.fastestGrowthPeriod.growthPercent.toFixed(1)}%).
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
        </main>
      )}

      {activeView === "task2" && (
        <main className="content">
        <section className="section" id="task-2">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Task 2</p>
              <h2>REST API Integration</h2>
            </div>
            <div className="date-chip">JSONPlaceholder with forceable failure states</div>
          </div>

          <div className="toolbar-grid api-toolbar">
            <label className="field">
              <span>Failure mode</span>
              <select value={failureMode} onChange={(event) => setFailureMode(event.target.value as FailureMode)}>
                {failureLabels.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Search posts</span>
              <input
                type="search"
                value={search}
                placeholder="Filter by title or body"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Post id</span>
              <input
                type="number"
                min={1}
                max={100}
                value={selectedPostId}
                onChange={(event) => setSelectedPostId(Number(event.target.value) || 1)}
              />
            </label>

            <div className="field">
              <span>Mutation</span>
              <div className="segmented">
                {(["POST", "PATCH", "DELETE"] as const).map((value) => (
                  <button
                    key={value}
                    className={value === mutationMode ? "segment active" : "segment"}
                    onClick={() => setMutationMode(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="api-layout">
            <div className="panel api-list-panel">
              <div className="panel-heading">
                <div>
                  <h3>Posts explorer</h3>
                  <p>Searchable list with pagination, retries, and readable states.</p>
                </div>
                <button className="primary-button" onClick={loadPosts}>
                  Refresh list
                </button>
              </div>

              <div className="api-list-summary">
                <div className="summary-pill">
                  <span>Visible</span>
                  <strong>{paginatedPosts.length}</strong>
                </div>
                <div className="summary-pill">
                  <span>Matched</span>
                  <strong>{filteredPosts.length}</strong>
                </div>
                <div className="summary-pill">
                  <span>Mode</span>
                  <strong>{failureLabels.find((option) => option.value === failureMode)?.label}</strong>
                </div>
              </div>

              {postsState.loading && <div className="skeleton inline-skeleton">Loading posts...</div>}
              {postsState.error && <ErrorState message={postsState.error} kind={postsState.errorType} onRetry={loadPosts} />}
              {!postsState.loading && !postsState.error && paginatedPosts.length === 0 && (
                <div className="empty-state">No posts matched the current state. Try another search or failure mode.</div>
              )}

              <div className="post-list refined-post-list">
                {paginatedPosts.map((post) => (
                  <article
                    key={post.id}
                    className="post-card refined-post-card"
                    onClick={() => {
                      setSelectedPostId(post.id);
                      setSinglePostState({ data: post, loading: false, error: null, errorType: null });
                    }}
                  >
                    <div className="post-card-top">
                      <div className="post-identity">
                        <span className="post-number">#{post.id}</span>
                        <h4>{post.title}</h4>
                      </div>
                      <span className="user-chip">User {post.userId}</span>
                    </div>
                    <p>{post.body}</p>
                  </article>
                ))}
              </div>

              <div className="pagination">
                <button className="secondary-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                  Previous
                </button>
                <span>
                  Page {page} of {pageCount}
                </span>
                <button
                  className="secondary-button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>

            <div className="api-side-stack">
              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Selected record</h3>
                    <p>Inspect one post by id or click an item from the list.</p>
                  </div>
                  <button className="primary-button" onClick={loadPostById}>
                    Fetch post
                  </button>
                </div>

                {singlePostState.loading && <div className="skeleton inline-skeleton">Loading selected post...</div>}
                {singlePostState.error && (
                  <ErrorState message={singlePostState.error} kind={singlePostState.errorType} onRetry={loadPostById} />
                )}
                {singlePostState.data && !singlePostState.loading && !singlePostState.error && (
                  <article className="detail-card refined-detail-card">
                    <div className="detail-header">
                      <span className="detail-id">Post #{singlePostState.data.id}</span>
                      <span className="user-chip">User {singlePostState.data.userId}</span>
                    </div>
                    <h4>{singlePostState.data.title}</h4>
                    <p>{singlePostState.data.body}</p>
                  </article>
                )}

                {!singlePostState.loading && !singlePostState.error && !singlePostState.data && (
                  <div className="empty-state">Choose an id or click a post from the list to inspect it here.</div>
                )}
              </div>

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Mutation demo</h3>
                    <p>Run {mutationMode} and reflect the response directly in the UI.</p>
                  </div>
                  <button className="primary-button" onClick={runMutation}>
                    Execute {mutationMode}
                  </button>
                </div>

                <div className="mutation-banner">
                  <span className="mutation-label">Active method</span>
                  <strong>{mutationMode}</strong>
                </div>

                {mutationState.loading && <div className="skeleton inline-skeleton">Sending mutation...</div>}
                {mutationState.error && (
                  <ErrorState message={mutationState.error} kind={mutationState.errorType} onRetry={runMutation} />
                )}
                {mutationState.data && !mutationState.loading && !mutationState.error && (
                  <pre className="response-box">{JSON.stringify(mutationState.data, null, 2)}</pre>
                )}
                {!mutationState.loading && !mutationState.error && !mutationState.data && (
                  <div className="empty-state">Run a mutation to see the API response rendered here.</div>
                )}
              </div>
            </div>
          </div>
        </section>
        </main>
      )}
    </div>
  );
}

function ErrorState({
  message,
  kind,
  onRetry,
}: {
  message: string;
  kind: RequestState<unknown>["errorType"];
  onRetry: () => void;
}) {
  return (
    <div className="error-panel">
      <strong>{kind === "http" ? "HTTP error" : kind === "timeout" ? "Timeout" : kind === "parse" ? "Payload error" : "Network failure"}</strong>
      <p>{message}</p>
      <button className="secondary-button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default App;
