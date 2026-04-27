# Approach Note

## Data model

The COVID dashboard converts three wide CSV files (confirmed, deaths, recovered) into a normalized per-state, per-day series. Each state gets a continuous date range so missing dates inherit the last known cumulative total instead of breaking charts or calculations.

## Calculations

All required derived metrics are computed from the normalized series:

- daily new cases, deaths, recoveries
- active cases = confirmed - recovered - deaths
- recovery rate = recovered / confirmed
- case fatality ratio = deaths / confirmed
- 7-day moving average of daily confirmed cases
- peak day
- peak week
- fastest 7-day growth period
- rankings by metric for a chosen date

Where cumulative values move backward or fields are missing, the UI clamps daily deltas to zero and keeps the dashboard usable rather than surfacing negative spikes.

## API strategy

A small request wrapper around `fetch` centralizes:

- timeout handling with `AbortController`
- distinction between network, HTTP, timeout, and parse errors
- failure-mode simulation for evaluator testing
- lightweight payload validation before rendering

The UI uses the same request layer for list, single-record, and mutation actions so the behavior stays consistent.

## Tradeoffs

- The dashboard fetches the source CSVs at runtime instead of bundling local copies, which keeps the repo light and stays close to the assignment brief.
- Failure-state simulation is implemented in the request layer for reliability and speed, rather than depending on unpredictable real-world outages.
- The charts prioritize readability and comparison over adding more chart types.
