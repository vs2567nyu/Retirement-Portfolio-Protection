/// <reference lib="webworker" />

import { simulate, SimulationValidationError } from "./engine.ts";
import type { SimulationWorkerRequest, SimulationWorkerResponse } from "./types.ts";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const { id, payload } = event.data;
  let response: SimulationWorkerResponse;
  try {
    response = { id, ok: true, result: simulate(payload) };
  } catch (reason) {
    response = {
      id,
      ok: false,
      error: {
        type: reason instanceof SimulationValidationError ? "validation_error" : "simulation_error",
        message: reason instanceof Error ? reason.message : "simulation failed",
      },
    };
  }
  workerScope.postMessage(response);
};

export {};
