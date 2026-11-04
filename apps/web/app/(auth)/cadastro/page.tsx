import { redirect } from "next/navigation";

/**
 * O cadastro público está fechado: o acesso ao Nexus é por convite (o convidado abre o link no Telegram).
 * A rota continua existindo só para mandar quem chegar por um endereço antigo para a entrada.
 */
export default function CadastroPage(): never {
  redirect("/entrar?acesso=convite");
}
