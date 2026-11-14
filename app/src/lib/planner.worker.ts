// Written with AI assistance, directed and reviewed by the team.

/**
 * Web Worker wrapper for Marswalk route planner.
 * Executes buildPlan in a background worker thread to keep the main UI responsive.
 */

import { buildPlan, BuildPlanInput, Plan } from './plan';

export interface WorkerRequestMessage {
  type: 'plan';
  id?: string;
  payload: BuildPlanInput;
}

export interface WorkerSuccessMessage {
  type: 'success';
  id?: string;
  plan: Plan;
}

export interface WorkerErrorMessage {
  type: 'error';
  id?: string;
  error: string;
}

export type WorkerResponseMessage = WorkerSuccessMessage | WorkerErrorMessage;

// Global worker message handler
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event: MessageEvent<WorkerRequestMessage | BuildPlanInput>) => {
    const data = event.data;
    const isWrapped = 'type' in data && data.type === 'plan';
    const reqId = isWrapped ? (data as WorkerRequestMessage).id : undefined;
    const input: BuildPlanInput = isWrapped ? (data as WorkerRequestMessage).payload : (data as BuildPlanInput);

    try {
      const plan = buildPlan(input);
      const res: WorkerSuccessMessage = { type: 'success', id: reqId, plan };
      self.postMessage(res);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const res: WorkerErrorMessage = { type: 'error', id: reqId, error: errorMsg };
      self.postMessage(res);
    }
  };
}
