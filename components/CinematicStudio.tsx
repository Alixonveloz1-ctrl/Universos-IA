"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODELS, MODELS } from "@/lib/models";
import type { CinematicAsset, CinematicFinalizeJob, CinematicProject } from "@/lib/cinematic/types";
import { cinematicImageCharacterIds, cinematicMissingApprovedVideos, currentCinematicVideo } from "@/lib/cinematic/types";
import {
  CINEMATIC_GENRES, CINEMATIC_STYLES, DEFAULT_CINEMATIC_GENRE,
  DEFAULT_CINEMATIC_SUBGENRE, cinematicGenre, cinematicStyle, cinematicSubgenre,
  type CinematicGenre, type CinematicVisualStyle,
} from "@/lib/cinematic/options";

type CinematicData = {
  project: CinematicProject;
  assets: CinematicAsset[];
  finalizeJob: CinematicFinalizeJob | null;
  generation: { id: string; state: string; kind?: string; role?: string; characterId?: string;
    segmentNumber?: number; error?: string } | null;
  recoverableFinalize: boolean;
};

type CinematicListItem = {
  id: string;
  title: string;
  concept: string;
  visualStyle?: CinematicVisualStyle;
  genre?: CinematicGenre;
  subgenre?: string;
  durationSeconds: number;
  createdAt: number;
  updatedAt: number;
  hasPlan: boolean;
  hasFinal: boolean;
};

async function cinematicApi(path = "", method = "GET", data?: unknown) {
  const paid = method === "POST" && /\/(plan|image|video)$/.test(path);
  const key = `cinematic:intent:${path}`;
  const requestId = paid ? (sessionStorage.getItem(key) || crypto.randomUUID()) : null;
  if (requestId) sessionStorage.setItem(key, requestId);
  const res = await fetch("/api/cinematic" + (path ? "/" + path : ""), {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    ...(data !== undefined ? { body: JSON.stringify(requestId ? { ...(data as object), requestId } : data) } : {}),
  });
  const result = await res.json();
  if (!res.ok) {
    if (paid && result.error?.code !== "AMBIGUOUS") sessionStorage.removeItem(key);
    throw new Error(result.error?.message || "No se pudo completar la operación cinematográfica.");
  }
  if (paid && !["submitting", "uncertain"].includes(result.state || result.run?.state)) sessionStorage.removeItem(key);
  return result;
}

function latest(assets: CinematicAsset[], predicate: (a: CinematicAsset) => boolean) {
  return assets.filter(predicate).sort((a, b) => b.createdAt - a.createdAt)[0];
}

function ModelSelect({ kind, value, change }: {
  kind: "text" | "image" | "video";
  value: string;
  change: (value: string) => void;
}) {
  return (
    <label>
      {kind === "text" ? "Director" : kind === "image" ? "Generador de imagen" : "Generador de video"}
      <select value={value} onChange={e => change(e.target.value)}>
        {Object.entries(MODELS)
          .filter(([, m]) => m.kind === kind)
          .map(([id, m]) => <option key={id} value={id}>{m.name}</option>)}
      </select>
    </label>
  );
}

export default function CinematicStudio() {
   const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<CinematicListItem[]>([]);
  const [data, setData] = useState<CinematicData | null>(null);
  const [concept, setConcept] = useState("");
  const [visualStyle, setVisualStyle] = useState<CinematicVisualStyle>("realistic");
  const [genre, setGenre] = useState<CinematicGenre>(DEFAULT_CINEMATIC_GENRE);
  const [subgenre, setSubgenre] = useState(DEFAULT_CINEMATIC_SUBGENRE);
  const [durationSeconds, setDurationSeconds] = useState<30 | 60 | 90>(30);
  const [language, setLanguage] = useState("Español");
  const [accent, setAccent] = useState("Latinoamericano");
  const [models, setModels] = useState<{ text: string; image: string; video: string }>({ ...DEFAULT_MODELS });
  const [motionNotes, setMotionNotes] = useState<Record<string, string>>({});
  const polling = useRef(false);
  const checkedFailedVideos = useRef(new Set<string>());
  const visibleProject = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    setItems(await cinematicApi());
  }, []);
  const loadProject = useCallback(async (id: string) => {
    const result = await cinematicApi(id);
    if (visibleProject.current === id) setData(result);
  }, []);

  useEffect(() => {
    let active = true;
    cinematicApi()
      .then(list => { if (active) setItems(list); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); }
    finally {
      setBusy(false);
      if (data?.project.id) void loadProject(data.project.id).catch(() => {});
    }
  };

  const pendingVideoIds = useMemo(
    () => data?.assets.filter(a => a.kind === "video" && a.state === "waiting" &&
      (a.planRevision || 0) === (data.project.planRevision || 0) &&
      a.inputRefs[0] === data.project.approvedImages[String(a.segmentNumber)]).map(a => a.id).sort().join(",") || "",
    [data],
  );
  const failedVideoIds = useMemo(
    () => data?.assets.filter(a => a.role === "segment-video" && a.state === "failed" && a.operation && a.outputPrefix && !a.storageObject &&
      (a.planRevision || 0) === (data.project.planRevision || 0) &&
      a.inputRefs[0] === data.project.approvedImages[String(a.segmentNumber)]).map(a => a.id).sort().join(",") || "",
    [data],
  );
  useEffect(() => {
    if (!data?.project.id || !failedVideoIds) return;
    let active = true;
    const projectId = data.project.id;
    const ids = failedVideoIds.split(",").filter(id => !checkedFailedVideos.current.has(`${projectId}:${id}`));
    if (!ids.length) return;
    ids.forEach(id => checkedFailedVideos.current.add(`${projectId}:${id}`));
    void (async () => {
      try {
        for (const id of ids) await cinematicApi(`${projectId}/videos/${id}/recover`, "POST", {});
        if (active && visibleProject.current === projectId) await loadProject(projectId);
      } catch (e) {
        if (active && visibleProject.current === projectId)
          setError(e instanceof Error ? e.message : "No se pudo consultar el video guardado.");
      }
    })();
    return () => { active = false; };
  }, [data?.project.id, failedVideoIds, loadProject]);
  const finalizing = !!data?.project.activeFinalizeJobId &&
    data.finalizeJob?.id === data.project.activeFinalizeJobId &&
    ["queued", "running"].includes(data.finalizeJob.state);
  useEffect(() => {
    if (!data?.project.id || (!pendingVideoIds && !finalizing && !data.generation)) return;
    const projectId = data.project.id;
    const timer = setInterval(() => {
      void (async () => {
        if (polling.current) return;
        polling.current = true;
        try {
          for (const id of pendingVideoIds.split(",").filter(Boolean))
            await cinematicApi(`${projectId}/videos/${id}`);
          await loadProject(projectId);
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo actualizar la generación.");
        } finally {
          polling.current = false;
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [data?.project.id, data?.generation, pendingVideoIds, finalizing, loadProject]);

  if (!data) {
    return (
      <>
        <section className="panel">
          <h2>Producción cinematográfica</h2>
          <p className="muted">
            Short drama vertical con montaje por planos, continuidad visual y sonora, voces canónicas y audio nativo de Veo.
          </p>
          <div className="grid">
            <label>
              Estilo visual
              <select value={visualStyle} onChange={e => setVisualStyle(e.target.value as CinematicVisualStyle)}>
                {CINEMATIC_STYLES.map(style => <option value={style.id} key={style.id}>{style.label}</option>)}
              </select>
            </label>
            <label>
              Género
              <select value={genre} onChange={e => {
                const selected = e.target.value as CinematicGenre;
                setGenre(selected);
                setSubgenre(cinematicGenre(selected).subgenres[0].id);
              }}>
                {CINEMATIC_GENRES.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Subgénero
              <select value={subgenre} onChange={e => setSubgenre(e.target.value)}>
                {cinematicGenre(genre).subgenres.map(option =>
                  <option value={option.id} key={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <label>
            Concepto (opcional)
            <textarea
              rows={6}
              maxLength={4000}
              value={concept}
              onChange={e => setConcept(e.target.value)}
              placeholder="Si tienes una historia, escríbela aquí. Si lo dejas vacío, el Director inventará una según el género y subgénero elegidos."
            />
          </label>
          <p className="muted">Tu concepto tiene prioridad sobre el género y subgénero si no coinciden.</p>
          <div className="grid">
            <label>
              Duración final
              <select value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value) as 30 | 60 | 90)}>
                <option value={30}>30 segundos</option>
                <option value={60}>60 segundos</option>
                <option value={90}>90 segundos</option>
              </select>
            </label>
            <label>
              Idioma
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option>Español</option>
                <option>English</option>
                <option>日本語</option>
              </select>
            </label>
            <label>
              Acento
              <input value={accent} onChange={e => setAccent(e.target.value)} maxLength={100} />
            </label>
            <ModelSelect kind="text" value={models.text} change={value => setModels(s => ({ ...s, text: value }))} />
            <ModelSelect kind="image" value={models.image} change={value => setModels(s => ({ ...s, image: value }))} />
            <ModelSelect kind="video" value={models.video} change={value => setModels(s => ({ ...s, video: value }))} />
          </div>
          <button
            className="primary wide"
            disabled={busy}
            onClick={() => void perform(async () => {
              const project = await cinematicApi("", "POST", {
                concept: concept.trim(),
                visualStyle,
                genre,
                subgenre,
                durationSeconds,
                language,
                accent: accent.trim() || "Neutral",
                models,
              });
              visibleProject.current = project.id;
              try {
                await cinematicApi(`${project.id}/plan`, "POST", {});
              } finally {
                await loadProject(project.id);
                await loadList();
              }
            })}
          >
            Crear producción cinematográfica
          </button>
        </section>

        {!!items.length && (
          <section>
            <h2>Producciones cinematográficas</h2>
            <div className="cards">
              {items.map(item => (
                <article className="card" key={item.id}>
                  <span className="badge">{item.durationSeconds} s</span>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.concept || `${cinematicGenre(item.genre).label} · ${cinematicSubgenre(item.genre, item.subgenre).label}`}</p>
                  <div className="actions">
                    <button onClick={() => void perform(async () => {
                      visibleProject.current = item.id;
                      checkedFailedVideos.current.clear();
                      await loadProject(item.id);
                    })}>Abrir</button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`¿Borrar «${item.title}» y todos sus activos cinematográficos?`)) return;
                        void perform(async () => {
                          await cinematicApi(item.id, "DELETE");
                          await loadList();
                        });
                      }}
                    >
                      Borrar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </>
    );
  }

  const { project, assets } = data;
  const plan = project.plan;
  const currentAssets = assets.filter(a => (a.planRevision || 0) === (project.planRevision || 0));
  const missingVideoNumbers = cinematicMissingApprovedVideos(project, assets);
  const staleWaitingIds = assets.filter(a => a.role === "segment-video" && a.state === "waiting" &&
    ((a.planRevision || 0) !== (project.planRevision || 0) ||
      a.inputRefs[0] !== project.approvedImages[String(a.segmentNumber)])).map(a => a.id);
  return (
    <>
      <section className="panel">
        <div className="actions">
          <button onClick={() => {
            visibleProject.current = null;
            checkedFailedVideos.current.clear();
            setData(null);
            void loadList();
          }}>← Producciones</button>
          <span className="badge">Cinemático · {project.durationSeconds} s</span>
        </div>
        <h1>{project.title}</h1>
        <p className="muted">{CINEMATIC_STYLES.find(style => style.id === cinematicStyle(project.visualStyle))?.label} · {cinematicGenre(project.genre).label} · {cinematicSubgenre(project.genre, project.subgenre).label}</p>
        {project.concept && <p>{project.concept}</p>}
        <details>
          <summary>Generadores de esta producción</summary>
          <div className="grid">
            <ModelSelect kind="text" value={project.models.text} change={value => void perform(async () => {
              await cinematicApi(project.id, "PATCH", { models: { ...project.models, text: value } });
              await loadProject(project.id);
            })} />
            <ModelSelect kind="image" value={project.models.image} change={value => void perform(async () => {
              await cinematicApi(project.id, "PATCH", { models: { ...project.models, image: value } });
              await loadProject(project.id);
            })} />
            <ModelSelect kind="video" value={project.models.video} change={value => void perform(async () => {
              await cinematicApi(project.id, "PATCH", { models: { ...project.models, video: value } });
              await loadProject(project.id);
            })} />
          </div>
          <p className="muted">El cambio se aplica a generaciones futuras. Los activos anteriores conservan el modelo con el que fueron creados.</p>
        </details>
        <button
          disabled={busy || !!data.generation}
          onClick={() => {
            if (plan && (assets.some(asset => (asset.planRevision || 0) === (project.planRevision || 0)) ||
              project.final) &&
              !window.confirm("Crear otra trama dejará fuera de uso las generaciones, aprobaciones y la película final de esta producción. ¿Continuar?")) return;
            void perform(async () => {
              await cinematicApi(`${project.id}/plan`, "POST", {});
              await loadProject(project.id);
            });
          }}
        >
          {plan ? (project.concept ? "Proponer otra versión" : "Proponer otra trama") : "Generar plan cinematográfico"}
        </button>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      {data.generation && <section className="panel">
        <p className="muted">Intento {data.generation.id}: {data.generation.state}. {data.generation.error}</p>
        {data.generation.state === "uncertain" || data.generation.state === "submitting" ?
          <button disabled={busy} onClick={() => {
            if (!window.confirm("Revisa la operación y los posibles cargos de Google antes de cerrar este intento. Un video incierto puede tardar hasta 24 horas en liberarse. ¿Continuar?")) return;
            void perform(async () => {
              await cinematicApi(`${project.id}/generations/${data.generation!.id}/resolve`, "POST", { acknowledge: true });
              const g = data.generation!;
              const path = g.role === "character" ? `${project.id}/characters/${g.characterId}/image`
                : g.role === "segment-image" ? `${project.id}/segments/${g.segmentNumber}/image`
                : g.role === "segment-video" ? `${project.id}/segments/${g.segmentNumber}/video`
                : `${project.id}/plan`;
              sessionStorage.removeItem(`cinematic:intent:${path}`);
              await loadProject(project.id);
            });
          }}>Reconciliar o cerrar intento</button> : null}
      </section>}
      {!!staleWaitingIds.length && <section className="panel">
        <p className="muted">Hay {staleWaitingIds.length} video(s) de aprobaciones anteriores pendientes en Google.</p>
        <button disabled={busy} onClick={() => void perform(async () => {
          for (const id of staleWaitingIds) await cinematicApi(`${project.id}/videos/${id}`);
          await loadProject(project.id);
        })}>Consultar operaciones anteriores</button>
      </section>}

      {plan && (
        <>
          <section className="panel">
            <h2>Dirección de producción</h2>
            <p><b>Premisa:</b> {plan.premise}</p>
            <p><b>Gancho:</b> {plan.hook}</p>
            <p><b>Cierre:</b> {plan.ending}</p>
            <h3>Lo que se filmará, toma por toma</h3>
            <p className="muted">Revisa estos hechos antes de generar imágenes y videos. Si falta una parte de la historia, puedes proponer otra versión del plan.</p>
            <ol className="storyboard">
              {plan.segments.map(segment => (
                <li key={segment.number}>
                  <b>{segment.durationSeconds} s · {segment.goal}</b>
                  <span>{segment.shots.map(shot => shot.action).join(" ")}</span>
                </li>
              ))}
            </ol>
            <details>
              <summary>Biblia visual</summary>
              <p>{plan.visualBible}</p>
              <p><b>Luz y color:</b> {plan.colorAndLighting}</p>
              <p><b>Cámara:</b> {plan.cameraLanguage}</p>
              <p><b>Montaje:</b> {plan.editingLanguage}</p>
            </details>
            <details>
              <summary>Biblia sonora</summary>
              <p><b>Identidad:</b> {plan.soundBible.identity}</p>
              <p><b>Música:</b> {plan.soundBible.musicPalette}</p>
              <p><b>Instrumentación:</b> {plan.soundBible.instrumentation}</p>
              <p><b>Ritmo:</b> {plan.soundBible.rhythmAndTempo}</p>
              <p><b>Ambiente:</b> {plan.soundBible.ambienceBed}</p>
              <p><b>Mezcla de diálogo:</b> {plan.soundBible.dialogueMix}</p>
              <p><b>Efectos:</b> {plan.soundBible.effectsLanguage}</p>
              <p><b>Continuidad:</b> {plan.soundBible.continuityRule}</p>
            </details>
          </section>

          <section>
            <h2>Referencias canónicas</h2>
            <div className="cards">
              {plan.characters.map(character => {
                const candidate = latest(currentAssets, a => a.role === "character" && a.characterId === character.id);
                const approvedId = project.approvedCharacters[character.id];
                const shown = candidate || assets.find(a => a.id === approvedId);
                return (
                  <article className="card" key={character.id}>
                    <h3>{character.name}</h3>
                    <p className="muted">{character.role} · {character.age}</p>
                    <p>{character.visualIdentity}</p>
                    {shown?.storageObject && (
                      <Image
                        unoptimized
                        src={`/api/cinematic/${project.id}/media/${shown.id}`}
                        alt={character.name}
                        width={450}
                        height={800}
                        className="media"
                      />
                    )}
                    <div className="actions">
                      <button
                      disabled={busy || !!data.generation}
                        onClick={() => void perform(async () => {
                          await cinematicApi(`${project.id}/characters/${character.id}/image`, "POST", {});
                          await loadProject(project.id);
                        })}
                      >
                        {candidate ? "Regenerar referencia" : "Generar referencia"}
                      </button>
                      {candidate && candidate.id !== approvedId && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void perform(async () => {
                            await cinematicApi(`${project.id}/assets/${candidate.id}/approve`, "POST", {});
                            await loadProject(project.id);
                          })}
                        >
                          Aprobar
                        </button>
                      )}
                    </div>
                    {approvedId && <p className="muted">✓ Referencia aprobada</p>}
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <h2>{project.shotLayout === "one-shot-per-video" ? "Tomas independientes" : "Bloques cinematográficos"}</h2>
            {plan.segments.map(segment => {
              const isShot = project.shotLayout === "one-shot-per-video";
              const imageCast = cinematicImageCharacterIds(segment, project.shotLayout);
              const label = isShot ? "toma" : "bloque";
              const approvedImageId = project.approvedImages[String(segment.number)];
              const approvedVideoId = project.approvedVideos[String(segment.number)];
              const imageCandidate = latest(currentAssets, a => a.role === "segment-image" &&
                a.segmentNumber === segment.number && a.inputRefs.length === imageCast.length &&
                imageCast.every((id, i) => a.inputRefs[i] === project.approvedCharacters[id]));
              const videoAttempts = currentAssets.filter(a => a.role === "segment-video" &&
                a.segmentNumber === segment.number && a.inputRefs[0] === approvedImageId)
                .sort((a, b) => b.createdAt - a.createdAt);
              const videoCandidate = currentCinematicVideo(project, assets, segment.number);
              const shownImage = imageCandidate || assets.find(a => a.id === approvedImageId);
              const castReady = imageCast.every(id => !!project.approvedCharacters[id]);
              return (
                <article className="clip" key={segment.number}>
                  <h3>{isShot ? "Toma" : "Bloque"} {segment.number} · {segment.durationSeconds} s</h3>
                  <p><b>Objetivo:</b> {segment.goal}</p>
                  <p><b>Imagen inicial:</b> {segment.openingFrameDirection}</p>
                  <p className="muted">{segment.location}</p>
                  <details>
                    <summary>{isShot ? "Encuadre y acción" : `Mapa de planos · ${segment.shots.length}`}</summary>
                    {segment.shots.map(shot => (
                      <p key={shot.id}>
                        <b>{shot.start}–{shot.end}s · {shot.shotType} · {shot.lensMm} mm · {shot.transition}</b><br />
                        {shot.action}
                        {shot.openingSubjects?.map(subject => (
                          <span key={subject.characterId}>
                            <br />
                            {plan.characters.find(c => c.id === subject.characterId)?.name || subject.characterId}: {
                              { left: "izquierda", center: "centro", right: "derecha" }[subject.screenSide]
                            }, {{ foreground: "primer plano", midground: "plano medio",
                              background: "fondo", "adjacent-offscreen": "junto al borde, fuera de cuadro" }[subject.depth]}; {
                              subject.faceVisible ? "rostro visible" : "rostro oculto"
                            }. {subject.visibleParts}
                          </span>
                        ))}
                        {shot.physicalContacts?.map((contact, i) => (
                          <span key={`${contact.actorId}-${contact.targetId}-${i}`}>
                            <br />
                            Contacto: {plan.characters.find(c => c.id === contact.actorId)?.name || contact.actorId} → {
                              plan.characters.find(c => c.id === contact.targetId)?.name || contact.targetId
                            }. {contact.contact} ({contact.atFrameZero ? "desde la imagen inicial" : "durante la toma"})
                          </span>
                        ))}
                      </p>
                    ))}
                  </details>
                  <details>
                    <summary>Continuidad audiovisual</summary>
                    <p><b>Entrada visual:</b> {segment.continuityIn}</p>
                    <p><b>Salida visual:</b> {segment.continuityOut}</p>
                    <p><b>Entrada sonora:</b> {segment.audioContinuityIn}</p>
                    <p><b>Salida sonora:</b> {segment.audioContinuityOut}</p>
                  </details>

                  {shownImage?.storageObject && (
                    <Image
                      unoptimized
                      src={`/api/cinematic/${project.id}/media/${shownImage.id}`}
                      alt={`Imagen inicial ${label} ${segment.number}`}
                      width={450}
                      height={800}
                      className="media"
                    />
                  )}
                  <div className="actions">
                    <button
                      disabled={busy || !!data.generation || !castReady}
                      title={castReady ? "" : `Aprueba las referencias de los personajes visibles en esta ${label}.`}
                      onClick={() => void perform(async () => {
                        await cinematicApi(`${project.id}/segments/${segment.number}/image`, "POST", {});
                        await loadProject(project.id);
                      })}
                    >
                      {imageCandidate ? "Regenerar imagen" : "Generar imagen inicial"}
                    </button>
                    {imageCandidate && imageCandidate.id !== approvedImageId && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void perform(async () => {
                          await cinematicApi(`${project.id}/assets/${imageCandidate.id}/approve`, "POST", {});
                          await loadProject(project.id);
                        })}
                      >
                        Aprobar imagen
                      </button>
                    )}
                  </div>
                  {approvedImageId && <p className="muted">✓ Imagen inicial aprobada</p>}

                  {videoCandidate?.state === "completed" && videoCandidate.storageObject && (
                    <div>
                      <video
                        className="media"
                        src={`/api/cinematic/${project.id}/media/${videoCandidate.id}`}
                        controls
                        playsInline
                        preload="metadata"
                      />
                      {videoCandidate.id === approvedVideoId ? <p className="muted">✓ Video aprobado</p> :
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void perform(async () => {
                            await cinematicApi(`${project.id}/assets/${videoCandidate.id}/approve`, "POST", {});
                            await loadProject(project.id);
                          })}
                        >Aprobar este video</button>}
                    </div>
                  )}
                  {videoCandidate?.state === "waiting" && <p className="muted">Veo está generando esta {label} con audio nativo…</p>}
                  {videoCandidate?.state === "failed" && <p className="error">{videoCandidate.error}</p>}
                  {videoCandidate?.state === "failed" && /prompt could not be submitted|sensitive words|Responsible AI/i.test(videoCandidate.error || "") &&
                    <p className="muted">Google rechazó la solicitud antes de generar el video. Revisa la acción de esta toma: repetir el mismo texto puede producir el mismo rechazo. Las versiones ya generadas siguen disponibles.</p>}
                  {videoAttempts.length >= 3 && <p className="muted">Varios intentos con la misma imagen inicial pueden repetir el mismo defecto. Si el movimiento sigue deformado, regenera y aprueba una nueva imagen inicial con una postura y un camino más claros antes de pedir otro video.</p>}
                  {videoCandidate?.state === "failed" && videoCandidate.operation && videoCandidate.outputPrefix &&
                    <button disabled={busy} onClick={() => void perform(async () => {
                      await cinematicApi(`${project.id}/videos/${videoCandidate.id}/recover`, "POST", {});
                      await loadProject(project.id);
                    })}>Buscar video generado sin regenerar</button>}
                  {videoCandidate && <details>
                    <summary>Ajustar movimiento de esta toma (opcional)</summary>
                    <label>
                      Describe en una frase qué debe corregirse en el siguiente intento. El ajuste se aplica solo a esta toma.
                      <textarea
                        maxLength={500}
                        value={motionNotes[`${project.id}:${segment.number}`] || ""}
                        onChange={e => setMotionNotes(current => ({ ...current,
                          [`${project.id}:${segment.number}`]: e.target.value }))}
                        placeholder="Ej.: Detenerse delante de la puerta; no atravesarla."
                      />
                    </label>
                  </details>}
                  <div className="actions">
                    <button
                      disabled={busy || !!data.generation || !approvedImageId || videoCandidate?.state === "waiting"}
                      onClick={() => void perform(async () => {
                        await cinematicApi(`${project.id}/segments/${segment.number}/video`, "POST", {
                          motionNote: motionNotes[`${project.id}:${segment.number}`] || "",
                        });
                        await loadProject(project.id);
                      })}
                    >
                      {videoCandidate ? "Regenerar video" : "Generar video"}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="panel">
            <h2>Película final</h2>
            <p className="muted">
              Une exclusivamente las versiones aprobadas, en orden, conservando el audio nativo de cada video.
            </p>
            <button
              className="primary wide"
              disabled={busy || !!data.generation || finalizing || !!project.activeFinalizeJobId || missingVideoNumbers.length > 0}
              onClick={() => void perform(async () => {
                await cinematicApi(`${project.id}/finalize`, "POST", {});
                await loadProject(project.id);
              })}
            >
              {finalizing ? "Ensamblando…" : `Ensamblar ${project.durationSeconds} segundos`}
            </button>
            {!!missingVideoNumbers.length && <p className="muted">Falta aprobar la versión actual del video de {missingVideoNumbers.length === 1 ? "la toma" : "las tomas"} {missingVideoNumbers.join(", ")}.</p>}
            {data.generation && <p className="muted">Resuelve la generación activa para ensamblar.</p>}
            {project.activeFinalizeJobId && !finalizing && <p className="muted">Hay un ensamblado pendiente; consulta o recupera ese trabajo antes de iniciar otro.</p>}
            {data.finalizeJob?.state === "failed" && <p className="error">{data.finalizeJob.error?.message}</p>}
            {data.finalizeJob?.dispatchState === "uncertain" && finalizing &&
              <p className="muted">El despacho del ensamblado es incierto. Se puede recuperar el mismo trabajo después de 70 minutos.</p>}
            {finalizing && data.finalizeJob && data.recoverableFinalize &&
              <button disabled={busy} onClick={() => {
                if (!window.confirm("La ejecución anterior pudo terminar. Revisa su estado antes de recuperar el mismo trabajo. ¿Continuar?")) return;
                void perform(async () => {
                  await cinematicApi(`${project.id}/finalize/${data.finalizeJob!.id}/recover`, "POST", { acknowledge: true });
                  await loadProject(project.id);
                });
              }}>Recuperar ensamblado</button>}
            {project.final && (
              <>
                <video
                  className="media"
                  src={`/api/cinematic/${project.id}/final`}
                  controls
                  playsInline
                  preload="metadata"
                />
                <a href={`/api/cinematic/${project.id}/final`} download={`${project.title}.mp4`}>Descargar MP4 final</a>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
