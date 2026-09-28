import { z } from "zod";
import { db, signedUrl } from "@/lib/persistence/google";
import {
  createProject,
  deleteUniverse,
  recoverReviewedIdeas,
  recoverReviewedStory,
  createNextChapter,
  enqueue,
  readSnapshot,
  editProject,
  approveAsset,
  resolveReview,
  jobControl,
  closeAmbiguousJob,
  projectRef,
} from "@/lib/persistence/projects";
import { login, originCheck, requireSession, sessionCookie } from "@/lib/auth";
import { action, id, projectInput } from "@/lib/schemas";
import { diagnoseQueuedJob } from "@/lib/jobs";
import { launch } from "@/lib/direct-dispatch";
import { model, MODELS, defaults } from "@/lib/models";
import { AppError, safeError, assert } from "@/lib/errors";
import {
  genres,
  plots,
  tones,
  endings,
  beings,
  styles,
} from "@/lib/director/catalog";
import type { Job, Project } from "@/lib/types";
import { blocksNewJob } from "@/lib/job-state";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("JSON", "Se requiere JSON", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("JSON", "Cuerpo vacío");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 250000) {
      await reader.cancel();
      throw new AppError("SIZE", "Solicitud demasiado grande", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError("JSON", "JSON inválido");
  }
}
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function handler(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const paths = (await params).path;
    paths.forEach((p) => id.parse(p));
    const route = paths.join("/"),
      mutating = req.method !== "GET";
    if (mutating) originCheck(req);
    if (route === "session" && req.method === "POST") {
      const b = z
        .object({ password: z.string().min(1).max(1024) })
        .strict()
        .parse(await body(req));
      return response({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(await login(b.password)),
      });
    }
    if (route === "session" && req.method === "DELETE")
      return response({ ok: true }, 200, {
        "Set-Cookie": sessionCookie("", 0),
      });
    requireSession(req);
    if (route === "session") return response({ ok: true });
    if (route === "catalog" && req.method === "GET")
      return response({
        genres,
        plots,
        tones,
        endings,
        beings,
        styles,
        models: MODELS,
        defaults: defaults(),
      });
    if (route === "universes") {
      if (req.method === "GET")
        return response(
          (await db().collection("universes").get()).docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })),
        );
      throw new AppError("METHOD", "El universo se crea al elegir la historia.", 405);
    }
    if (paths[0] === "universes" && req.method !== "GET")
      throw new AppError("METHOD", "Cada universo pertenece a una historia; continúa desde su último capítulo.", 405);
    if (route === "projects") {
      if (req.method === "GET")
        return response(
          (
            await db()
              .collection("projects")
              .where("owner", "==", "personal")
              .get()
          ).docs.map((d) => ({
            id: d.id,
            title: d.data().title,
            universeId: d.data().universeId || d.id,
            universeName: d.data().universeSnapshot?.name || d.data().title,
            chapterNumber: d.data().chapterNumber || 1,
            stage: d.data().stage,
            updatedAt: d.data().updatedAt,
          })),
        );
      if (req.method === "POST") {
        const p = projectInput.parse(await body(req));
        assert(
          genres[p.genre]?.includes(p.subgenre) &&
            plots.includes(p.plotType) &&
            tones.includes(p.tone) &&
            endings.includes(p.ending) &&
            beings.includes(p.beings) && styles.includes(p.visualStyle),
          "Selección narrativa inválida",
        );
        for (const kind of ["text", "image", "video"] as const)
          model(p.models[kind], kind);
        return response(await createProject(p), 201);
      }
    }
    if (paths[0] === "projects" && paths.length >= 2) {
      const pid = paths[1];
      if (paths.length === 2 && req.method === "DELETE") {
        return response(await deleteUniverse(pid));
      }
      if (paths.length === 3 && paths[2] === "next-chapter" && req.method === "POST") {
        const b = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(await body(req));
        return response(await createNextChapter(pid, b.expectedRevision), 201);
      }
      if (paths.length === 2 && req.method === "GET") {
        const s = await readSnapshot(pid);
        const [n, e] = await Promise.all([
          projectRef(pid).collection("narratives").get(),
          projectRef(pid).collection("exports").get(),
        ]);
        let active = s.project.activeJobId
          ? (await db().doc(`jobs/${s.project.activeJobId}`).get()).data()
          : null;
        if (active) active = await diagnoseQueuedJob(active as Job);
        return response({
          ...s,
          narratives: n.docs.map((d) => d.data()),
          exports: e.docs.map((d) => d.data()),
          job: active
            ? {
                id: active.id,
                type: active.type,
                state: active.state,
                backend: active.backend,
                error: active.error || (active.dispatchError ? { code: "DISPATCH", message: active.dispatchError } : null),
                stopRequested: active.stopRequested,
                heartbeat: active.heartbeat,
                leaseUntil: active.leaseUntil,
                resumable: active.leaseUntil < Date.now(),
                closedAt: active.checkpoint?.closedAt || null,
                reconciledAt: active.checkpoint?.reconciledAt || null,
                hasOperation: !!active.checkpoint?.operation,
                blocksNewJob: blocksNewJob(active as Job),
              }
            : null,
        });
      }
      if (paths.length === 2 && req.method === "PATCH") {
        const b = z
          .object({
            expectedRevision: z.number().int(),
            selectedIdeaId: id.optional(),
            kind: z.enum(["story", "bible", "plan"]).optional(),
            data: z.unknown().optional(),
            approve: z.boolean().optional(),
            versionId: id.optional(),
            models: projectInput.shape.models.optional(),
          })
          .strict()
          .parse(await body(req));
        if (b.models)
          for (const kind of ["text", "image", "video"] as const)
            model(b.models[kind], kind);
        return response(await editProject(pid, b.expectedRevision, b));
      }
      if (paths[2] === "actions" && req.method === "POST") {
        const a = action.parse(await body(req));
        const j = await enqueue(pid, a);
        if (j.state === "queued" && !j.executionName)
          try {
            await launch(j);
          } catch (error) {
            return response(
              {
                jobId: j.id,
                state: j.state,
                warning: safeError(error).message,
              },
              202,
            );
          }
        return response({ jobId: j.id, state: j.state }, 202);
      }
      if (
        paths[2] === "targets" &&
        paths.length === 5 &&
        req.method === "POST"
      ) {
        const b = z
          .object({
            expectedRevision: z.number().int(),
            versionId: id.optional(),
            observed: z.unknown().optional(),
            note: z.string().max(5000).optional(),
          })
          .strict()
          .parse(await body(req));
        if (paths[4] === "approve") {
          assert(b.versionId, "Falta versión");
          await approveAsset(
            pid,
            paths[3],
            b.versionId,
            b.expectedRevision,
            b.observed,
          );
        } else if (paths[4] === "review")
          await resolveReview(pid, paths[3], b.expectedRevision, b.note || "");
        else throw new AppError("NOT_FOUND", "Acción desconocida", 404);
        return response({ ok: true });
      }
      if (paths[2] === "media" && paths.length === 4 && req.method === "GET") {
        const asset =
          (
            await projectRef(pid).collection("assets").doc(paths[3]).get()
          ).data() ||
          (
            await projectRef(pid).collection("exports").doc(paths[3]).get()
          ).data();
        assert(asset?.storageObject, "Archivo no disponible");
        await readSnapshot(pid);
        return response({ url: await signedUrl(asset.storageObject) });
      }
    }
    if (paths[0] === "jobs" && paths.length >= 2) {
      const j = (await db().doc(`jobs/${paths[1]}`).get()).data() as
        | Job
        | undefined;
      assert(j, "Trabajo no encontrado");
      const p = (await projectRef(j.projectId).get()).data() as Project;
      assert(p?.owner === "personal", "Trabajo no autorizado");
      if (req.method === "POST" && paths.length === 3 && paths[2] === "recover-ideas")
        return response(await recoverReviewedIdeas(j.id));
      if (req.method === "POST" && paths.length === 3 && paths[2] === "recover-story")
        return response(await recoverReviewedStory(j.id));
      if (req.method === "GET")
        return response({
          id: j.id,
          state: j.state,
          error: j.error || null,
          heartbeat: j.heartbeat,
        });
      if (req.method === "POST" && paths.length === 3 && paths[2] === "close") {
        const b = z
          .object({
            note: z.string().trim().min(1).max(5000),
            acknowledged: z.literal(true),
          })
          .strict()
          .parse(await body(req));
        return response(await closeAmbiguousJob(j.id, b.note, b.acknowledged));
      }
      if (
        req.method === "POST" &&
        paths.length === 3 &&
        ["resume", "stop"].includes(paths[2])
      ) {
        const next = await jobControl(j.id, paths[2] as "resume" | "stop");
        if (paths[2] === "resume") await launch(next);
        return response({ jobId: j.id }, 202);
      }
    }
    throw new AppError("NOT_FOUND", "Ruta no encontrada.", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return response(
        {
          error: {
            code: "VALIDATION",
            message:
              "Datos inválidos: " +
              e.issues
                .map((i) => i.path.join(".") + " " + i.message)
                .join(";")
                .slice(0, 1500),
          },
        },
        400,
      );
    return response(
      { error: safeError(e) },
      e instanceof AppError ? e.status : 500,
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
