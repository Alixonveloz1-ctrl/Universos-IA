import { z } from "zod";
import { db, bucket, mediaResponse, directVideoObjectPath } from "@/lib/persistence/google";
import { config } from "@/lib/config";
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
  abandonWaitingVideoJob,
  projectRef,
} from "@/lib/persistence/projects";
import { login, originCheck, requireSession, sessionCookie } from "@/lib/auth";
import { action, id, projectInput } from "@/lib/schemas";
import { diagnoseQueuedJob } from "@/lib/jobs";
import { launch } from "@/lib/direct-dispatch";
import { model, MODELS, defaults } from "@/lib/models";
import { startVideo, pollVideo, type ImageRef } from "@/lib/providers/vertex";
import { createHash } from "node:crypto";
import { verifiedVideoObject } from "@/lib/direct-video";
import { AppError, safeError, assert, logFailure } from "@/lib/errors";
import {
  genres,
  plots,
  tones,
  endings,
  beings,
  styles,
  worlds,
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
        worlds,
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
      if (req.method === "GET") {
        const docs = (
          await db()
            .collection("projects")
            .where("owner", "==", "personal")
            .get()
        ).docs;
        const items = await Promise.all(
          docs.map(async (d) => {
            const data = d.data();
            const assets = (
              await d.ref.collection("assets").get()
            ).docs
              .map((a) => a.data())
              .filter((a) => a.kind === "image" && a.status !== "rejected")
              .sort(
                (a, b) =>
                  (a.createdAt || 0) - (b.createdAt || 0) ||
                  String(a.id || "").localeCompare(String(b.id || "")),
              );
            return {
              id: d.id,
              title: data.title,
              universeId: data.universeId || d.id,
              universeName: data.universeSnapshot?.name || data.title,
              chapterNumber: data.chapterNumber || 1,
              stage: data.stage,
              createdAt: data.createdAt || 0,
              updatedAt: data.updatedAt,
              thumbnailVersionId: assets[0]?.id || null,
            };
          }),
        );
        return response(items);
      }
      if (req.method === "POST") {
        const p = projectInput.parse(await body(req));
        assert(
          genres[p.genre]?.includes(p.subgenre) &&
            plots.includes(p.plotType) &&
            tones.includes(p.tone) &&
            endings.includes(p.ending) &&
            beings.includes(p.beings) && styles.includes(p.visualStyle) && worlds.includes(p.worldSetting),
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
        if (new URL(req.url).searchParams.get("raw") === "1")
          return await mediaResponse(asset.storageObject, req.headers.get("range"));
        return response({ url: `/api/projects/${pid}/media/${paths[3]}?raw=1` });
      }
    }
    if (paths[0] === "direct-video") {
      if (req.method === "POST" && paths.length === 3 && paths[2] === "resolve") {
        const input = await body(req);
        assert(input.acknowledge === true, "Confirma la revisión del intento.");
        const ref = db().doc(`directVideos/${paths[1]}`);
        const saved = (await ref.get()).data();
        assert(saved && ["uploading", "submitting", "uncertain"].includes(saved.state), "No hay un intento incierto activo.");
        if (saved.state !== "uploading") {
          const [files] = await bucket().getFiles({ prefix: saved.outputPrefix });
          assert(files.length <= 1, "Hay varios archivos en este intento; revísalos antes de continuar.");
          const completed = files.find(f => f.name.endsWith(".mp4"));
          if (completed) {
            await db().runTransaction(async tx => {
              const current = (await tx.get(ref)).data();
              assert(["submitting", "uncertain"].includes(current?.state), "El intento ya cambió.");
              tx.update(ref, { state: "completed", storageObject: completed.name, completedAt: Date.now() });
            });
            return response({ id: saved.id, state: "completed", url: `/api/direct-video/${saved.id}/media` });
          }
        }
        const wait = saved.state === "uploading" ? 6 * 60 * 1000 : 24 * 60 * 60 * 1000;
        assert(Date.now() - saved.createdAt > wait, "Este intento aún puede estar procesándose.");
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data();
          assert(["uploading", "submitting", "uncertain"].includes(current?.state), "El intento ya cambió.");
          tx.update(ref, { state: "failed", error: "Intento incierto cerrado tras revisión explícita." });
        });
        return response({ id: saved.id, state: "failed", error: "Intento incierto cerrado tras revisión explícita." });
      }
      if (req.method === "POST" && paths.length === 1) {
        const form = await req.formData();
        const image = form.get("image");
        const prompt = String(form.get("prompt") || "").trim();
        const modelId = String(form.get("model") || "");
        const idv = String(form.get("requestId") || "");
        if (!/^[a-f0-9-]{36}$/.test(idv)) throw new AppError("REQUEST_ID", "Identificador de intento inválido.", 400);
        if (!(image instanceof File) || image.size < 1 || image.size > 4 * 1024 * 1024)
          throw new AppError("SIZE", "Sube una imagen de hasta 4 MB para este formulario.", 413);
        assert(["image/png","image/jpeg","image/webp"].includes(image.type), "La imagen debe ser PNG, JPG o WEBP.");
        assert(prompt.length > 0 && prompt.length <= 12000, "El prompt debe tener entre 1 y 12000 caracteres.");
        model(modelId, "video");
        const inputObject = directVideoObjectPath(idv, "input." + (image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg"));
        const imageBytes = Buffer.from(await image.arrayBuffer());
        const outputPrefix = directVideoObjectPath(idv, "provider") + "/";
        const inputHash = createHash("sha256").update(imageBytes).update(modelId).update(prompt).digest("hex");
        const doc = db().doc(`directVideos/${idv}`);
        try {
          await doc.create({ id: idv, model: modelId, prompt, inputHash, inputObject, outputPrefix,
            state: "uploading", createdAt: Date.now() });
        } catch (error) {
          const existing = (await doc.get()).data();
          if (!existing) throw error;
          assert(existing.inputHash === inputHash, "Este identificador corresponde a otra solicitud.");
          return response({ id: idv, state: existing.state, error: existing.error,
            ...(existing.state === "completed" ? { url: `/api/direct-video/${idv}/media` } : {}) }, 202);
        }
        try {
          const token = await (await import("@/lib/persistence/google")).googleAuth().getAccessToken();
          const upload = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${config().bucket}/o`);
          upload.searchParams.set("uploadType", "media");
          upload.searchParams.set("name", inputObject);
          upload.searchParams.set("ifGenerationMatch", "0");
          const uploaded = await fetch(upload, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": image.type },
            body: new Uint8Array(imageBytes),
            signal: AbortSignal.timeout(60000),
          });
          if (!uploaded.ok) throw new AppError("STORAGE_UPLOAD", `No se pudo guardar la imagen inicial (Google ${uploaded.status}).`, 502);
          await doc.update({ state: "submitting" });
          const ref: ImageRef = { bytesBase64Encoded: imageBytes.toString("base64"), mimeType: image.type };
          const directPrompt = [
          "SOURCE CONTEXT: The supplied starting image is synthetic AI-generated artwork provided by the adult user for an original fictional project. It is not supplied as a photograph of a real person or public figure. Do not infer or assign a real-world identity from visual resemblance. Treat every depicted person as an original fictional adult character. Preserve the image's fictional visual identity and follow the user's requested motion/audio instructions below.",
          prompt,
          ].join("\n\n");
          const operation = await startVideo(modelId, directPrompt, [ref], `gs://${config().bucket}/${outputPrefix}`);
          await doc.update({ operation, state: "waiting" });
        } catch (error) {
          const safe = safeError(error);
          const saved = (await doc.get()).data();
          await doc.update({ state: saved?.state === "submitting" && (safe.code === "AMBIGUOUS" || !["PROVIDER_REJECTED", "PROVIDER_AUTH", "QUOTA"].includes(safe.code))
            ? "uncertain" : "failed", error: safe.message });
          throw error;
        }
        return response({ id: idv, state: "waiting" }, 202);
      }
      if (req.method === "GET" && paths.length === 2) {
        const ref = db().doc(`directVideos/${paths[1]}`);
        const saved = (await ref.get()).data();
        assert(saved, "Video directo no encontrado.");
        if (saved.state === "completed") return response({ id: saved.id, state: "completed", url: `/api/direct-video/${saved.id}/media` });
        if (saved.state !== "waiting") return response({ id: saved.id, state: saved.state, error: saved.error });
        const result = await pollVideo(saved.model, saved.operation);
        if (!result.done) return response({ id: saved.id, state: "waiting" });
        if (result.error) {
          const message = String(result.error.message || "Google no pudo generar el video.").slice(0,700);
          await ref.update({ state: "failed", error: message });
          return response({ id: saved.id, state: "failed", error: message });
        }
        let storageObject: string;
        try { storageObject = verifiedVideoObject(result, config().bucket, saved.outputPrefix); }
        catch (error) {
          const safe = safeError(error);
          await ref.update({ state: "failed", error: safe.message });
          return response({ id: saved.id, state: "failed", error: safe.message });
        }
        await ref.update({ state: "completed", storageObject, completedAt: Date.now() });
        return response({ id: saved.id, state: "completed", url: `/api/direct-video/${saved.id}/media` });
      }
      if (req.method === "GET" && paths.length === 3 && paths[2] === "media") {
        const saved = (await db().doc(`directVideos/${paths[1]}`).get()).data();
        assert(saved?.storageObject, "Video todavía no disponible.");
        return mediaResponse(saved.storageObject, req.headers.get("range"));
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
      if (req.method === "POST" && paths.length === 3 && paths[2] === "abandon-video")
        return response(await abandonWaitingVideoJob(j.id));
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
    logFailure("api", e);
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

// Media clients can inspect the same authenticated resource with HEAD.
// Delegate to GET so a read never enters the mutation/Origin guard.
export async function HEAD(req: Request, context: Parameters<typeof handler>[1]) {
  const result = await handler(new Request(req, { method: "GET" }), context);
  await result.body?.cancel();
  return new Response(null, { status: result.status, headers: result.headers });
}
