import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from './telegram-init-data.js';

const TOKEN = '123456:TEST-token-not-real';
const NOW = 1_800_000_000;

/** Assina como o Telegram: chave = HMAC("WebAppData", token); hash = HMAC(chave, campos ordenados). */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 4242, first_name: 'Ana', language_code: 'pt-br' });
const base = { auth_date: String(NOW - 30), query_id: 'AAH', user };

describe('verifyInitData', () => {
  it('aceita um initData válido e devolve o usuário assinado', () => {
    const r = verifyInitData(sign(base), TOKEN, NOW, 3600);
    expect(r).toMatchObject({ ok: true, user: { id: 4242, firstName: 'Ana' }, authDate: NOW - 30 });
    expect(r.ok && r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aceita campos extras que o Telegram acrescente (entram na assinatura)', () => {
    expect(verifyInitData(sign({ ...base, chat_type: 'sender', start_param: 'x' }), TOKEN, NOW, 3600).ok).toBe(true);
  });

  it('rejeita assinatura de outro bot', () => {
    expect(verifyInitData(sign(base, '999:OUTRO'), TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'assinatura_invalida' });
  });

  it('rejeita dado adulterado (trocar o usuário depois de assinado)', () => {
    const forged = sign(base).replace(encodeURIComponent('"id":4242'), encodeURIComponent('"id":1'));
    expect(forged).not.toBe(sign(base));
    expect(verifyInitData(forged, TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'assinatura_invalida' });
  });

  it('rejeita campo acrescentado depois de assinado', () => {
    expect(verifyInitData(`${sign(base)}&start_param=evil`, TOKEN, NOW, 3600)).toEqual({
      ok: false,
      reason: 'assinatura_invalida',
    });
  });

  it('rejeita hash ausente, curto ou que não é hexadecimal', () => {
    const noHash = new URLSearchParams(base).toString();
    expect(verifyInitData(noHash, TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'malformado' });
    expect(verifyInitData(`${noHash}&hash=abc`, TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'assinatura_invalida' });
    expect(verifyInitData(`${noHash}&hash=${'z'.repeat(64)}`, TOKEN, NOW, 3600)).toEqual({
      ok: false,
      reason: 'assinatura_invalida',
    });
  });

  it('rejeita campo repetido (ambíguo), mesmo com assinatura sobre o primeiro', () => {
    expect(verifyInitData(`${sign(base)}&query_id=OUTRO`, TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'malformado' });
  });

  it('rejeita initData vazio ou sem sentido', () => {
    expect(verifyInitData('', TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'malformado' });
    expect(verifyInitData('isso não é initData', TOKEN, NOW, 3600).ok).toBe(false);
  });

  it('rejeita initData expirado (auth_date mais antigo que a janela)', () => {
    const old = sign({ ...base, auth_date: String(NOW - 3601) });
    expect(verifyInitData(old, TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'expirado' });
    expect(verifyInitData(sign({ ...base, auth_date: String(NOW - 3600) }), TOKEN, NOW, 3600).ok).toBe(true);
  });

  it('rejeita auth_date no futuro além da tolerância do relógio', () => {
    expect(verifyInitData(sign({ ...base, auth_date: String(NOW + 61) }), TOKEN, NOW, 3600)).toEqual({
      ok: false,
      reason: 'expirado',
    });
    expect(verifyInitData(sign({ ...base, auth_date: String(NOW + 30) }), TOKEN, NOW, 3600).ok).toBe(true);
  });

  it('rejeita auth_date ausente ou não numérico, mesmo assinado', () => {
    const { auth_date: _drop, ...noDate } = base;
    expect(verifyInitData(sign(noDate), TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'malformado' });
    expect(verifyInitData(sign({ ...base, auth_date: 'ontem' }), TOKEN, NOW, 3600)).toEqual({
      ok: false,
      reason: 'malformado',
    });
  });

  it('rejeita usuário ausente, JSON inválido ou id inválido, mesmo assinado', () => {
    const { user: _drop, ...noUser } = base;
    expect(verifyInitData(sign(noUser), TOKEN, NOW, 3600)).toEqual({ ok: false, reason: 'malformado' });
    expect(verifyInitData(sign({ ...base, user: '{nao-json' }), TOKEN, NOW, 3600).ok).toBe(false);
    for (const id of ['"4242"', '0', '-5', '1.5', String(2 ** 60)]) {
      expect(verifyInitData(sign({ ...base, user: `{"id":${id}}` }), TOKEN, NOW, 3600)).toEqual({
        ok: false,
        reason: 'malformado',
      });
    }
  });

  it('sem token do bot nada é aceito', () => {
    expect(verifyInitData(sign(base), '', NOW, 3600)).toEqual({ ok: false, reason: 'assinatura_invalida' });
  });
});
