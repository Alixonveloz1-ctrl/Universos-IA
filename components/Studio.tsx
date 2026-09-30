"use client";
import Image from "next/image";
import { useEffect, useState, useCallback, useRef } from "react";
import type { Asset, Job, Narrative, Snapshot, Target } from "@/lib/types";
import {
  character,
  location,
  shot,
  state,
  clip,
  story,
  bible as bibleSchema,
  validatePlan,
  type Bible,
} from "@/lib/schemas";
import { z } from "zod";
import { prerequisites } from "@/lib/continuity/rules";
import type { Action } from "@/lib/schemas";
import {
  genres,
  plots,
  tones,
  endings,
  beings,
  styles,
  worlds,
} from "@/lib/director/catalog";
import { MODELS, DEFAULT_MODELS } from "@/lib/models";
import { TELENOVELA_STYLE, TELENOVELA_DESCRIPTION } from "@/lib/director/styles";
type Data = Snapshot & {
  narratives: Narrative[];
  exports: {
    id: string;
    approvedClipVersionIds: string[];
    createdAt: number;
  }[];
  job:
    | (Job & {
        hasOperation?: boolean;
        closedAt?: number;
        resumable?: boolean;
        reconciledAt?: number;
        blocksNewJob?: boolean;
      })
    | null;
};
function generationBlock(data: Data, type: Action["type"], targetId?: string) {
  try {
    prerequisites(data, {
      type,
      targetId,
      expectedRevision: data.project.revision,
      requestId: "",
      instructions: "",
    });
    return "";
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Completa las etapas anteriores.";
  }
}
async function api(url: string, method = "GET", data?: unknown) {
  const res = await fetch("/api/" + url, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await res.json();
  if (!res.ok)
    throw new Error(
      result.error?.message || "No se pudo completar la operación.",
    );
  return result;
}
const labels: Record<string, string> = {
  note: "Nota de continuidad observada",
  premise: "Premisa",
  conflict: "Conflicto",
  arc: "Arco",
  ending: "Cierre",
  characters: "Personajes",
  locations: "Escenarios",
  name: "Nombre",
  role: "Papel",
  material: "Especie o material",
  face: "Rostro",
  silhouette: "Silueta",
  color: "Color",
  texture: "Textura",
  hair: "Cabello",
  eyes: "Ojos",
  wardrobe: "Vestuario",
  accessories: "Accesorios",
  gestures: "Gestos",
  personality: "Personalidad",
  desire: "Deseo",
  fear: "Miedo",
  secret: "Secreto",
  relationships: "Relaciones",
  voice: "Voz",
  language: "Idioma",
  accent: "Acento",
  timbre: "Timbre",
  register: "Registro",
  rhythm: "Ritmo",
  energy: "Energía",
  diction: "Dicción",
  expression: "Expresión",
  visualPrompt: "Dirección visual",
  lockedTraits: "Rasgos fijos",
  allowedVariations: "Variaciones permitidas",
  layout: "Distribución",
  scale: "Escala",
  entrances: "Entradas",
  lighting: "Luz",
  time: "Hora",
  weather: "Clima",
  persistentObjects: "Objetos persistentes",
  props: "Objetos",
  clips: "Clips",
  goal: "Objetivo",
  continuityIn: "Estado inicial",
  plannedEndState: "Estado final previsto",
  shots: "Tomas",
  dialogue: "Diálogo",
  soundDirection: "Dirección de sonido",
  framing: "Encuadre",
  action: "Acción",
  text: "Texto hablado",
  intention: "Intención",
  start: "Inicio (s)",
  end: "Final (s)",
  posture: "Postura",
  emotion: "Emoción",
  knowledge: "Conocimiento",
  heldObjects: "Objetos en mano",
  damage: "Daños",
  lastAction: "Última acción",
  nextAction: "Siguiente acción",
  ambience: "Ambiente",
  effects: "Efectos",
  music: "Música",
  constraints: "Indicaciones",
  startMode: "Inicio del clip",
  location: "Ubicación",
};
function emptyFields(schema: Record<string, unknown>): unknown {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(
        schema.properties as Record<string, Record<string, unknown>>,
      ).map(([k, v]) => [k, k === "id" ? crypto.randomUUID() : emptyFields(v)]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 0;
  return "";
}
function Editor({
  value,
  onChange,
  name = "",
  bible,
  observed = false,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  name?: string;
  bible?: Bible | null;
  observed?: boolean;
}) {
  const choices = name === "locationId" ? bible?.locations : bible?.characters;
  if (["characterId", "locationId"].includes(name))
    return (
      <label>
        {name === "characterId" ? "Personaje" : "Escenario"}
        <select
          value={String(value || "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecciona</option>
          {choices?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    );
  if (name === "characterIds" && Array.isArray(value))
    return (
      <fieldset>
        <legend>Personajes presentes</legend>
        {bible?.characters.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={value.includes(c.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, c.id]
                    : value.filter((v) => v !== c.id),
                )
              }
            />
            {c.name}
          </label>
        ))}
      </fieldset>
    );
  if (Array.isArray(value)) {
    const schema =
      name === "characters"
        ? observed
          ? state.shape.characters.element
          : character
        : name === "locations"
          ? location
          : name === "shots"
            ? shot
            : name === "dialogue"
              ? clip.shape.dialogue.element
              : null;
    return (
      <div className="nested">
        <h4>{labels[name] || name}</h4>
        {value.map((v, i) => (
          <div key={typeof v === "object" && v?.id ? v.id : i}>
            <Editor
              value={v}
              bible={bible}
              observed={
                observed || ["continuityIn", "plannedEndState"].includes(name)
              }
              name={typeof v === "object" ? String(i + 1) : name}
              onChange={(x) =>
                onChange(value.map((old, n) => (n === i ? x : old)))
              }
            />
            {name !== "clips" && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, n) => n !== i))}
              >
                Quitar {i + 1}
              </button>
            )}
          </div>
        ))}
        {name !== "clips" && (
          <button
            type="button"
            onClick={() =>
              onChange([
                ...value,
                schema ? emptyFields(z.toJSONSchema(schema)) : "",
              ])
            }
          >
            Añadir {labels[name]?.toLowerCase() || "elemento"}
          </button>
        )}
      </div>
    );
  }
  if (value && typeof value === "object")
    return (
      <div className="fields">
        {Object.entries(value)
          .filter(
            ([k]) =>
              !["id", "number", "durationSeconds", "versionId"].includes(k),
          )
          .map(([k, v]) => (
            <Editor
              key={k}
              name={k}
              value={v}
              bible={bible}
              observed={
                observed || ["continuityIn", "plannedEndState"].includes(k)
              }
              onChange={(x) => onChange({ ...value, [k]: x })}
            />
          ))}
      </div>
    );
  return (
    <label>
      {labels[name] || name}
      {typeof value === "number" ? (
        <input
          type="number"
          value={value}
          min={0}
          max={8}
          step="0.1"
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : name === "startMode" ? (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="storyboard">Imagen inicial propia del clip</option>
          <option value="previousFrame">Continuidad anterior · imagen inicial propia</option>
        </select>
      ) : (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Media({
  projectId,
  version,
  kind,
}: {
  projectId: string;
  version: string;
  kind: "image" | "video";
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api(`projects/${projectId}/media/${version}`)
        .then((r) => {
          if (active) {
            setUrl(r.url);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 4 * 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, version]);
  if (error) return <p className="error">{error}</p>;
  if (!url) return <p className="muted">Cargando archivo…</p>;
  return kind === "image" ? (
    <Image
      unoptimized
      width={720}
      height={1280}
      className="media"
      src={url}
      alt="Versión generada para revisión"
    />
  ) : (
    <>
      <video
        className="media"
        src={url}
        controls
        playsInline
        preload="metadata"
      />
      <a href={url} download>
        Descargar MP4
      </a>
    </>
  );
}
export default function Studio() {
  const busyRef = useRef(false);
  const [recoveryNote, setRecoveryNote] = useState("");
  const showRecoveredStory = useRef<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [session, setSession] = useState(false),
    [checked, setChecked] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [projects, setProjects] = useState<
      { id: string; title: string; stage: string; universeId?: string; universeName?: string; chapterNumber?: number }[]
    >([]),
    [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState("Historia");
  const [selection, setSelection] = useState({
    concept: "",
    beings: "Frutas",
    visualStyle: "3D Viral Estilizado",
    worldSetting: "Mundo real actual",
    genre: "Drama",
    subgenre: "Familiar",
    plotType: "Traición",
    tone: "Emocional",
    ending: "Giro final",
    language: "Español",
    accent: "Latinoamericano",
    models: DEFAULT_MODELS,
  });
  const refresh = useCallback(async (pid?: string) => {
    const p = await api("projects");
    setProjects(p);
    if (pid) setData(await api("projects/" + pid));
  }, []);
  const perform = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let live = true;
    api("session")
      .then(() => {
        if (live) {
          setSession(true);
          void api("catalog")
            .then((c) => setSelection((s) => ({ ...s, models: c.defaults })))
            .catch((e) => setError(e.message));
          void refresh().catch((e) => setError(e.message));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  const pid = data?.project.id;
  useEffect(() => {
    if (!showRecoveredStory.current || tab !== "Historia" ||
      !data?.narratives.some(n => n.kind === "story" && n.id === showRecoveredStory.current)) return;
    const panel = document.getElementById("historia-generada");
    panel?.querySelector("details")?.setAttribute("open", "");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    showRecoveredStory.current = null;
  }, [data, tab]);
  useEffect(() => {
    if (!pid) return;
    const timer = setInterval(() => {
      api("projects/" + pid)
        .then(setData)
        .catch((e) => setError(e.message));
    }, 5000);
    return () => clearInterval(timer);
  }, [pid]);
  const patch = async (change: unknown) => {
    await api("projects/" + pid, "PATCH", {
      expectedRevision: data!.project.revision,
      ...(change as object),
    });
    await refresh(pid);
  };
  const saveNarrative = async (change: unknown) => {
    let saved = false;
    await perform(async () => {
      await patch(change);
      saved = true;
      const approval = change as { kind?: string; approve?: boolean };
      if (approval.approve && approval.kind === "story") setTab("Biblia");
    });
    return saved;
  };
  const generate = async (
    type: string,
    targetId?: string,
    instructions = "",
    optionId?: string,
  ) => {
    const result = await api(`projects/${pid}/actions`, "POST", {
      type,
      expectedRevision: data!.project.revision,
      requestId: crypto.randomUUID(),
      instructions,
      ...(targetId ? { targetId } : {}),
      ...(optionId ? { optionId } : {}),
    });
    await refresh(pid);
    if (result.warning) setError(result.warning);
  };
  const active = !!data?.project.nextChapterId || (!!data?.job &&
    (data.job.blocksNewJob ??
      !["completed", "failed", "stopped"].includes(data.job.state)));
  const field = (
    label: string,
    value: string,
    set: (s: string) => void,
    options: string[],
    labels: Record<string, string> = {},
  ) => (
    <label>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        {options.map((x) => (
          <option key={x} value={x}>{labels[x] || x}</option>
        ))}
      </select>
    </label>
  );
  if (!checked)
    return (
      <main>
        <p>Abriendo Universos IA…</p>
      </main>
    );
  if (!session)
    return (
      <main>
        <form
          className="panel login"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await api("session", "POST", { password });
              setPassword("");
              setSession(true);
              const catalog = await api("catalog");
              setSelection((s) => ({ ...s, models: catalog.defaults }));
              await refresh();
            });
          }}
        >
          <div className="mark">◉</div>
          <h1>Universos IA</h1>
          <p className="muted">Tu espacio privado para crear historias.</p>
          <label>
            Clave de acceso
            <input
              name="password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <p className="muted">
            La sesión permanece abierta durante 30 días en este navegador.
          </p>
          <button className="primary wide" disabled={busy}>
            Entrar
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    );
  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">◉</span>
          <span>
            Universos IA<small>Microhistorias que cobran vida</small>
          </span>
        </div>
        <div className="actions">
          <button onClick={() => setData(null)}>Mis proyectos</button>
          <button
            onClick={() =>
              void perform(async () => {
                await api("session", "DELETE");
                setSession(false);
                setData(null);
              })
            }
          >
            Salir
          </button>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!data ? (
        <>
          <section className="hero">
            <Image
              src="/universos-hero.png"
              alt="Reina de las frutas en un mundo de fantasía"
              fill
              priority
              sizes="(max-width: 640px) 100vw, 1100px"
              className="hero-art"
            />
            <div className="hero-copy">
              <h1>
                Crea tu
                <br />
                <span>próxima historia</span>
              </h1>
              <p className="muted">
                Tú eliges el mundo.
                <br />
                La IA crea la magia.
              </p>
              <div className="hero-features">
                <span>
                  <b>ϟ</b>Historias de
                  <br />
                  64 segundos
                </span>
                <span>
                  <b>▣</b>Con audio
                  <br />
                  nativo de Veo
                </span>
                <span>
                  <b>✦</b>Personajes
                  <br />
                  originales
                </span>
              </div>
            </div>
          </section>
          <section className="panel">
            <h2>Forjar una nueva historia</h2>
            <p className="muted">
              Define el estilo y recibe tres propuestas originales.
            </p>
            <p className="muted">El universo se creará automáticamente al elegir una de las tres historias.</p>
            <label style={{ display: "block", marginTop: 20 }}>
              Concepto de la historia (opcional)
              <textarea
                value={selection.concept}
                onChange={(e) => setSelection({ ...selection, concept: e.target.value })}
                maxLength={1000}
                rows={3}
                placeholder="Ej.: Una historia en una lavandería, en una heladería o sobre los problemas de una familia"
                style={{ width: "100%", marginTop: 8 }}
              />
            </label>
            <div className="grid">
              {field("Tipo de seres", selection.beings, (v) => setSelection({ ...selection, beings: v }), beings)}
              {field("Estilo visual", selection.visualStyle, (v) => setSelection({ ...selection, visualStyle: v }), styles)}
              {field("Mundo / ambientación", selection.worldSetting, (v) => setSelection({ ...selection, worldSetting: v }), worlds)}
            </div>
            <p className="muted">Personajes humanos o humanoides atractivos según el tipo de seres. El estilo cambia la técnica visual y se mantiene en toda la historia.</p>
            {selection.visualStyle === TELENOVELA_STYLE && <p className="muted">{TELENOVELA_DESCRIPTION}</p>}
            <div className="grid" style={{ marginTop: 20 }}>
              {field(
                "Género",
                selection.genre,
                (v) =>
                  setSelection({
                    ...selection,
                    genre: v,
                    subgenre: genres[v][0],
                  }),
                Object.keys(genres),
              )}
              {field(
                "Subgénero",
                selection.subgenre,
                (v) => setSelection({ ...selection, subgenre: v }),
                genres[selection.genre],
              )}
              {field(
                "Tipo de trama",
                selection.plotType,
                (v) => setSelection({ ...selection, plotType: v }),
                plots,
              )}
              {field(
                "Tono",
                selection.tone,
                (v) => setSelection({ ...selection, tone: v }),
                tones,
              )}
              {field(
                "Tipo de cierre",
                selection.ending,
                (v) => setSelection({ ...selection, ending: v }),
                endings,
                {
                  Resolución: "Final resuelto",
                  "Giro final": "Final con sorpresa",
                  Cliffhanger: "Final en suspenso",
                },
              )}
            </div>
            <details>
              <summary>Modelos e idioma</summary>
              <div className="grid">
                {(["text", "image", "video"] as const).map((kind) => (
                  <label key={kind}>
                    {kind === "text" ? "Director de historias" : kind === "image"
                      ? "Generador de imagen"
                      : "Generador de video"}
                    <select
                      value={selection.models[kind]}
                      onChange={(e) =>
                        setSelection({
                          ...selection,
                          models: {
                            ...selection.models,
                            [kind]: e.target.value,
                          },
                        })
                      }
                    >
                      {Object.entries(MODELS)
                        .filter(([, m]) => m.kind === kind)
                        .map(([id, m]) => (
                          <option key={id} value={id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                {field("Idioma", selection.language, (v) => setSelection({ ...selection, language: v }), ["Español"])}
                {field("Acento", selection.accent, (v) => setSelection({ ...selection, accent: v }), ["Latinoamericano", "Venezolano", "Mexicano", "Colombiano", "Argentino", "Español de España"])}
              </div>
            </details>
            <button
              className="primary wide"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const p = await api("projects", "POST", {
                    ...selection,
                  });
                  await api(`projects/${p.id}/actions`, "POST", {
                    type: "ideas",
                    expectedRevision: 0,
                    requestId: crypto.randomUUID(),
                    instructions: "",
                  });
                  await refresh(p.id);
                })
              }
            >
              ✦ Generar 3 historias
            </button>
          </section>
          <h2>Mis universos</h2>
          <div className="cards">
            {Array.from(new Set(projects.map(p => p.universeId || p.id))).map(universeId => {
              const chapters = projects.filter(p => (p.universeId || p.id) === universeId).sort((a, b) => (a.chapterNumber || 1) - (b.chapterNumber || 1));
              return <section className="card" key={universeId}>
                <h3>{chapters[0].universeName || chapters[0].title}</h3>
                {chapters.map(p => <button key={p.id} onClick={() => void perform(async () => { await refresh(p.id); setTab("Historia"); })}>
                  Capítulo {p.chapterNumber || 1} · {p.title}
                </button>)}
                <button disabled={busy} onClick={() => {
                  if (!window.confirm(`¿Borrar por completo «${chapters[0].universeName || chapters[0].title}»? Se eliminarán sus ${chapters.length} capítulo(s), videos, imágenes y trabajos. No se puede deshacer.`)) return;
                  void perform(async () => {
                    await api(`projects/${chapters[0].id}`, "DELETE");
                    setData(null);
                    await refresh();
                  });
                }}>Borrar universo</button>
              </section>;
            })}
          </div>
          {!projects.length && (
            <p className="empty">Tus historias aparecerán aquí.</p>
          )}
        </>
      ) : (
        <>
          <div className="topline">
            <h1>{data.project.title}</h1>
            <span className="badge">Capítulo {data.project.chapterNumber || 1} · 64 segundos</span>
          </div>
          <section className="panel">
            <p>Universo: {data.project.universeSnapshot.name}. Cada capítulo continúa esta misma historia.</p>
            {data.project.previousChapter && <button onClick={() => void perform(async () => { await refresh(data.project.previousChapter!.projectId); setTab("Final"); })}>Ver capítulo anterior</button>}
            <button className="primary" disabled={busy || (!data.project.nextChapterId && (active || !data.exports.length || !!generationBlock(data, "finalize")))}
              onClick={() => void perform(async () => {
                const next = await api(`projects/${data.project.id}/next-chapter`, "POST", { expectedRevision: data.project.revision });
                await refresh(next.id); setTab("Historia");
              })}>
              {data.project.nextChapterId ? "Abrir siguiente capítulo" : "Crear siguiente capítulo"}
            </button>
            {!data.exports.length && !data.project.nextChapterId && <p className="muted">Disponible cuando termines y unas los ocho clips de este capítulo.</p>}
            {data.project.nextChapterId && <p className="muted">Este capítulo se conserva sin cambios porque su continuación ya está creada.</p>}
          </section>
          <details className="panel">
            <summary>Modelos de esta historia</summary>
            <p>
              El cambio se aplica a las próximas generaciones. Cada versión
              conserva el modelo con el que se creó.
            </p>
            {(["text", "image", "video"] as const).map((kind) => (
              <label key={kind}>
                {kind === "text"
                  ? "Director"
                  : kind === "image"
                    ? "Imágenes"
                    : "Video"}
                <select
                  value={data.project.models[kind]}
                  disabled={busy || !!data.project.nextChapterId}
                  onChange={(e) =>
                    void perform(() =>
                      patch({
                        models: {
                          ...data.project.models,
                          [kind]: e.target.value,
                        },
                      }),
                    )
                  }
                >
                  {Object.entries(MODELS)
                    .filter(([, m]) => m.kind === kind)
                    .map(([id, m]) => (
                      <option value={id} key={id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </details>
          <nav className="tabs" aria-label="Etapas">
            {["Historia", "Biblia", "Producción", "Final"].map((t) => (
              <button
                key={t}
                aria-pressed={t === tab}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {data.job && (
            <div className="notice">
              <strong>
                {
                  {
                    queued: data.job.hasOperation ? "Video enviado a Google" : data.job.backend === "direct" ? "Preparando generación" : "Iniciando procesamiento",
                    running: "Trabajando",
                    waiting: "Esperando a Google",
                    completed: "Generación terminada",
                    failed: "El trabajo falló",
                    stopped: "Detenido",
                    needsReview: data.job.error?.code === "PROVIDER_REJECTED" ? "Google rechazó esta solicitud" : "Respuesta incierta · requiere revisión",
                  }[data.job.state]
                }
              </strong>
              {data.job.error && <p role="alert">{data.job.error.message}</p>}
              {data.job.state === "queued" && !data.job.error && <p>{data.job.hasOperation ? "Google ya recibió el video. Esperando el resultado para procesarlo." : data.job.backend === "direct" ? "Preparando el siguiente paso de la generación." : "Preparando el procesamiento de archivos de video."}</p>}
              <div className="actions">
                {data.job.type === "ideas" && data.job.error?.code === "CONTINUITY" && data.job.resumable && (
                  <button disabled={busy} onClick={() => void perform(async () => {
                    await api(`jobs/${data.job!.id}/recover-ideas`, "POST", {});
                    await refresh(pid);
                  })}>Recuperar las 3 propuestas sin generarlas otra vez</button>
                )}
                {data.job.type === "story" && data.job.error?.code === "CONTINUITY" && data.job.resumable && (
                  <button disabled={busy} onClick={() => void perform(async () => {
                    await api(`jobs/${data.job!.id}/recover-story`, "POST", {});
                    setTab("Historia");
                    showRecoveredStory.current = data.job!.id;
                    await refresh(pid);
                  })}>Mostrar historia ya generada</button>
                )}
                {active && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api(`jobs/${data.job!.id}/stop`, "POST", {});
                        await refresh(pid);
                      })
                    }
                  >
                    Detener nuevas solicitudes
                  </button>
                )}
                {data.job.state !== "completed" &&
                  !data.job.closedAt &&
                  data.job.resumable &&
                  !(data.job.state === "queued" && !!(data.job.operationName || data.job.executionName)) &&
                  !(["ideas", "story"].includes(data.job.type) && data.job.error?.code === "CONTINUITY") && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(`jobs/${data.job!.id}/resume`, "POST", {});
                          await refresh(pid);
                        })
                      }
                    >
                      {data.job.error?.code === "TEXT_RESPONSE_LOST"
                        ? "Generar de nuevo la parte perdida"
                        : data.job.error?.code === "PROVIDER_REJECTED"
                        ? `Volver a intentar ${data.job.type === "bible" ? "Biblia" : "generación"}`
                        : data.job.state === "needsReview"
                        ? "Comprobar recuperación"
                        : "Reanudar trabajo"}
                    </button>
                  )}
              </div>
              {data.job.state === "needsReview" &&
                data.job.error?.code !== "PROVIDER_REJECTED" &&
                !data.job.hasOperation &&
                data.job.resumable && (
                  <details>
                    <summary>Cerrar intento sin respuesta recuperable</summary>
                    <p>
                      Primero comprueba la recuperación. El cierre conserva el
                      historial y no genera nada. El proveedor pudo consumir
                      créditos o seguir procesando; una nueva generación se
                      solicita por separado.
                    </p>
                    <label>
                      Resultado de la revisión
                      <textarea
                        value={recoveryNote}
                        onChange={(e) => setRecoveryNote(e.target.value)}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      He revisado este intento y entiendo su posible consumo de
                      créditos.
                    </label>
                    <button
                      disabled={
                        busy ||
                        !data.job.reconciledAt ||
                        !acknowledged ||
                        !recoveryNote.trim()
                      }
                      onClick={() =>
                        void perform(async () => {
                          await api(`jobs/${data.job!.id}/close`, "POST", {
                            note: recoveryNote,
                            acknowledged,
                          });
                          setAcknowledged(false);
                          setRecoveryNote("");
                          await refresh(pid);
                        })
                      }
                    >
                      Cerrar intento conservando el historial
                    </button>
                  </details>
                )}
              {data.job.stopRequested && (
                <small>
                  Las operaciones ya enviadas pueden continuar y consumir
                  créditos.
                </small>
              )}
            </div>
          )}
          {tab === "Historia" && (
            <>
              <div className="cards">
                {data.project.ideas.filter((i) => !data.project.selectedIdeaId || i.id === data.project.selectedIdeaId).map((i) => (
                  <article className="card" key={i.id}>
                    <h3>{i.title}</h3>
                    <p>{i.synopsis}</p>
                    <div className="actions">
                      {data.project.selectedIdeaId ? <span>Historia elegida</span> : <>
                        <button disabled={busy || active} onClick={() => void perform(() => patch({ selectedIdeaId: i.id }))}>Elegir</button>
                        <button disabled={busy || active} onClick={() => void perform(() => generate("ideas", undefined, "", i.id))}>Regenerar esta opción</button>
                      </>}
                    </div>
                  </article>
                ))}
              </div>
              <div className="actions">
                {!data.project.selectedIdeaId && <button
                  disabled={busy || active}
                  onClick={() => void perform(() => generate("ideas"))}
                >
                  {data.project.ideas.length ? "Regenerar las tres" : data.project.previousChapter ? "Generar 3 continuaciones" : "Generar 3 historias"}
                </button>}
                <button
                  className="primary"
                  disabled={busy || active || !!generationBlock(data, "story")}
                  onClick={() => void perform(() => generate("story"))}
                >
                  Desarrollar historia
                </button>
              </div>
              <NarrativePanel
                kind="story"
                data={data}
                busy={busy || !!data.project.nextChapterId}
                save={saveNarrative}
              />
            </>
          )}
          {tab === "Biblia" && (
            <>
              <button
                className="primary"
                disabled={busy || active || !!generationBlock(data, "bible")}
                onClick={() => void perform(() => generate("bible"))}
              >
                Generar biblia
              </button>
              <NarrativePanel
                kind="bible"
                data={data}
                busy={busy || !!data.project.nextChapterId}
                save={saveNarrative}
              />
              <button
                disabled={busy || active || !!generationBlock(data, "images")}
                onClick={() => void perform(() => generate("images"))}
              >
                {data.plan ? "Generar referencias pendientes" : "Generar personajes pendientes"}
              </button>
              {!data.plan && <p className="muted">Los escenarios se generarán después del guion, únicamente si aparecen en la historia.</p>}
              {data.targets
                .filter((t) => t.role === "character" || t.role === "location")
                .map((t) => (
                  <TargetPanel
                    key={t.id}
                    t={t}
                    data={data}
                    disabled={busy || active}
                    perform={perform}
                    generate={generate}
                    refresh={() => refresh(pid)}
                  />
                ))}
            </>
          )}
          {tab === "Producción" && (
            <>
              <div className="actions">
                <button
                  disabled={busy || active || !!generationBlock(data, "plan")}
                  onClick={() => void perform(() => generate("plan", undefined, data.plan ? "REGENERACIÓN COMPLETA SOLICITADA: crea una versión NUEVA del guion de 64 segundos desde la historia y Biblia aprobadas. No reutilices ni parafrasees el diálogo del plan anterior. Mantén los hechos y arco aprobados, pero reescribe todos los parlamentos con diálogo natural, expresivo, coloquial y subtexto lógico; los secretos, ambiciones y estrategias internas no se dicen en voz alta salvo revelación explícita." : ""))}
                >
                  {data.plan ? "Regenerar guion de 64 segundos" : "Preparar guion de 64 segundos"}
                </button>
                <button
                  disabled={busy || active || !!generationBlock(data, "images")}
                  onClick={() => void perform(() => generate("images"))}
                >
                  Generar imágenes pendientes
                </button>
              </div>
              <NarrativePanel
                kind="plan"
                data={data}
                busy={busy || !!data.project.nextChapterId}
                save={saveNarrative}
              />
              {data.plan?.clips.map((c) => (
                <section className="clip" key={c.number}>
                  <h2>
                    Clip {c.number} · {(c.number - 1) * 8}–{c.number * 8} s
                  </h2>
                  <p>{c.goal}</p>
                  {data.targets
                    .filter((t) => t.clipNumber === c.number)
                    .sort((a, b) =>
                      a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1,
                    )
                    .map((t) => (
                      <TargetPanel
                        key={t.id}
                        t={t}
                        data={data}
                        disabled={busy || active}
                        perform={perform}
                        generate={generate}
                        refresh={() => refresh(pid)}
                      />
                    ))}
                </section>
              ))}
            </>
          )}
          {tab === "Final" && (
            <section className="panel">
              <h2>Tu historia completa</h2>
              <p>Unión de la última versión de cada uno de los ocho clips, con su audio original.</p>
              <button
                className="primary"
                disabled={busy || active || !!generationBlock(data, "finalize")}
                onClick={() => void perform(() => generate("finalize"))}
              >
                Unir los ocho clips
              </button>
              {data.exports.map((e) => (
                <div key={e.id}>
                  <h3>
                    Exportación · {new Date(e.createdAt).toLocaleString("es")}
                  </h3>
                  {e.approvedClipVersionIds.some(
                    (v, i) =>
                      data.targets.find(
                        (t) => t.role === "clip" && t.clipNumber === i + 1,
                      )?.approvedVersionId !== v,
                  ) && (
                    <p className="notice">
                      Esta exportación corresponde a aprobaciones anteriores.
                    </p>
                  )}
                  <Media
                    projectId={data.project.id}
                    version={e.id}
                    kind="video"
                  />
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
function NarrativePanel({
  kind,
  data,
  busy,
  save,
}: {
  kind: Narrative["kind"];
  data: Data;
  busy: boolean;
  save: (x: unknown) => Promise<boolean>;
}) {
  const candidates = data.narratives
    .filter((n) => n.kind === kind)
    .sort((a, b) => b.createdAt - a.createdAt);
  const [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<unknown>(null),
    [baseRevision, setBaseRevision] = useState<number | null>(null),
    [validationError, setValidationError] = useState("");
  const current =
    (kind === "story" ? undefined : candidates.find((n) => n.id === selected)) ||
    candidates[0] ||
    data.project[kind];
  if (!current) return null;
  const alreadyApproved = draft === null && !!data.project[kind]?.approvedAt &&
    JSON.stringify(current.data) === JSON.stringify(data.project[kind]?.data);
  const saveDraft = async (approve: boolean) => {
    try {
      setValidationError("");
      const value = draft ?? current.data;
      const validated =
        kind === "story"
          ? story.parse(value)
          : kind === "bible"
            ? bibleSchema.parse(value)
            : validatePlan(value, data.bible!, !!data.project.previousChapter);
      const saved = await save({
        kind,
        data: validated,
        approve,
        expectedRevision: baseRevision ?? data.project.revision,
      });
      if (saved) {
        setDraft(null);
        setBaseRevision(null);
        setSelected("");
      }
    } catch (error) {
      setValidationError(
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : "Revisa los personajes y escenarios del guion.",
      );
    }
  };
  return (
    <section className="panel" id={kind === "story" ? "historia-generada" : undefined}>
      <h2>
        {kind === "story"
          ? "Historia"
          : kind === "bible"
            ? "Biblia de continuidad"
            : "Guion completo"}
      </h2>
      <p>La última versión guardada se utiliza automáticamente.</p>
      {kind !== "story" && <label>
        Versiones narrativas
        <select
          value={selected || current.id}
          onChange={(e) => {
            setSelected(e.target.value);
            setDraft(null);
            setBaseRevision(null);
          }}
        >
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {new Date(n.createdAt).toLocaleString("es")}{" "}
              {n.id === data.project[kind]?.id ? "· en uso" : "· historial"}
            </option>
          ))}
        </select>
      </label>}
      <details>
        <summary>
          Leer y editar {kind === "plan" ? "el guion" : "el contenido"}
        </summary>
        <Editor
          value={draft ?? current.data}
          bible={
            kind === "bible" ? ((draft ?? current.data) as Bible) : data.bible
          }
          onChange={(v) => {
            setBaseRevision((r) => r ?? data.project.revision);
            setDraft(v);
          }}
        />
      </details>
      {validationError && (
        <p className="error" role="alert">
          {validationError}
        </p>
      )}
      {draft !== null && (
        <div className="notice">
          {baseRevision !== data.project.revision
            ? "La historia cambió mientras editabas. Tu borrador local se conserva; revisa la nueva versión antes de guardar."
            : "Tienes cambios locales sin guardar."}
          <button
            onClick={() => {
              setDraft(null);
              setBaseRevision(null);
            }}
          >
            Descartar cambios locales
          </button>
        </div>
      )}
      <div className="actions">
        <button disabled={busy || alreadyApproved} onClick={() => void saveDraft(true)}>
          Guardar cambios
        </button>
      </div>
    </section>
  );
}
function TargetPanel({
  t,
  data,
  disabled,
  perform,
  generate,
  refresh,
}: {
  t: Target;
  data: Data;
  disabled: boolean;
  perform: (fn: () => Promise<void>) => Promise<void>;
  generate: (
    type: string,
    target?: string,
    instructions?: string,
  ) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const versions = data.assets
    .filter((v) => v.targetId === t.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const [instructions, setInstructions] = useState("");
  const v: Asset | undefined = versions.find(x => x.id === t.approvedVersionId) || versions[0];
  const blocked = generationBlock(data, t.kind, t.id);
  const title =
    t.role === "character"
      ? data.bible?.characters.find((x) => x.id === t.entityId)?.name
      : t.role === "location"
        ? data.bible?.locations.find((x) => x.id === t.entityId)?.name
        : t.role === "shot"
          ? "Imagen inicial del clip " + t.clipNumber
          : "Video del clip " + t.clipNumber;
  return (
    <article className="panel">
      <div className="topline">
        <h3>{title}</h3>
        <span className="badge">
          {v ? "Lista · en uso" : "Pendiente"}
        </span>
      </div>
      {v && (
        <>
          <Media projectId={data.project.id} version={v.id} kind={t.kind} />
          <p className="muted">Se utiliza automáticamente la última versión generada correctamente.</p>
        </>
      )}
      <details>
        <summary>Editar instrucciones</summary>
        <textarea
          aria-label="Instrucciones para esta versión"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </details>
      <div className="actions">
        <button
          disabled={disabled || !!blocked}
          title={blocked || undefined}
          onClick={() =>
            void perform(() => generate(t.kind, t.id, instructions))
          }
        >
          {versions.length ? "Regenerar" : "Generar"}{" "}
          {t.kind === "video" ? "clip" : "imagen"}
        </button>

      </div>
      {blocked && <p className="muted">{blocked}</p>}

    </article>
  );
}
