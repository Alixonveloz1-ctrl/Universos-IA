"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODELS, MODELS } from "@/lib/models";
import type { CinematicAsset, CinematicFinalizeJob, CinematicProject } from "@/lib/cinematic/types";

type CinematicData = {
  project: CinematicProject;
  assets: CinematicAsset[];
  finalizeJob: CinematicFinalizeJob | null;
};

type CinematicListItem = {
  id: string;
  title: string;
  concept: string;
  durationSeconds: number;
  createdAt: number;
  updatedAt: number;
  hasPlan: boolean;
  hasFinal: boolean;
};

async function cinematicApi(path = "", method = "GET", data?: unknown) {
  const res = await fetch("/api/cinematic" + (path ? "/" + path : ""), {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message || "No se pudo completar la operación cinematográfica.");
  return result;
}

function latest(assets: CinematicAsset[], predicate: (a: CinematicAsset) => boolean) {
  return assets.filter(predicate).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export default function CinematicStudio() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<CinematicListItem[]>([]);
  const [data, setData] = useState<CinematicData | null>(null);
  const [concept, setConcept] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<30 | 60 | 90>(30);
  const [language, setLanguage] = useState("Español");
  const [accent, setAccent] = useState("Latinoamericano");
  const [models, setModels] = useState({ ...DEFAULT_MODELS });

  const loadList = useCallback(async () => {
    setItems(await cinematicApi());
  }, []);
  const loadProject = useCallback(async (id: string) => {
    setData(await cinematicApi(id));
  }, []);

  useEffect(() => {
    void loadList().catch(e => setError(e.message));
  }, [loadList]);

  const perform = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); }
    finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const pendingVideoIds = useMemo(
    () => data?.assets.filter(a => a.kind === "video" && a.state === "waiting").map(a => a.id).sort().join(",") || "",
    [data?.assets],
  );
  const finalizing = !!data?.finalizeJob && ["queued", "running"].includes(data.finalizeJob.state);
  useEffect(() => {
    if (!data?.project.id || (!pendingVideoIds && !finalizing)) return;
    const projectId = data.project.id;
    const timer = setInterval(() => {
      void (async () => {
        try {
          for (const id of pendingVideoIds.split(",").filter(Boolean))
            await cinematicApi(`${projectId}/videos/${id}`);
          await loadProject(projectId);
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo actualizar la generación.");
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [data?.project.id, pendingVideoIds, finalizing, loadProject]);

  const modelSelect = (kind: "text" | "image" | "video", value: string, change: (value: string) => void) => (
    <label>
      {kind === "text" ? "Director" : kind === "image" ? "Generador de imagen" : "Generador de video"}
      <select value={value} onChange={e => change(e.target.value)}>
        {Object.entries(MODELS)
          .filter(([, m]) => m.kind === kind)
          .map(([id, m]) => <option key={id} value={id}>{m.name}</option>)}
      </select>
    </label>
  );

  if (!data) {
    return (
      <>
        <section className="panel">
          <h2>Producción cinematográfica</h2>
          <p className="muted">
            Short drama vertical con montaje por planos, continuidad visual y sonora, voces canónicas y audio nativo de Veo.
          </p>
          <label>
            Concepto
            <textarea
              rows={6}
              maxLength={4000}
              value={concept}
              onChange={e => setConcept(e.target.value)}
              placeholder="Describe la situación, conflicto o idea central. El Director construirá la producción completa."
            />
          </label>
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
            {modelSelect("text", models.text, value => setModels(s => ({ ...s, text: value })))}
            {modelSelect("image", models.image, value => setModels(s => ({ ...s, image: value })))}
            {modelSelect("video", models.video, value => setModels(s => ({ ...s, video: value })))}
          </div>
          <button
            className="primary wide"
            disabled={busy || concept.trim().length < 8}
            onClick={() => void perform(async () => {
              const project = await cinematicApi("", "POST", {
                concept: concept.trim(),
                durationSeconds,
                language,
                accent: accent.trim() || "Neutral",
                models,
              });
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
                  <p className="muted">{item.concept}</p>
                  <div className="actions">
                    <button onClick={() => void perform(() => loadProject(item.id))}>Abrir</button>
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
  const setProjectModel = (kind: "text" | "image" | "video", value: string) =>
    void perform(async () => {
      await cinematicApi(project.id, "PATCH", { models: { ...project.models, [kind]: value } });
      await loadProject(project.id);
    });

  return (
    <>
      <section className="panel">
        <div className="actions">
          <button onClick={() => { setData(null); void loadList(); }}>← Producciones</button>
          <span className="badge">Cinemático · {project.durationSeconds} s</span>
        </div>
        <h1>{project.title}</h1>
        <p>{project.concept}</p>
        <details>
          <summary>Generadores de esta producción</summary>
          <div className="grid">
            {modelSelect("text", project.models.text, value => setProjectModel("text", value))}
            {modelSelect("image", project.models.image, value => setProjectModel("image", value))}
            {modelSelect("video", project.models.video, value => setProjectModel("video", value))}
          </div>
          <p className="muted">El cambio se aplica a generaciones futuras. Los activos anteriores conservan el modelo con el que fueron creados.</p>
        </details>
        <button
          disabled={busy}
          onClick={() => {
            if (plan && !window.confirm("Regenerar el plan reiniciará las aprobaciones cinematográficas de esta producción. ¿Continuar?")) return;
            void perform(async () => {
              await cinematicApi(`${project.id}/plan`, "POST", {});
              await loadProject(project.id);
            });
          }}
        >
          {plan ? "Regenerar plan cinematográfico" : "Generar plan cinematográfico"}
        </button>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {plan && (
        <>
          <section className="panel">
            <h2>Dirección de producción</h2>
            <p><b>Premisa:</b> {plan.premise}</p>
            <p><b>Gancho:</b> {plan.hook}</p>
            <p><b>Cierre:</b> {plan.ending}</p>
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
                const candidate = latest(assets, a => a.role === "character" && a.characterId === character.id);
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
                        disabled={busy}
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
            <h2>Bloques cinematográficos</h2>
            {plan.segments.map(segment => {
              const imageCandidate = latest(assets, a => a.role === "segment-image" && a.segmentNumber === segment.number);
              const videoCandidate = latest(assets, a => a.role === "segment-video" && a.segmentNumber === segment.number);
              const approvedImageId = project.approvedImages[String(segment.number)];
              const approvedVideoId = project.approvedVideos[String(segment.number)];
              const shownImage = imageCandidate || assets.find(a => a.id === approvedImageId);
              const shownVideo = videoCandidate || assets.find(a => a.id === approvedVideoId);
              const castReady = segment.characterIds.every(id => !!project.approvedCharacters[id]);
              return (
                <article className="clip" key={segment.number}>
                  <h3>Bloque {segment.number} · {segment.durationSeconds} s</h3>
                  <p><b>Objetivo:</b> {segment.goal}</p>
                  <p className="muted">{segment.location}</p>
                  <details>
                    <summary>Mapa de planos · {segment.shots.length}</summary>
                    {segment.shots.map(shot => (
                      <p key={shot.id}>
                        <b>{shot.start}–{shot.end}s · {shot.shotType} · {shot.lensMm} mm · {shot.transition}</b><br />
                        {shot.action}
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
                      alt={`Imagen inicial bloque ${segment.number}`}
                      width={450}
                      height={800}
                      className="media"
                    />
                  )}
                  <div className="actions">
                    <button
                      disabled={busy || !castReady}
                      title={castReady ? "" : "Aprueba las referencias de todos los personajes de este bloque."}
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

                  {shownVideo?.storageObject && (
                    <video
                      className="media"
                      src={`/api/cinematic/${project.id}/media/${shownVideo.id}`}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  )}
                  {videoCandidate?.state === "waiting" && <p className="muted">Veo está generando este bloque con audio nativo…</p>}
                  {videoCandidate?.state === "failed" && <p className="error">{videoCandidate.error}</p>}
                  <div className="actions">
                    <button
                      disabled={busy || !approvedImageId || videoCandidate?.state === "waiting"}
                      onClick={() => void perform(async () => {
                        await cinematicApi(`${project.id}/segments/${segment.number}/video`, "POST", {});
                        await loadProject(project.id);
                      })}
                    >
                      {videoCandidate ? "Regenerar video" : "Generar video"}
                    </button>
                    {videoCandidate?.state === "completed" && videoCandidate.id !== approvedVideoId && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void perform(async () => {
                          await cinematicApi(`${project.id}/assets/${videoCandidate.id}/approve`, "POST", {});
                          await loadProject(project.id);
                        })}
                      >
                        Aprobar video
                      </button>
                    )}
                  </div>
                  {approvedVideoId && <p className="muted">✓ Video aprobado</p>}
                </article>
              );
            })}
          </section>

          <section className="panel">
            <h2>Película final</h2>
            <p className="muted">
              Une exclusivamente las versiones aprobadas, en orden, conservando el audio nativo de cada bloque.
            </p>
            <button
              className="primary wide"
              disabled={busy || finalizing || plan.segments.some(s => !project.approvedVideos[String(s.number)])}
              onClick={() => void perform(async () => {
                await cinematicApi(`${project.id}/finalize`, "POST", {});
                await loadProject(project.id);
              })}
            >
              {finalizing ? "Ensamblando…" : `Ensamblar ${project.durationSeconds} segundos`}
            </button>
            {data.finalizeJob?.state === "failed" && <p className="error">{data.finalizeJob.error?.message}</p>}
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
