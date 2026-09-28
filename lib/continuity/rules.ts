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
      assert(s.plan?.clips.some(c => c.number === t.clipNumber && c.shots[0]?.id === t.entityId),
        "Cada clip utiliza solo su imagen inicial.");
    }
  }
  if (a.type === "images" && p.plan?.approvedAt) {
    canonicalReady(s);
    s.targets
      .filter((t) => t.kind === "image" && !t.approvedVersionId &&
        (t.role !== "shot" || s.plan?.clips.some(c => c.number === t.clipNumber && c.shots[0]?.id === t.entityId)))
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
      approvedImage(s, "shot", c.shots[0].id),
      "Aprueba la imagen inicial de este clip.",
    );
    if (c.characterIds.length > 1) {
      const opening = s.targets.find(x => x.role === "shot" && x.entityId === c.shots[0].id);
      const image = s.assets.find(x => x.id === opening?.approvedVersionId);
      const canonical = c.characterIds.map(id => s.targets.find(x => x.role === "character" && x.entityId === id)?.approvedVersionId);
      assert(canonical.every(id => id && image?.inputRefs.includes(id)),
        "La imagen inicial no usó las referencias aprobadas de todos los personajes del clip. Regenera y aprueba esa imagen antes de crear el video.");
    }
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
    const initial = targets.find(t => t.role === "shot" && t.clipNumber === target.clipNumber);
    if (video?.approvedVersionId && initial?.id === target.id) result.add(video.id);
  }
  // Canonical references affect the initial image and videos that consume it.
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
  // Every character who appears during this clip must have a reference in
  // the one opening frame; later camera cuts have no separate image input.
  const clip = target.role === "shot" ? s.plan?.clips.find(c => c.number === target.clipNumber) : null;
  const castIds = clip?.characterIds || shot?.characterIds || [];
  const limit = imageLimits(s.project.models.image).maxReferenceImages;
  assert(castIds.length <= limit,
    `Este clip tiene ${castIds.length} personajes y el modelo de imagen admite ${limit} referencias. Selecciona un modelo que admita a todos antes de generar la imagen inicial.`,
    "MODEL_REFERENCES");
  const selected =
    target.role === "shot"
      ? [
          ...castIds.map(id => s.targets.find(t => t.role === "character" && t.entityId === id)).filter((t): t is Target => !!t),
          ...(castIds.length < limit ? s.targets.filter(t => t.role === "location" && t.entityId === shot?.locationId) : []),
        ]
      : s.targets.filter((t) => t.id === target.id);
  const refs = selected.flatMap((t) =>
    t.approvedVersionId ? [t.approvedVersionId] : [],
  );
  const styleRef = characterStyleReference(s, target);
  if (styleRef && refs.length < limit && !refs.includes(styleRef.id)) refs.push(styleRef.id);
  assert(
    refs.length <= limit,
    `Esta toma necesita ${refs.length} referencias; el modelo de imagen admite ${limit}. Cambia explícitamente a un modelo compatible antes de generar.`,
    "MODEL_REFERENCES",
  );
  return refs;
}
