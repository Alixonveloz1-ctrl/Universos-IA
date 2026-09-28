import { imageLimits } from "../models";
import { assert } from "../errors";
import type { Action } from "../schemas";
import type { Snapshot, Target } from "../types";
function approvedImage(s: Snapshot, role: Target["role"], entityId: string) {
  const t = s.targets.find((x) => x.role === role && x.entityId === entityId);
  return (
    t &&
    !t.needsReview &&
    s.assets.some(
      (a) =>
        a.id === t.approvedVersionId &&
        a.targetId === t.id &&
        a.kind === "image",
    )
  );
}
function canonicalReady(s: Snapshot) {
  assert(s.project.bible?.approvedAt && s.bible, "Aprueba la biblia.");
  assert(
    s.bible.characters.every((c) => approvedImage(s, "character", c.id)) &&
      s.bible.locations.every((l) => approvedImage(s, "location", l.id)),
    "Aprueba las referencias canónicas.",
  );
}
export function prerequisites(s: Snapshot, a: Action) {
  const p = s.project;
  assert(!p.nextChapterId, "Este capítulo ya tiene continuación y se conserva como historial.");
  assert(
    p.revision === a.expectedRevision,
    "El proyecto cambió. Actualiza antes de continuar.",
    "REVISION",
  );
  if (a.type === "story")
    assert(
      p.ideas.some((i) => i.id === p.selectedIdeaId),
      "Elige una historia de las propuestas actuales.",
    );
  if (a.type === "ideas")
    assert(!p.selectedIdeaId, "Ya elegiste una historia. Las otras propuestas están descartadas.");
  if (a.type === "bible") assert(p.story?.approvedAt, "Aprueba la historia.");
  if (a.type === "plan") {
    assert(p.bible?.approvedAt, "Aprueba la biblia.");
    canonicalReady(s);
  }
  if (a.type === "image" || a.type === "images")
    assert(p.bible?.approvedAt, "Aprueba la biblia.");
  if (a.type === "image") {
    const t = s.targets.find((t) => t.id === a.targetId);
    assert(t && t.kind === "image", "Imagen no encontrada.");
    imageReferenceIds(s, t);
    if (t.role === "shot") {
      assert(p.plan?.approvedAt, "Aprueba el guion.");
      canonicalReady(s);
    }
  }
  if (a.type === "images" && p.plan?.approvedAt) {
    canonicalReady(s);
    s.targets
      .filter((t) => t.kind === "image" && !t.approvedVersionId)
      .forEach((t) => imageReferenceIds(s, t));
  }
  if (a.type === "video") {
    assert(p.plan?.approvedAt, "Aprueba el guion.");
    canonicalReady(s);
    const t = s.targets.find((t) => t.id === a.targetId);
    assert(t && t.kind === "video", "Clip no encontrado.");
    const n = t.clipNumber!;
    const c = s.plan!.clips[n - 1];
    assert(c, "Clip sin guion");
    assert(
      c.shots.every((shot) => approvedImage(s, "shot", shot.id)),
      "Aprueba las imágenes y resuelve sus revisiones.",
    );
    if (n > 1) {
      const prev = s.targets.find(
        (x) => x.role === "clip" && x.clipNumber === n - 1,
      );
      assert(
        prev?.approvedVersionId && !prev.needsReview,
        "Aprueba y revisa el clip anterior.",
      );
      assert(
        (s.observed[prev.id] as { versionId?: string } | undefined)
          ?.versionId === prev.approvedVersionId,
        "Falta el estado observado del clip anterior.",
      );
    }
  }
  if (a.type === "finalize") {
    assert(
      p.story?.approvedAt && p.bible?.approvedAt && p.plan?.approvedAt,
      "Aprueba historia, biblia y guion antes del montaje.",
    );
    const clips = s.targets
      .filter((t) => t.kind === "video")
      .sort((a, b) => a.clipNumber! - b.clipNumber!);
    assert(
      clips.length === 8 &&
        clips.every(
          (t, i) =>
            t.clipNumber === i + 1 &&
            t.approvedVersionId &&
            !t.needsReview &&
            (s.observed[t.id] as { versionId?: string } | undefined)
              ?.versionId === t.approvedVersionId,
        ),
      "Necesitas ocho clips aprobados y sin conflictos.",
    );
    assert(
      !s.targets.some((t) => t.needsReview),
      "Resuelve las revisiones pendientes.",
    );
  }
}
export function affected(
  target: Target,
  targets: Target[],
  assets: Snapshot["assets"],
  oldVersion: string | undefined,
) {
  const result = new Set<string>();
  if (!oldVersion) return result;
  for (const t of targets) {
    const asset = assets.find((a) => a.id === t.approvedVersionId);
    if (
      asset?.inputRefs.includes(oldVersion) ||
      asset?.sourceRevisions.previousClip === oldVersion
    )
      result.add(t.id);
  }
  if (target.role === "shot") {
    const video = targets.find(
      (t) => t.role === "clip" && t.clipNumber === target.clipNumber,
    );
    if (video?.approvedVersionId) result.add(video.id);
  }
  // Canonical references affect their storyboard and the videos directed by it,
  // even when Veo used only the first storyboard image as its physical input.
  if (target.role === "character" || target.role === "location") {
    for (const shot of targets.filter((t) => t.role === "shot" && result.has(t.id))) {
      const video = targets.find((t) => t.role === "clip" && t.clipNumber === shot.clipNumber);
      if (video?.approvedVersionId) result.add(video.id);
    }
  }
  if (target.kind === "video") {
    const next = targets.find(
      (t) => t.kind === "video" && t.clipNumber === target.clipNumber! + 1,
    );
    if (next?.approvedVersionId) result.add(next.id);
  }
  return result;
}

// A previously approved character anchors rendering, never another identity.
// Use approval evidence, not an unreviewed generation that may be a collage.
export function characterStyleReference(s: Snapshot, target: Target) {
  if (target.role !== "character" && target.role !== "location") return undefined;
  return s.targets
    .filter(t => t.role === "character" && t.id !== target.id && !t.needsReview && t.approvedVersionId)
    .flatMap(t => {
      // Approval is stored on the target; immutable assets retain candidate status.
      const asset = s.assets.find(a => a.id === t.approvedVersionId && a.targetId === t.id && a.kind === "image" && a.status !== "rejected");
      return asset ? [asset] : [];
    })
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
}

export function imageReferenceIds(s: Snapshot, target: Target) {
  const shot =
    target.role === "shot"
      ? s.plan?.clips
          .flatMap((c) => c.shots)
          .find((sh) => sh.id === target.entityId)
      : null;
  // A two-person exchange needs both identities even in a reaction close-up.
  // The shot's characterIds can name just the on-camera speaker.
  const clip = target.role === "shot" ? s.plan?.clips.find(c => c.number === target.clipNumber) : null;
  const castIds = clip?.characterIds.length === 2 ? clip.characterIds : shot?.characterIds || [];
  const selected =
    target.role === "shot"
      ? s.targets.filter(
          (t) =>
            (t.role === "character" &&
              castIds.includes(t.entityId)) ||
            (t.role === "location" && t.entityId === shot?.locationId),
        )
      : s.targets.filter((t) => t.id === target.id);
  const refs = selected.flatMap((t) =>
    t.approvedVersionId ? [t.approvedVersionId] : [],
  );
  const limit = imageLimits(s.project.models.image).maxReferenceImages;
  const styleRef = characterStyleReference(s, target);
  if (styleRef && refs.length < limit && !refs.includes(styleRef.id)) refs.push(styleRef.id);
  assert(
    refs.length <= limit,
    `Esta toma necesita ${refs.length} referencias; el modelo de imagen admite ${limit}. Cambia explícitamente a un modelo compatible antes de generar.`,
    "MODEL_REFERENCES",
  );
  return refs;
}
