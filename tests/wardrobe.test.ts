import { expect, it } from 'vitest';
import { wardrobeDirection } from '../lib/director/wardrobe';
it('varies initial design between projects but is stable for retries and preserves approved clothing',()=>{
  const a=wardrobeDirection('project-a','camila',['traje azul']);
  expect(a).toBe(wardrobeDirection('project-a','camila',['traje azul']));
  expect(a).not.toBe(wardrobeDirection('project-b','camila',['traje azul']));
  expect(a).toContain('traje azul');
  expect(a).toContain('moda casual reconocible de hoy');
  expect(a).toContain('Evita blusa formal con falda tubo');
  expect(a).toContain('no cambies ropa entre clips');
});
