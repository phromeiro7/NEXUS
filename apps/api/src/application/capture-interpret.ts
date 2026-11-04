import { todayIn, type InterpretCaptureInput, type InterpretCaptureResultDto } from '@aj/shared';
import { interpretCapture } from '../domain/chat-capture.js';
import type { Clock, ProfileRepository } from './ports.js';

/**
 * Lê uma frase com as MESMAS regras do bot ("gastei 45 no mercado", "reunião com a equipe sexta 9h30") e devolve o
 * que entendeu. Não grava nada: o painel mostra a proposta e, só depois de confirmada, cria a tarefa ou o
 * lançamento pelas rotas normais. O "hoje" vem do fuso das configurações da pessoa.
 */
export function makeCaptureInterpretUseCases(deps: { profiles: ProfileRepository; clock: Clock }) {
  return {
    async interpret(userId: string, input: InterpretCaptureInput): Promise<InterpretCaptureResultDto> {
      const profile = await deps.profiles.get(userId);
      const today = todayIn(profile.timezone, deps.clock.now());
      return { today, proposal: interpretCapture(input.text, today) };
    },
  };
}
