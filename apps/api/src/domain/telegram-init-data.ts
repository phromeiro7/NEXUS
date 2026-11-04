import { createHmac, timingSafeEqual } from 'node:crypto';

export type InitDataFailure = 'malformado' | 'assinatura_invalida' | 'expirado';

export type InitDataResult =
  | { ok: true; user: { id: number; firstName?: string }; authDate: number; hash: string }
  | { ok: false; reason: InitDataFailure };

/** Tolerância para o relógio do Telegram estar um pouco adiantado em relação ao nosso. */
const FUTURE_SKEW_SECONDS = 60;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Valida o `initData` do Mini App conforme a documentação do Telegram (Web Apps, "Validating data
 * received via the Mini App"): HMAC-SHA256 dos campos ordenados (menos `hash`) com a chave
 * HMAC-SHA256("WebAppData", tokenDoBot), comparada em tempo constante. A assinatura é conferida ANTES
 * de qualquer campo ser lido: nada do conteúdo é confiável até ali. Depois, `auth_date` precisa estar
 * dentro da janela e `user.id` ser um inteiro positivo seguro. Função pura: o relógio vem de fora.
 *
 * Nunca registre `initData` nem o token: este módulo não registra nada.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSeconds: number,
  maxAgeSeconds: number,
): InitDataResult {
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  // Campo repetido é ambíguo: qual valor foi assinado? Recusa em vez de escolher um.
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'malformado' };

  const given = params.get('hash');
  if (given === null) return { ok: false, reason: 'malformado' };
  if (botToken === '' || !HEX64.test(given)) return { ok: false, reason: 'assinatura_invalida' };

  const check = keys
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${params.get(k) as string}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) return { ok: false, reason: 'assinatura_invalida' };

  const rawDate = params.get('auth_date');
  if (rawDate === null || !/^\d{1,12}$/.test(rawDate)) return { ok: false, reason: 'malformado' };
  const authDate = Number(rawDate);
  if (authDate > nowSeconds + FUTURE_SKEW_SECONDS || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'expirado' };
  }

  const rawUser = params.get('user');
  if (rawUser === null) return { ok: false, reason: 'malformado' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    return { ok: false, reason: 'malformado' };
  }
  const id = (parsed as { id?: unknown } | null)?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'malformado' };
  const firstName = (parsed as { first_name?: unknown }).first_name;

  return {
    ok: true,
    user: { id, ...(typeof firstName === 'string' && firstName !== '' ? { firstName } : {}) },
    authDate,
    hash: given,
  };
}
