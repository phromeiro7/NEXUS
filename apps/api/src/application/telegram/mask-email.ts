/** Tamanho máximo de um endereço (RFC 5321); acima disso não é um e-mail utilizável. */
const MAX_EMAIL_CHARS = 254;

/**
 * E-mail mascarado para identificar a conta sem revelá-la: primeiro caractere + `***` + `@` + domínio
 * inteiro (`p***@exemplo.com.br`); parte local de um caractere vira `*@dominio`. Devolve `null` se o
 * texto não é um e-mail analisável. O primeiro caractere é um ponto de código (nunca meio emoji).
 */
export function maskEmail(email: string): string | null {
  if (email === '' || email.length > MAX_EMAIL_CHARS) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(local) || /[\s@]/.test(domain)) return null;
  const chars = Array.from(local);
  return `${chars.length === 1 ? '*' : `${chars[0]}***`}@${domain}`;
}
