import type { Action, Bible, Plan, Universe } from "./schemas";
export type JobState =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped"
  | "needsReview";
export type Editorial =
  | "draft"
  | "candidate"
  | "approved"
  | "rejected"
  | "needsReview";
export interface Narrative {
  id: string;
  kind: "story" | "bible" | "plan";
  data: unknown;
  approvedAt?: number;
  sourceRevision: number;
  createdAt: number;
}
export interface Target {
  id: string;
  kind: "image" | "video";
  role: "character" | "location" | "shot" | "clip";
  entityId: string;
  clipNumber?: number;
  approvedVersionId?: string;
  needsReview: boolean;
  instructions: string;
}
export interface Asset {
  id: string;
  targetId: string;
  kind: "image" | "video";
  status: Editorial;
  model: string;
  prompt: string;
  inputRefs: string[];
  settings: Record<string, unknown>;
  storageObject: string;
  mime: string;
  checksum: string;
  sourceRevisions: {
    project: number;
    bible: string;
    plan: string;
    previousClip: string | null;
  };
  createdAt: number;
  technicalReport: Record<string, unknown>;
  lastFrameObject?: string;
}
export interface ChapterMemory {
  projectId: string;
  chapterNumber: number;
  title: string;
  story: unknown;
  finalState: unknown;
  exportId: string;
}
export interface Project {
  id: string;
  owner: "personal";
  universeId: string;
  automaticUniverse?: boolean;
  concept?: string;
  characterDesign?: "Humanoide" | "Cabeza de especie/material";
  chapterNumber?: number;
  rootProjectId?: string;
  nextChapterId?: string;
  history?: ChapterMemory[];
  previousChapter?: {
    projectId: string;
    exportId: string;
    finalState: unknown;
    lastClip: Asset;
    bible: Bible;
  };
  universeSnapshot: Universe & { revision: number };
  title: string;
  revision: number;
  stage: string;
  worldSetting: string;
  genre: string;
  subgenre: string;
  plotType: string;
  tone: string;
  ending: string;
  language: string;
  accent: string;
  models: { text: string; image: string; video: string };
  ideas: { id: string; title: string; synopsis: string; universe?: Universe }[];
  selectedIdeaId?: string;
  story?: Narrative;
  bible?: Narrative;
  plan?: Narrative;
  activeJobId?: string;
  createdAt: number;
  updatedAt: number;
}
export interface Snapshot {
  project: Project;
  targets: Target[];
  assets: Asset[];
  bible: Bible | null;
  plan: Plan | null;
  observed: Record<string, unknown>;
  manifest?: string[];
}
export interface Job {
  backend?: "direct" | "cloud";
  id: string;
  projectId: string;
  type: Action["type"];
  targetId?: string;
  optionId?: string;
  instructions: string;
  state: JobState;
  requestId: string;
  snapshot: Snapshot;
  createdAt: number;
  heartbeat: number;
  leaseOwner: string | null;
  leaseUntil: number;
  attempts: number;
  stopRequested: boolean;
  checkpoint: Record<string, unknown>;
  error?: { code: string; message: string };
  executionName?: string;
  operationName?: string;
  dispatchedAt?: number;
}
