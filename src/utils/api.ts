import type { FailureMode } from "../types";

const BASE_URL = "https://jsonplaceholder.typicode.com";

export class ApiError extends Error {
  kind: "network" | "http" | "timeout" | "parse";
  status?: number;

  constructor(message: string, kind: "network" | "http" | "timeout" | "parse", status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildUrl(path: string, failureMode: FailureMode) {
  if (failureMode === "network") {
    return "https://invalid-jsonplaceholder-host.example";
  }

  if (failureMode === "http404") {
    return `${BASE_URL}/missing-endpoint`;
  }

  return `${BASE_URL}${path}`;
}

export async function requestJson<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number; failureMode?: FailureMode } = {},
): Promise<T> {
  const { timeoutMs = 8000, failureMode = "none", ...fetchOptions } = options;

  if (failureMode === "timeout") {
    await sleep(timeoutMs + 250);
    throw new ApiError("The request timed out.", "timeout");
  }

  if (failureMode === "empty") {
    return [] as T;
  }

  if (failureMode === "malformed") {
    return { bad: "shape" } as T;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(path, failureMode), {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        ...(fetchOptions.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}.`, "http", response.status);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("The server returned malformed JSON.", "parse");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out.", "timeout");
    }

    throw new ApiError("Network error. Please check the connection or endpoint.", "network");
  } finally {
    clearTimeout(timer);
  }
}
