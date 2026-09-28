import { expect, it } from 'vitest';
import { settingDirection } from '../lib/director/setting';
it('defaults ordinary drama to the present and excludes the speculative profile',()=>{
 const d=settingDirection({genre:'Drama',subgenre:'Familiar',plotType:'Traición'});
 expect(d.instruction).toContain('presente contemporáneo cotidiano');
 expect(d.profiles).not.toHaveProperty('especulativo');
 expect(settingDirection({genre:'Drama',subgenre:'Social',plotType:'Herencia'}).instruction).toContain('herencia familiar actual');
});
it('respects explicit fantasy and historical choices',()=>{
 expect(settingDirection({genre:'Fantasía',subgenre:'Urbana',plotType:'Rivalidad'}).profiles).toHaveProperty('especulativo');
 expect(settingDirection({genre:'Romance',subgenre:'Histórico',plotType:'Traición'}).instruction).toContain('época histórica seleccionada');
});
