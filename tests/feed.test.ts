import { describe, it, expect } from 'vitest';
import { papelEmTexto, quandoEmTexto, placarPresenca, type ItemFeed } from '../src/lib/feed';

const item = (tipo: string, dados: Record<string, unknown>, politicos: [string, string][]): ItemFeed => ({
  id: Math.random().toString(), fonte_id: 'x', fonte_nome: 'X', natureza: 'oficial', tipo, titulo: 't', resumo: null, resumo_ia: false,
  url: 'https://x', quando: '2026-10-28T12:00:00Z', local: null, dados,
  politicos: politicos.map(([slug, papel]) => ({ slug, papel, metodo: 'id-oficial', confianca: 1 })),
});

describe('papelEmTexto', () => {
  it('presença e falta', () => {
    expect(papelEmTexto('presenca', 'ausente')).toEqual({ texto: 'faltou', tom: 'ruim' });
    expect(papelEmTexto('presenca', 'presente').tom).toBe('bom');
  });
  it('siglas do Senado: licença médica não é falta, NCom é', () => {
    expect(papelEmTexto('voto', 'LS', 'senado').tom).toBe('neutro');
    expect(papelEmTexto('voto', 'NCom', 'senado')).toEqual({ texto: 'não compareceu', tom: 'ruim' });
    expect(papelEmTexto('voto', 'Sim', 'camara').texto).toBe('votou SIM');
  });
  it('sigla desconhecida aparece como veio', () => {
    expect(papelEmTexto('voto', 'XPTO', 'senado').texto).toBe('XPTO');
  });
});

describe('quandoEmTexto', () => {
  const agora = new Date('2026-10-28T15:00:00');
  it('relativo no mesmo dia, ontem e data curta', () => {
    expect(quandoEmTexto(new Date('2026-10-28T14:55:00').toISOString(), agora)).toBe('há 5 min');
    expect(quandoEmTexto(new Date('2026-10-28T12:00:00').toISOString(), agora)).toBe('há 3 h');
    expect(quandoEmTexto(new Date('2026-10-27T09:00:00').toISOString(), agora)).toBe('ontem');
    expect(quandoEmTexto(new Date('2026-10-12T09:00:00').toISOString(), agora)).toBe('12/out');
    expect(quandoEmTexto(new Date('2025-10-12T09:00:00').toISOString(), agora)).toBe('12/out/2025');
  });
});

describe('placarPresenca', () => {
  it('Câmara conta só plenário deliberativo; Senado só votação nominal, sem contar licença', () => {
    const p = placarPresenca([
      item('presenca', { plenario: true }, [['dep', 'presente']]),
      item('presenca', { plenario: true }, [['dep', 'ausente']]),
      item('presenca', { plenario: false }, [['dep', 'presente']]),   // comissão: fora da conta
      item('voto', { casa: 'senado' }, [['sen', 'Sim']]),
      item('voto', { casa: 'senado' }, [['sen', 'NCom']]),
      item('voto', { casa: 'senado' }, [['sen', 'LS']]),               // licença: nem esteve nem faltou
    ]);
    expect(p.get('dep')).toEqual({ esteve: 1, faltou: 1, base: 'plenario' });
    expect(p.get('sen')).toEqual({ esteve: 1, faltou: 1, base: 'votacao' });
  });
});
