/** Tamanho máximo de um endereço (RFC 5321); acima disso não é um e-mail utilizável. */
const MAX_EMAIL_CHARS = 254;

/**
 * E-mail mascarado para identificar a conta sem revelá-la: primeiro caractere + `***` + `@` + domínio
 * inteiro (`p***@exemplo.com.br`); parte local de um caractere vira `*@dominio`. Devolve `null` se o
 * texto não é um e-mail analisável. O primeiro caractere é um ponto de código (nunca meio emoji).
 */
export function maskEmail(email: string): string | null {
  if (email === '' || email.length > MAX_EMAIL_CHARS) return null;
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) return null;
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (/\s/.test(localPart) || /[\s@]/.test(domain)) return null;
  const localChars = Array.from(localPart);
  return `${localChars.length === 1 ? '*' : `${localChars[0]}***`}@${domain}`;
}
