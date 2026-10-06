import type { CinematicPlan, CinematicProjectInput, CinematicSegment } from "./schema";

export function cinematicImageCharacterIds(segment: CinematicSegment, shotLayout?: string): string[] {
  return shotLayout === "one-shot-per-video" ? segment.shots[0].characterIds : segment.characterIds;
}

export type CinematicAssetRole = "character" | "segment-image" | "segment-video";
export type CinematicAssetState = "submitting" | "uncertain" | "candidate" | "waiting" | "completed" | "failed";

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
  planRevision?: number;
  characterId?: string;
  segmentNumber?: number;
  storageObject?: string;
  operation?: string;
  outputPrefix?: string;
  error?: string | null;
}

export interface CinematicProject extends CinematicProjectInput {
  id: string;
  owner: "personal";
  mode: "cinematic-v1";
  shotLayout?: "one-shot-per-video";
  title: string;
  plan?: CinematicPlan;
  approvedCharacters: Record<string, string>;
  approvedImages: Record<string, string>;
  approvedVideos: Record<string, string>;
  revision?: number;
  planRevision?: number;
  activeGenerationId?: string | null;
  deleting?: boolean;
  activeFinalizeJobId?: string | null;
  lastFinalizeJobId?: string | null;
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
  state: "queued" | "running" | "completed" | "failed" | "superseded";
  revision: number;
  planRevision: number;
  durationSeconds: number;
  segments: { number: number; assetId: string; storageObject: string; durationSeconds: number }[];
  leaseOwner?: string | null;
  leaseUntil?: number;
  storageObject?: string;
  dispatchState?: "pending" | "accepted" | "uncertain" | "failed";
  dispatchAttemptAt?: number;
  error?: { code: string; message: string } | null;
  executionName?: string;
  operationName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CinematicPlanRun {
  id: string;
  state: "submitting" | "uncertain" | "completed" | "failed";
  baseRevision: number;
  model: string;
  createdAt: number;
  error?: string;
}
