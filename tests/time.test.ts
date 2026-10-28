import { describe, it, expect } from 'vitest';
import { timeVazio, seguir, deixarDeSeguir, alternarTitular, porCargo, normalizarTime, ehTitular, segue, type Escalado } from '../src/lib/time';

const p = (slug: string, cargo: Escalado['cargo']) => ({ slug, nome: slug.toUpperCase(), partido: 'X', uf: 'SP', cargo });

describe('time', () => {
  it('segue vários por cargo, sem repetir', () => {
    let t = seguir(timeVazio(), p('a', 'deputado-federal'));
    t = seguir(t, p('b', 'deputado-federal'));
    t = seguir(t, p('a', 'deputado-federal'));
    expect(t.escalados.map(e => e.slug)).toEqual(['a', 'b']);
  });
  it('titular segue junto e um cargo de vaga única troca o titular', () => {
    let t = alternarTitular(timeVazio(), p('a', 'governador'));
    expect(segue(t, 'a') && ehTitular(t, 'a')).toBe(true);
    t = alternarTitular(t, p('b', 'governador'));
    expect(ehTitular(t, 'a')).toBe(false);
    expect(segue(t, 'a')).toBe(true);   // vai pro banco, não sai do time
    expect(ehTitular(t, 'b')).toBe(true);
  });
  it('senado aceita três titulares e o quarto tira o mais antigo', () => {
    let t = timeVazio();
    for (const s of ['s1', 's2', 's3', 's4']) t = alternarTitular(t, p(s, 'senador'));
    expect(['s1', 's2', 's3', 's4'].map(s => ehTitular(t, s))).toEqual([false, true, true, true]);
  });
  it('desmarcar titular mantém seguindo; deixar de seguir tira do time', () => {
    let t = alternarTitular(timeVazio(), p('a', 'presidente'));
    t = alternarTitular(t, p('a', 'presidente'));
    expect(segue(t, 'a') && !ehTitular(t, 'a')).toBe(true);
    expect(deixarDeSeguir(t, 'a').escalados).toEqual([]);
  });
  it('porCargo põe titular primeiro', () => {
    let t = seguir(timeVazio(), p('a', 'deputado-federal'));
    t = alternarTitular(t, p('z', 'deputado-federal'));
    expect(porCargo(t)['deputado-federal'].map(e => e.slug)).toEqual(['z', 'a']);
  });
  it('normaliza lixo do localStorage', () => {
    expect(normalizarTime(null)).toEqual({ escalados: [] });
    const t = normalizarTime({ uf: 'sp', escalados: [p('a', 'senador'), p('a', 'senador'), { slug: 1 }, { ...p('b', 'vereador' as never) }] });
    expect(t.uf).toBeUndefined();
    expect(t.escalados.map(e => e.slug)).toEqual(['a']);
  });
});
