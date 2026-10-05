// Full UI journey with an explicitly SIMULATED API. Provider quality, IAM and
// durable Google storage are NOT verified by this test. Media is synthetic.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { snapshot } from "../fixtures";
import type { Narrative } from "../../lib/types";

test("SIMULATED complete journey: story, canon, eight sequential clips, export and reload", async ({
  page,
}) => {
  test.setTimeout(120000);
  const dir = await mkdtemp(path.join(tmpdir(), "universos-e2e-"));
  try {
    const media = path.join(dir, "synthetic.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=purple:s=90x160:r=24:d=8",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=8",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      media,
    ]);
    const full = snapshot(),
      s = snapshot();
    delete s.project.story;
    delete s.project.bible;
    delete s.project.plan;
    delete s.project.selectedIdeaId;
    s.targets = [];
    s.assets = [];
    s.bible = null;
    s.plan = null;
    s.observed = {};
    const narratives: Narrative[] = [];
    const exports: {
      id: string;
      createdAt: number;
      approvedClipVersionIds: string[];
    }[] = [];
    const calls: string[] = [];
    await page.route("**/test-media.mp4", (route) =>
      route.fulfill({ path: media, contentType: "video/mp4" }),
    );
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname.slice(5),
        method = req.method();
      let body: unknown = { ok: true };
      if (p === "catalog") body = { defaults: s.project.models };
      else if (p === "universes")
        body = [{ id: "universe", ...s.project.universeSnapshot }];
      else if (p === "projects")
        body = [{ id: "test", title: s.project.title, stage: s.project.stage }];
      else if (p === "projects/test" && method === "PATCH") {
        const input = req.postDataJSON();
        expect(input.expectedRevision).toBe(s.project.revision);
        if (input.selectedIdeaId)
          s.project.selectedIdeaId = input.selectedIdeaId;
        if (input.kind) {
          const kind = input.kind as Narrative["kind"];
          s.project[kind] = {
            id: kind + "-approved",
            kind,
            data: input.data,
            sourceRevision: s.project.revision,
            createdAt: Date.now(),
            approvedAt: input.approve ? Date.now() : 0,
          };
          if (kind === "bible") {
            s.bible = input.data;
            s.targets = full.targets
              .filter((t) => ["character", "location"].includes(t.role))
              .map((t) => ({ ...t, approvedVersionId: undefined }));
          }
          if (kind === "plan") {
            s.plan = input.data;
            s.targets.push(
              ...full.targets
                .filter((t) => ["clip", "shot"].includes(t.role))
                .map((t) => ({ ...t, approvedVersionId: undefined })),
            );
          }
        }
        s.project.revision++;
      } else if (p === "projects/test/actions") {
        const input = req.postDataJSON();
        calls.push(input.type);
        if (["story", "bible", "plan"].includes(input.type)) {
          const kind = input.type as Narrative["kind"];
          narratives.push({
            ...full.project[kind]!,
            id: "candidate-" + kind,
            approvedAt: undefined,
            createdAt: Date.now(),
          });
        } else if (["image", "images", "video"].includes(input.type)) {
          const targets =
            input.type === "images"
              ? s.targets.filter(
                  (t) => t.kind === "image" && !t.approvedVersionId,
                )
              : s.targets.filter((t) => t.id === input.targetId);
          for (const t of targets) {
            const generated = structuredClone(full.assets.find((a) => a.targetId === t.id)!);
            s.assets.push(generated);
            t.approvedVersionId = generated.id;
            if (t.kind === "video") s.observed[t.id] = { ...((full.observed[t.id] || {}) as Record<string, unknown>), versionId: generated.id };
          }
        } else if (input.type === "finalize") {
          expect(
            s.targets.filter((t) => t.kind === "video" && t.approvedVersionId),
          ).toHaveLength(8);
          exports.push({
            id: "export1",
            createdAt: Date.now(),
            approvedClipVersionIds: s.targets
              .filter((t) => t.kind === "video")
              .map((t) => t.approvedVersionId!),
          });
        }
        body = { jobId: "simulated", state: "completed" };
      } else if (/^projects\/test\/targets\/.+\/approve$/.test(p)) {
        const input = req.postDataJSON(),
          t = s.targets.find((t) => t.id === p.split("/")[3])!;
        expect(input.expectedRevision).toBe(s.project.revision);
        t.approvedVersionId = input.versionId;
        if (t.kind === "video")
          s.observed[t.id] = { ...input.observed, versionId: input.versionId };
        s.project.revision++;
      } else if (p.startsWith("projects/test/media/")) {
        const id = p.split("/").at(-1);
        body = {
          url:
            s.assets.find((a) => a.id === id)?.kind === "image"
              ? "/universos-hero.png"
              : "/test-media.mp4",
        };
      } else if (p === "projects/test")
        body = { ...s, narratives, exports, job: null };
      else if (p !== "session") {
        await route.fulfill({
          status: 404,
          json: { error: { message: "Unmocked test route" } },
        });
        return;
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Prueba simulada/ }).click();
    await page
      .getByRole("button", { name: "Elegir", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Desarrollar historia", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await page.getByRole("button", { name: "Biblia", exact: true }).click();
    await page
      .getByRole("button", { name: "Generar biblia", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Generar personajes pendientes",
        exact: true,
      })
      .click();
    await expect(page.getByText("Lista · en uso", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Preparar guion de 64 segundos",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generar imágenes pendientes", exact: true })
      .click();
    for (let i = 0; i < 8; i++) {
      const clip = page.locator("section.clip").nth(i);
      await clip
        .getByRole("button", { name: "Generar clip", exact: true })
        .click();
      const player = clip.locator("video");
      await expect(player).toBeVisible();
      await expect
        .poll(() =>
          player.evaluate((video: HTMLVideoElement) => video.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await expect(clip.getByText("Lista · en uso", { exact: true })).toHaveCount(2);
    }
    await page.getByRole("button", { name: "Final", exact: true }).click();
    await page
      .getByRole("button", { name: "Unir los ocho clips", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /Exportación/ }),
    ).toBeVisible();
    expect(calls.filter((c) => c === "video")).toHaveLength(8);
    expect(calls.at(-1)).toBe("finalize");
    await page.reload();
    await page.getByRole("button", { name: /Prueba simulada/ }).click();
    await page.getByRole("button", { name: "Final", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Exportación/ }),
    ).toBeVisible();
    expect(calls.filter((c) => c === "finalize")).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
