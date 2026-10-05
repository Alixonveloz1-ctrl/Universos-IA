import type { CinematicPlan, CinematicProjectInput } from "./schema";

export type CinematicAssetRole = "character" | "segment-image" | "segment-video";
export type CinematicAssetState = "candidate" | "waiting" | "completed" | "failed";

export interface CinematicAsset {
  id: string;
  projectId: string;
  kind: "image" | "video";
  role: CinematicAssetRole;
  model: string;
  prompt: string;
  inputRefs: string[];
  state: CinematicAssetState;
  createdAt: number;
  characterId?: string;
  segmentNumber?: number;
  storageObject?: string;
  operation?: string;
  outputPrefix?: string;
  error?: string;
}

export interface CinematicProject extends CinematicProjectInput {
  id: string;
  owner: "personal";
  mode: "cinematic-v1";
  title: string;
  plan?: CinematicPlan;
  approvedCharacters: Record<string, string>;
  approvedImages: Record<string, string>;
  approvedVideos: Record<string, string>;
  activeFinalizeJobId?: string | null;
  final?: {
    jobId: string;
    storageObject: string;
    createdAt: number;
    durationSeconds: number;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface CinematicFinalizeJob {
  id: string;
  projectId: string;
  state: "queued" | "running" | "completed" | "failed";
  error?: { code: string; message: string } | null;
  executionName?: string;
  operationName?: string;
  createdAt: number;
  updatedAt: number;
}
