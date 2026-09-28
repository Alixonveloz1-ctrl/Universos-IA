import { expect, it } from "vitest";
import { femaleReference, withReferenceLook } from "../lib/director/reference-look";
const woman = { id: "c1", name: "Cereza", gender: "Femenino", age: "24 años" };
it("attaches a real reference after identity and style without replacing the chosen technique", () => {
  const own = { bytesBase64Encoded: "a", mimeType: "image/jpeg" };
  const anchor = { bytesBase64Encoded: "b", mimeType: "image/jpeg" };
  const result = withReferenceLook("Animación 2D", [own, anchor], 3, woman);
  expect(result.refs.slice(0, 2)).toEqual([own, anchor]);
  expect(Buffer.from(result.refs[2].bytesBase64Encoded, "base64").subarray(0,2).toString("hex")).toBe("ffd8");
  expect(result.prompt).toContain("Animación 2D");
  expect(result.prompt).toContain("NO un personaje de esta historia");
  expect(() => withReferenceLook("test", [own, anchor], 2, woman)).toThrow();
});
it("excludes men, minors and unspecified identities without altering references or prompt", () => {
  for (const character of [undefined, {...woman,gender:"masculino"}, {...woman,age:"16 años"}, {...woman,age:"niña"}, {...woman,gender:undefined}, {...woman,age:undefined}]) {
    expect(withReferenceLook("prompt", [], 3, character)).toEqual({prompt:"prompt",refs:[]});
  }
});
it("uses all six approved references for the matching species and selects a stable fallback", () => {
  for (const name of ["Arándano", "Mora", "Pera", "Limón", "Cereza", "Naranja"]) {
    expect(femaleReference({...woman,name})?.id).toBe(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  }
  expect(femaleReference({...woman,name:"Humana"})).toEqual(femaleReference({...woman,name:"Humana"}));
});
