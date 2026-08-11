"use client";

import type { SimulationResponse, SimulationWorkerResponse } from "./types.ts";

const MAX_CACHE_ENTRIES = 8;
const WORKER_TIMEOUT_MS = 20_000;
const resultCache = new Map<string, SimulationResponse>();
let nextRequestId = 1;

export class BrowserSimulationError extends Error {
  readonly type: "validation_error" | "simulation_error";

  constructor(type: "validation_error" | "simulation_error", message: string) {
    super(message);
    this.name = "BrowserSimulationError";
    this.type = type;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalSimulationKey(payload: unknown) {
  return JSON.stringify(canonicalize(payload)) ?? "undefined";
}

function cacheResult(key: string, result: SimulationResponse) {
  resultCache.delete(key);
  resultCache.set(key, structuredClone(result));
  while (resultCache.size > MAX_CACHE_ENTRIES) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

function abortError() {
  return new DOMException("Request was cancelled", "AbortError");
}

export function clearBrowserSimulationCache() {
  resultCache.clear();
}

export function runBrowserSimulation(
  payload: unknown,
  signal?: AbortSignal,
): Promise<SimulationResponse> {
  if (signal?.aborted) return Promise.reject(abortError());

  const cacheKey = canonicalSimulationKey(payload);
  const cached = resultCache.get(cacheKey);
  if (cached) {
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, cached);
    return new Promise((resolve, reject) => {
      queueMicrotask(() => {
        if (signal?.aborted) reject(abortError());
        else resolve(structuredClone(cached));
      });
    });
  }

  const requestId = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
      name: `retirement-simulation-${requestId}`,
    });
    let settled = false;

    const finish = () => {
      clearTimeout(timeoutId);
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(abortError());
    };

    worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      const response = event.data;
      if (settled || response.id !== requestId) return;
      settled = true;
      finish();
      if (!response.ok) {
        reject(new BrowserSimulationError(response.error.type, response.error.message));
        return;
      }
      cacheResult(cacheKey, response.result);
      resolve(structuredClone(response.result));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      finish();
      reject(new BrowserSimulationError("simulation_error", event.message || "simulation worker failed"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      finish();
      reject(new BrowserSimulationError("simulation_error", "The calculation took too long. Try fewer paths."));
    }, WORKER_TIMEOUT_MS);
    worker.postMessage({ id: requestId, payload });
  });
}
