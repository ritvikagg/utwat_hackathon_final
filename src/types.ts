export interface TraceStep {
  action: 'click' | 'type' | 'goto';
  selector: string;
  value: string | null;
}

export type ScriptStep = TraceStep;

export interface PlaybookEntry {
  domain: string;
  taskSignature: string;
  tips: string;
  script: ScriptStep[] | null;
  status: 'draft' | 'verified';
  successCount: number;
  lastTrace: TraceStep[] | null;
  updatedAt: string;
}

export interface ColdRunResult {
  success: boolean;
  summary: string;
  llmCalls: number;
  typedValues: string[];
}

export interface RunLogEntry {
  id: string;
  agentName: string;
  domain: string;
  taskSignature: string;
  taskDescription: string;
  mode: 'script' | 'tips' | 'none';
  success: boolean;
  summary: string;
  llmCalls: number;
  elapsedMs: number;
  sessionViewerUrl: string;
  timestamp: string;
}
