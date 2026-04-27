# Anuprerna Intern Evaluation

This project implements both tasks from the evaluation brief in a single React + TypeScript app:

- Task 1: COVID-19 India insights dashboard using the University of Kalyani statewise time-series datasets
- Task 2: JSONPlaceholder integration with visible loading, retry, empty states, timeout handling, HTTP errors, malformed payload simulation, and network failure simulation

## Tech stack

- React 18
- TypeScript
- Vite
- Recharts for the dashboard charts
- Papa Parse for CSV parsing and normalization
- Native Fetch API with AbortController for REST requests and timeout handling
- Plain CSS for the UI styling

## Local setup from scratch

1. Make sure Node.js is installed.

   Recommended: Node 18+.

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open the local app URL shown by Vite in the terminal.

   Typical local URL:

```text
http://127.0.0.1:4173
```

5. Build for production:

```bash
npm run build
```

6. Preview the production build locally:

```bash
npm run preview
```

## What is included

### Task 1

- Multi-state selector
- Date-range filter
- Metric switcher
- Summary cards
- Multi-line comparison chart
- State ranking chart
- Insights panel
- Derived metrics:
  - Daily new confirmed cases
  - Daily new deaths
  - Daily new recoveries
  - Active cases
  - Recovery rate
  - Case fatality ratio
  - 7-day moving average
  - Peak day
  - Peak week
  - Fastest growth period

### Task 2

- Record list from `/posts`
- Single record fetch by id
- Mutation demo using `POST`, `PATCH`, and `DELETE`
- Search and pagination
- Friendly loading, empty, and error states
- Retry buttons for every request surface

## How to trigger each error state in Task 2

Use the `Failure mode` control in the API section:

- `Normal`: sends the real request to JSONPlaceholder
- `Network failure`: points requests to an invalid host
- `HTTP 404`: calls a missing endpoint
- `Timeout`: simulates a hanging request and aborts it cleanly
- `Malformed payload`: returns an invalid response shape in the request layer
- `Empty results`: returns an empty list for list views

## Notes on the COVID dataset

The dashboard fetches the University of Kalyani CSVs from GitHub-backed raw/CDN URLs at runtime and normalizes:

- state column naming differences
- date column parsing
- missing numeric cells
- inconsistent or decreasing daily values by clamping daily deltas to zero

