export interface TraceStep {
  action: 'click' | 'type' | 'goto';
  selector: string;
  value: string | null;
}

export type ScriptStep = TraceStep;

export interface PlaybookEntry {
  groupId: string;
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
  trace: TraceStep[];
}

export interface RunLogEntry {
  id: string;
  groupId: string;
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

export interface User {
  id: string;
  email: string;
  /** "salt:hash" hex-encoded scrypt output — never the plain password. */
  passwordHash: string;
  displayName: string | null;
  currentGroupId: string | null;
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  createdAt: string;
  memberUserIds: string[];
}

export interface ChatMessage {
  id: string;
  groupId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}
