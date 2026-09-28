import { test, expect } from "@playwright/test";
import { snapshot } from "../fixtures";

test("SIMULATED: approving a generated story advances to Bible and stays approved on reload", async ({ page }) => {
  const s = snapshot();
  s.project.story!.approvedAt = 0;
  delete s.project.bible;
  delete s.project.plan;
  s.bible = null;
  s.plan = null;
  const candidate = structuredClone(s.project.story!);
  let approvals = 0;
  await page.route("**/api/**", async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname.slice(5);
    let body: unknown = {};
    if (p === "catalog") body = { defaults: s.project.models };
    else if (p === "universes") body = [];
    else if (p === "projects") body = [s.project];
    else if (p === "projects/test" && req.method() === "PATCH") {
      const input = req.postDataJSON();
      expect(input.approve).toBe(true);
      expect(input.kind).toBe("story");
      approvals++;
      s.project.story!.approvedAt = Date.now();
      s.project.revision++;
      body = s.project;
    } else if (p === "projects/test") body = { ...s, narratives: [candidate], exports: [], job: { id: "done", type: "story", state: "completed" } };
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Prueba simulada/ }).click();
  await page.getByRole("button", { name: "Aprobar historia", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generar biblia", exact: true })).toBeEnabled();
  await expect(page.getByText(/pendiente de aprobación/)).toHaveCount(0);
  await page.getByRole("button", { name: "Historia", exact: true }).click();
  await expect(page.getByText("Historia aprobada. Continúa en Biblia.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprobar historia", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: /Prueba simulada/ }).click();
  await expect(page.getByText("Historia aprobada. Continúa en Biblia.")).toBeVisible();
  expect(approvals).toBe(1);
});
