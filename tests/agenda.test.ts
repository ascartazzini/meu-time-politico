import { describe, it, expect } from 'vitest';
import { lerAgendaPlanalto, classificarAgenda } from '../scripts/coletores/agenda';

describe('lerAgendaPlanalto', () => {
  it('lê horário, título e local de cada compromisso', () => {
    const html = `<ul><li class="item-compromisso-wrapper"><div class="compromisso-inicio">09h30</div>
      <h2 class="compromisso-titulo">Ministro da Defesa, José Mucio</h2><div class="compromisso-local">Palácio da Alvorada</div></li>
      <li class="item-compromisso-wrapper"><div class="compromisso-inicio">15h00</div><h2 class="compromisso-titulo">Despacho interno</h2></li></ul>`;
    expect(lerAgendaPlanalto(html, '2026-10-27')).toEqual([
      { quando: '2026-10-27T09:30:00-03:00', titulo: 'Ministro da Defesa, José Mucio', local: 'Palácio da Alvorada' },
      { quando: '2026-10-27T15:00:00-03:00', titulo: 'Despacho interno', local: null },
    ]);
  });
  it('dia sem compromisso devolve lista vazia', () => { expect(lerAgendaPlanalto('<html></html>', '2026-10-27')).toEqual([]); });
});

describe('classificarAgenda', () => {
  it('autoridade e órgão público', () => {
    expect(classificarAgenda('Ministro da Defesa, José Mucio')).toBe('publica');
    expect(classificarAgenda('Governador do Pará, Helder Barbalho')).toBe('publica');
    expect(classificarAgenda('Despacho interno')).toBe('publica');
    expect(classificarAgenda('Presidente do Banco Central, Gabriel Galípolo')).toBe('publica');
    expect(classificarAgenda('Telefonema com a Presidenta do México, Claudia Sheinbaum')).toBe('publica');
  });
  it('empresa, entidade e sociedade civil', () => {
    expect(classificarAgenda('CEO da Vale, Gustavo Pimenta')).toBe('privada');
    expect(classificarAgenda('Presidente da Confederação Nacional da Indústria, Ricardo Alban')).toBe('privada');
    expect(classificarAgenda('Representantes das centrais sindicais')).toBe('privada');
  });
  it('partido vence autoridade; pessoal vence tudo', () => {
    expect(classificarAgenda('Reunião com a Executiva Nacional do PT e ministros')).toBe('partidaria');
    expect(classificarAgenda('Exame médico de rotina no Hospital Sírio-Libanês')).toBe('pessoal');
  });
  it('sem critério, sem classificação', () => {
    expect(classificarAgenda('Fulano de Tal')).toBeNull();
  });
});
