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
  await page.getByLabel("Universo", { exact: true }).selectOption("universe");
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
