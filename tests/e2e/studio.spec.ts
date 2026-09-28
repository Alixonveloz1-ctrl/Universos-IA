import { test, expect } from "@playwright/test";
import { snapshot } from "../fixtures";
test("REAL local backend denies unauthenticated reading", async ({
  request,
}) => {
  const r = await request.get("/api/projects");
  expect(r.status()).toBe(401);
});
test("SIMULATED API: mobile creation, exact three proposals, selection and reload", async ({
  page,
}) => {
  let logged = false;
  let created = false;
  const s = snapshot();
  s.project.activeJobId = undefined;
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname.slice(5),
      method = req.method();
    let body: unknown = {};
    let status = 200;
    if (p === "session") {
      if (method === "POST") logged = true;
      if (!logged) {
        status = 401;
        body = { error: { message: "Introduce tu clave" } };
      }
    } else if (!logged) {
      status = 401;
      body = { error: { message: "No autorizado" } };
    } else if (p === "catalog") body = { defaults: s.project.models };
    else if (p === "universes")
      body = [{ id: "universe", ...s.project.universeSnapshot }];
    else if (p === "projects" && method === "GET")
      body = created
        ? [{ id: "test", title: s.project.title, stage: "ideas" }]
        : [];
    else if (p === "projects" && method === "POST") {
      const input = req.postDataJSON();
      expect(input.universeId).toBeUndefined();
      expect(input.beings).toBe("Frutas");
      expect(input.visualStyle).toBe("Cinemático 3D");
      created = true;
      body = s.project;
    } else if (p === "projects/test/actions") {
      calls.push(req.postDataJSON().type);
      body = { jobId: "mock", state: "completed" };
      status = 202;
    } else if (p === "projects/test" && method === "PATCH") {
      s.project.selectedIdeaId = req.postDataJSON().selectedIdeaId;
      s.project.revision++;
      body = s.project;
    } else if (p === "projects/test")
      body = { ...s, narratives: [], exports: [], job: null };
    await route.fulfill({ status, json: body });
  });
  await page.goto("/");
  await page.getByLabel("Clave de acceso").fill("test-only-no-real-secret");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Forjar una nueva historia" })).toBeVisible();
  // This wrapping label also contains the select's option text. Match its
  // visible prefix without requiring the entire descendant text to equal it.
  await expect(page.getByRole("button", { name: "Crear universo", exact: true })).toHaveCount(0);
  await page.getByLabel(/^Tipo de seres/).selectOption("Frutas");
  await expect(page.locator("textarea")).toHaveCount(0);
  const subgenre = page.getByLabel(/^Subgénero/);
  await expect(subgenre.locator("option")).toHaveCount(10);
  await subgenre.selectOption("Histórico");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      sizes: [...document.querySelectorAll("input,select,textarea")].map(el => parseFloat(getComputedStyle(el).fontSize)),
    }));
    expect(layout.content).toBeLessThanOrEqual(layout.width);
    expect(layout.sizes.every(size => size >= 16)).toBe(true);
  }

  await page.getByRole("button", { name: "Generar 3 historias" }).click();
  await expect(
    page.getByRole("button", { name: "Regenerar esta opción" }),
  ).toHaveCount(3);
  expect(calls).toEqual(["ideas"]);
  await page
    .getByRole("button", { name: "Elegir", exact: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Elegida" })).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: /Prueba simulada/ }).click();
  await expect(page.getByRole("button", { name: "Elegida" })).toHaveCount(1);
  expect(calls).toEqual(["ideas"]);
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
});
test("SIMULATED API: provider errors are visible, no automatic generation", async ({
  page,
}) => {
  const s = snapshot();
  let generations = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (p.endsWith("/catalog")) body = { defaults: s.project.models };
    if (p.endsWith("/universes")) body = [];
    if (p.endsWith("/projects"))
      body = [{ id: "test", title: "Con error", stage: "production" }];
    if (p.endsWith("/test"))
      body = {
        ...s,
        narratives: [],
        exports: [],
        job: {
          id: "j",
          state: "needsReview",
          error: {
            code: "AMBIGUOUS",
            message: "El proveedor pudo aceptar la solicitud.",
          },
        },
      };
    if (p.endsWith("/actions")) generations++;
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Con error" }).click();
  await expect(
    page.getByText("El proveedor pudo aceptar la solicitud."),
  ).toBeVisible();
  expect(generations).toBe(0);
});

test("SIMULATED API: a universe groups chapters and opens its continuation without generating automatically", async ({ page }) => {
  const first = snapshot();
  const next = snapshot();
  next.project = { ...first.project, id: "chapter2", title: "La carta continúa", chapterNumber: 2, ideas: [], previousChapter: { projectId: "test", exportId: "final", finalState: first.observed.clip_8, bible: first.bible!, lastClip: first.assets.find(a => a.id === "v8")! } };
  let created = false, generations = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(5);
    let body: unknown = {};
    if (path === "catalog") body = { defaults: first.project.models };
    if (path === "projects") body = [first.project, ...(created ? [next.project] : [])].map(p => ({ id: p.id, title: p.title, universeId: p.universeId, universeName: "Cristal", chapterNumber: p.chapterNumber || 1 }));
    if (path === "projects/test") body = { ...first, narratives: [], exports: [{ id: "final", approvedClipVersionIds: Array.from({length: 8}, (_, i) => `v${i + 1}`), createdAt: 1 }], job: null };
    if (path === "projects/test/next-chapter") { created = true; first.project.nextChapterId = "chapter2"; body = next.project; }
    if (path === "projects/chapter2") body = { ...next, narratives: [], exports: [], job: null };
    if (path.endsWith("/actions")) generations++;
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Capítulo 1/ }).click();
  await page.getByRole("button", { name: "Crear siguiente capítulo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "La carta continúa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generar 3 continuaciones" })).toBeVisible();
  expect(generations).toBe(0);
  await page.getByRole("button", { name: "Mis proyectos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cristal", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Capítulo 2/ })).toBeVisible();
});
