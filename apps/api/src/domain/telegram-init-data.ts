import { createHmac, timingSafeEqual } from 'node:crypto';

/** Motivos de recusa do `initData`; valores de domínio devolvidos ao chamador. */
export type InitDataFailure = 'malformado' | 'assinatura_invalida' | 'expirado';

/** Resultado de `verifyInitData`: dados do usuário já verificados, ou o motivo da recusa. */
export type InitDataResult =
  | { ok: true; user: { id: number; firstName?: string }; authDate: number; hash: string }
  | { ok: false; reason: InitDataFailure };

/** Tolerância para o relógio do Telegram estar um pouco adiantado em relação ao nosso. */
const FUTURE_SKEW_SECONDS = 60;

/** Constante fixa da especificação do Telegram para derivar a chave secreta a partir do token do bot. */
const WEB_APP_DATA_KEY = 'WebAppData';

/** HMAC-SHA256 em hexadecimal minúsculo: 64 caracteres. */
const HMAC_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Segundos Unix: até 12 dígitos impede números enormes antes do `Number()`. */
const UNIX_SECONDS_PATTERN = /^\d{1,12}$/;

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
  const fieldNames = [...params.keys()];
  // Campo repetido é ambíguo: qual valor foi assinado? Recusa em vez de escolher um.
  const hasDuplicateField = new Set(fieldNames).size !== fieldNames.length;
  if (hasDuplicateField) return { ok: false, reason: 'malformado' };

  const receivedHash = params.get('hash');
  if (receivedHash === null) return { ok: false, reason: 'malformado' };
  if (botToken === '' || !HMAC_SHA256_HEX_PATTERN.test(receivedHash)) {
    return { ok: false, reason: 'assinatura_invalida' };
  }

  const dataCheckString = fieldNames
    .filter((name) => name !== 'hash')
    .sort()
    .map((name) => `${name}=${params.get(name) as string}`)
    .join('\n');
  const secretKey = createHmac('sha256', WEB_APP_DATA_KEY).update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();
  if (!timingSafeEqual(expectedHash, Buffer.from(receivedHash, 'hex'))) {
    return { ok: false, reason: 'assinatura_invalida' };
  }

  const rawAuthDate = params.get('auth_date');
  if (rawAuthDate === null || !UNIX_SECONDS_PATTERN.test(rawAuthDate)) return { ok: false, reason: 'malformado' };
  const authDate = Number(rawAuthDate);
  const isFromTheFuture = authDate > nowSeconds + FUTURE_SKEW_SECONDS;
  const isTooOld = nowSeconds - authDate > maxAgeSeconds;
  if (isFromTheFuture || isTooOld) return { ok: false, reason: 'expirado' };

  const rawUser = params.get('user');
  if (rawUser === null) return { ok: false, reason: 'malformado' };
  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(rawUser);
  } catch {
    return { ok: false, reason: 'malformado' };
  }
  const id = (parsedUser as { id?: unknown } | null)?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'malformado' };
  const firstName = (parsedUser as { first_name?: unknown }).first_name;
  const hasFirstName = typeof firstName === 'string' && firstName !== '';

  return {
    ok: true,
    user: { id, ...(hasFirstName ? { firstName } : {}) },
    authDate,
    hash: receivedHash,
  };
}
