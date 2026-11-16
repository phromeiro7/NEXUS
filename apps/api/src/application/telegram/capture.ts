import { todayIn, type CreateFinanceEntryInput, type CreateTaskInput, type FinanceEntryDto, type IsoDate, type TaskDto } from '@nexus/shared';
import { z } from 'zod';
import { addDays, weekday } from '../../domain/calendar.js';
import { interpretCapture, type CaptureProposal } from '../../domain/chat-capture.js';
import { HoraInvalidaError } from '../../domain/reminders.js';
import type { AssistantLogger } from '../assistant/process-message.js';
import type { CaptureRepository, Clock, InlineKeyboard, ProfileRepository, TelegramClient } from '../ports.js';

/*
 * Registro pelo chat por regras (sem IA). Fluxo: o interpretador lê a mensagem, o bot mostra a proposta com
 * botões e NADA é gravado em tarefas ou lançamentos antes de "Confirmar". A proposta vive em `chat_captures`
 * (uma hora; 24 h depois de confirmada, para o "Desfazer"). Cada botão leva `c:<id>:<ação>` (até 64 bytes).
 *
 * Logs: só nomes de evento e de erro; nunca o texto da mensagem, valores, títulos nem o chat id.
 */

const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['gasto', 'entrada', 'conta']),
    description: z.string().min(1),
    amountCents: z.number().int().positive(),
    category: z.string().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    status: z.enum(['paga', 'a_pagar']),
  }),
  z.object({
    kind: z.literal('tarefa'),
    title: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    vagueTime: z.boolean(),
  }),
]);

type Proposal = z.infer<typeof proposalSchema>;
type FinanceProposal = Extract<Proposal, { kind: 'gasto' | 'entrada' | 'conta' }>;

export const CAPTURE_HELP =
  'Não entendi. Tente: gastei 45 no mercado · recebi 800 de um serviço · reunião com a equipe sexta 9h30';

const EXPENSE_CATEGORIES = ['Moradia', 'Mercado', 'Transporte', 'Lazer', 'Saúde', 'Roupas', 'Outra'] as const;
const INCOME_CATEGORIES = ['Salário', 'Freela', 'Outra'] as const;
const TIME_CHOICES = ['09:00', '12:00', '14:00', '16:00', '18:00'] as const;
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const categoriesOf = (p: FinanceProposal): readonly string[] => (p.kind === 'entrada' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
const isPast = (p: Proposal): boolean => p.kind !== 'tarefa' && p.kind !== 'conta' && p.status === 'paga';

/** 123456 -> "R$ 1.234,56" (espaço comum). */
export function formatMoney(cents: number): string {
  const int = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${int},${String(cents % 100).padStart(2, '0')}`;
}

/** "14:00" -> "14h", "09:30" -> "9h30". */
export function spokenTime(time: string): string {
  const [h = '0', m = '00'] = time.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** hoje, amanhã, ontem; até 6 dias à frente "sexta, 06/11"; senão "10/11". */
export function dayText(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'hoje';
  if (date === addDays(today, 1)) return 'amanhã';
  if (date === addDays(today, -1)) return 'ontem';
  const [, m = '', d = ''] = date.split('-');
  const short = `${d}/${m}`;
  for (let i = 2; i <= 6; i += 1) if (date === addDays(today, i)) return `${WEEKDAY_NAMES[weekday(date)]}, ${short}`;
  return short;
}

const whenText = (p: Proposal, today: IsoDate): string => {
  if (p.date === null) return p.kind === 'tarefa' ? 'sem data' : '';
  const day = dayText(p.date as IsoDate, today);
  return p.time === null ? day : `${day} às ${spokenTime(p.time)}`;
};

/** Frase curta do que foi entendido, igual antes e depois de confirmar (muda só o prefixo). */
function summaryOf(p: Proposal, today: IsoDate): string {
  const when = whenText(p, today);
  if (p.kind === 'tarefa') return `${p.title}, ${when}`;
  const money = formatMoney(p.amountCents);
  // A descrição só aparece quando acrescenta algo à categoria ("roupa" já está em "Roupas"; "uber" não está em "Transporte").
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const redundant = p.category !== null && (fold(p.category).includes(fold(p.description)) || fold(p.description).includes(fold(p.category)));
  const named = p.category !== null && !redundant ? ` (${p.description})` : '';
  const what = p.category !== null ? `em ${p.category}${named}` : `(${p.description})`;
  if (p.kind === 'gasto') return `${money} ${what}, ${when}`;
  if (p.kind === 'entrada') {
    return p.status === 'paga' ? `entrada de ${money} ${what}, ${when}` : `a receber ${money} ${what}, ${when}`;
  }
  return p.date === null ? `conta de ${money} ${what}` : `conta de ${money} ${what}, vence ${when}`;
}

function proposalText(p: Proposal, today: IsoDate, earlyMinutes: number): string {
  const lines = [`Anotei: ${summaryOf(p, today)}.`];
  if (p.kind === 'tarefa') {
    if (p.date !== null && p.time !== null) lines.push(`Aviso: ${earlyMinutes > 0 ? `${earlyMinutes} min antes e na hora` : 'na hora'}.`);
    else if (p.date !== null) lines.push('Aviso: na véspera e no dia, às 8h.');
    if (p.vagueTime) lines.push('Você não disse a hora: fica sem horário por enquanto.');
  } else if ((p.kind === 'conta' || p.status === 'a_pagar') && p.date === null) {
    lines.push(p.kind === 'conta' ? 'Qual o vencimento?' : 'Quando você recebe?');
  }
  return lines.join('\n');
}

const button = (id: string, text: string, action: string) => ({ text, callbackData: `c:${id}:${action}` });

function proposalKeyboard(id: string, p: Proposal): InlineKeyboard {
  const confirm = p.kind !== 'tarefa' && p.status === 'a_pagar' && p.date === null ? [] : [button(id, 'Confirmar', 'ok')];
  if (p.kind === 'tarefa') {
    const second = [button(id, 'Mudar dia', 'mday'), ...(p.date !== null ? [button(id, 'Mudar horário', 'mtime')] : [])];
    return [confirm, second].filter((r) => r.length > 0);
  }
  const rows: InlineKeyboard = [confirm, [button(id, 'Mudar categoria', 'mcat'), button(id, 'Mudar data', 'mday')]];
  if (p.kind === 'conta') rows.push([button(id, 'Mudar horário', 'mtime')]);
  return rows.filter((r) => r.length > 0);
}

const back = (id: string) => [button(id, 'Voltar', 'back')];

function menuKeyboard(id: string, p: Proposal, menu: 'cat' | 'day' | 'time'): { text: string; keyboard: InlineKeyboard } {
  if (menu === 'cat' && p.kind !== 'tarefa') {
    const items = categoriesOf(p).map((label, i) => button(id, label, `cat.${i}`));
    return { text: 'Qual categoria?', keyboard: [items.slice(0, 3), items.slice(3, 6), items.slice(6), back(id)].filter((r) => r.length > 0) };
  }
  if (menu === 'day') {
    const options = isPast(p)
      ? [['h', 'Hoje'], ['o', 'Ontem'], ['a', 'Anteontem']]
      : [['h', 'Hoje'], ['m', 'Amanhã'], ['d', 'Depois de amanhã'], ['w', 'Em 1 semana']];
    const text = p.kind === 'tarefa' ? 'Para qual dia?' : p.kind === 'conta' ? 'Qual o vencimento?' : isPast(p) ? 'Foi quando?' : 'Quando você recebe?';
    return { text, keyboard: [options.map(([code, label]) => button(id, label!, `day.${code}`)), back(id)] };
  }
  const times = TIME_CHOICES.map((t) => button(id, spokenTime(t), `time.${t.replace(':', '')}`));
  return {
    text: 'Que horas?',
    keyboard: [times.slice(0, 3), [...times.slice(3), button(id, 'Sem horário', 'time.none')], back(id)].filter((r) => r.length > 0),
  };
}

function applyDay(p: Proposal, code: string, today: IsoDate): Proposal | null {
  const offsets: Record<string, number> = { h: 0, o: -1, a: -2, m: 1, d: 2, w: 7 };
  const offset = offsets[code];
  if (offset === undefined) return null;
  return { ...p, date: addDays(today, offset) } as Proposal;
}

function applyTime(p: Proposal, code: string): Proposal | null {
  if (p.date === null) return null;
  if (code === 'none') return { ...p, time: null } as Proposal;
  const match = /^(\d{2})(\d{2})$/.exec(code);
  if (match === null || !TIME_CHOICES.includes(`${match[1]}:${match[2]}` as (typeof TIME_CHOICES)[number])) return null;
  return { ...p, time: `${match[1]}:${match[2]}` } as Proposal;
}

export type CaptureFlowDeps = {
  captures: CaptureRepository;
  tasks: {
    create(userId: string, input: CreateTaskInput, source: 'painel' | 'telegram'): Promise<TaskDto>;
    remove(userId: string, id: string): Promise<void>;
  };
  finance: {
    create(userId: string, input: CreateFinanceEntryInput): Promise<FinanceEntryDto>;
    remove(userId: string, id: string): Promise<void>;
  };
  profiles: Pick<ProfileRepository, 'get'>;
  telegram: TelegramClient;
  clock: Clock;
  logger: AssistantLogger;
  /** Base https do Mini App (ex.: https://nexus.example.com). Ausente = sem o botão "Ver no Nexus". */
  miniAppUrl?: string;
};

export type CaptureCallback = { id: string; chatId: number; messageId: number | null; data: string };

const errorName = (e: unknown) => (e instanceof Error ? e.name : 'desconhecido');

export function makeCaptureFlow(deps: CaptureFlowDeps) {
  const { captures, telegram, clock, logger } = deps;

  async function localContext(userId: string): Promise<{ today: IsoDate; earlyMinutes: number }> {
    const profile = await deps.profiles.get(userId);
    return { today: todayIn(profile.timezone, clock.now()), earlyMinutes: profile.earlyReminderMinutes };
  }

  async function edit(chatId: number, messageId: number | null, text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (messageId === null) return;
    const result = await telegram.editMessageText(chatId, messageId, text, keyboard !== undefined ? { keyboard } : undefined);
    if (!result.ok) logger.error('telegram.capture_edit_failed', { code: result.error.kind === 'permanent' ? `permanent:${result.error.reason}` : 'transient' });
  }

  async function answer(id: string, text?: string): Promise<void> {
    const result = await telegram.answerCallbackQuery(id, text);
    if (!result.ok) logger.error('telegram.capture_answer_failed', { code: result.error.kind === 'permanent' ? `permanent:${result.error.reason}` : 'transient' });
  }

  function viewUrlOf(p: Proposal): string | null {
    return deps.miniAppUrl === undefined ? null : `${deps.miniAppUrl.replace(/\/+$/, '')}${p.kind === 'tarefa' ? '/mini' : '/mini/financas'}`;
  }

  async function createEntity(userId: string, p: Proposal, today: IsoDate): Promise<{ kind: 'tarefa' | 'lancamento'; id: string }> {
    if (p.kind === 'tarefa') {
      const task = await deps.tasks.create(
        userId,
        { title: p.title, type: 'tarefa', dueDate: p.date as IsoDate | null, dueTime: p.time, fatal: false },
        'telegram',
      );
      return { kind: 'tarefa', id: task.id };
    }
    const entry = await deps.finance.create(userId, {
      kind: p.kind,
      description: p.description,
      amountCents: p.amountCents,
      category: p.category,
      dueDate: (p.date ?? today) as IsoDate,
      status: p.status,
      reminderTime: p.time,
    });
    return { kind: 'lancamento', id: entry.id };
  }

  return {
    /** Entende a mensagem pelas regras; `null` = não entendeu (quem chamou decide o plano B). */
    async interpret(userId: string, text: string): Promise<CaptureProposal | null> {
      const { today } = await localContext(userId);
      return interpretCapture(text, today);
    },

    /** Grava a proposta e mostra a mensagem com os botões. Nada vira tarefa nem lançamento aqui. */
    async propose(userId: string, chatId: number, proposal: CaptureProposal): Promise<void> {
      const parsed = proposalSchema.parse(proposal);
      const { today, earlyMinutes } = await localContext(userId);
      const record = await captures.create(userId, chatId, parsed, clock.now());
      const sent = await telegram.sendMessage(chatId, proposalText(parsed, today, earlyMinutes), {
        keyboard: proposalKeyboard(record.id, parsed),
      });
      if (!sent.ok) {
        logger.error('telegram.send_failed', { code: sent.error.kind === 'permanent' ? `permanent:${sent.error.reason}` : 'transient' });
        return;
      }
      await captures.setMessage(record.id, sent.messageId);
    },

    /** Trata um toque num botão. `userId` é o dono do chat (já resolvido pelo webhook). */
    async handleCallback(userId: string, input: CaptureCallback): Promise<void> {
      const match = /^c:([0-9a-f-]{36}):([a-z]+(?:\.[0-9a-z]+)?)$/.exec(input.data);
      if (match === null) return void (await answer(input.id, 'Esse botão é antigo. Mande a mensagem de novo.'));
      const [, id = '', action = ''] = match;
      const now = clock.now();
      const record = await captures.get(id, now);
      if (record === null) return void (await answer(input.id, 'Essa anotação expirou. Mande a mensagem de novo.'));
      if (record.userId !== userId || record.chatId !== input.chatId) {
        logger.error('telegram.capture_foreign', { code: 'dono_diferente' });
        return void (await answer(input.id));
      }
      const parsed = proposalSchema.safeParse(record.payload);
      if (!parsed.success) return void (await answer(input.id, 'Não consegui ler essa anotação. Mande a mensagem de novo.'));
      const proposal = parsed.data;
      const { today, earlyMinutes } = await localContext(userId);
      const messageId = input.messageId ?? record.messageId;

      const show = async (p: Proposal): Promise<void> => {
        await edit(input.chatId, messageId, proposalText(p, today, earlyMinutes), proposalKeyboard(id, p));
        await answer(input.id);
      };

      if (action === 'undo') {
        const entity = await captures.beginUndo(id, now);
        if (entity === null) return void (await answer(input.id, 'Não há mais nada para desfazer.'));
        try {
          if (entity.kind === 'tarefa') await deps.tasks.remove(userId, entity.id);
          else await deps.finance.remove(userId, entity.id);
        } catch (error) {
          // Já não existe (apagado pelo painel): tudo bem, é o que a pessoa queria.
          if (errorName(error) !== 'NotFoundError') {
            await captures.abortUndo(id);
            logger.error('telegram.capture_undo_failed', { errorName: errorName(error) });
            return void (await answer(input.id, 'Não consegui desfazer agora. Tente de novo.'));
          }
        }
        await edit(input.chatId, messageId, `Desfeito. Apaguei: ${summaryOf(proposal, today)}.`);
        return void (await answer(input.id, 'Desfeito.'));
      }

      // Daqui em diante só faz sentido enquanto a proposta ainda não foi confirmada.
      if (record.status !== 'pendente') {
        return void (await answer(input.id, record.status === 'confirmando' ? 'Já estou anotando. Um instante.' : 'Já anotado.'));
      }

      if (action === 'ok') {
        if (proposal.kind !== 'tarefa' && proposal.status === 'a_pagar' && proposal.date === null) {
          return void (await answer(input.id, 'Escolha o dia antes de confirmar.'));
        }
        if (!(await captures.beginConfirm(id, now))) return void (await answer(input.id, 'Já anotado.'));
        let entity: { kind: 'tarefa' | 'lancamento'; id: string };
        try {
          entity = await createEntity(userId, proposal, today);
        } catch (error) {
          await captures.abortConfirm(id);
          logger.error('telegram.capture_create_failed', { errorName: errorName(error) });
          const text =
            error instanceof HoraInvalidaError
              ? 'Esse horário não existe no seu fuso (horário de verão). Escolha outro.'
              : 'Não consegui anotar agora. Nada foi salvo. Tente de novo.';
          return void (await answer(input.id, text));
        }
        await captures.finishConfirm(id, entity, clock.now());
        const url = viewUrlOf(proposal);
        const keyboard: InlineKeyboard = [
          [button(id, 'Desfazer', 'undo'), ...(url !== null ? [{ text: 'Ver no Nexus', webAppUrl: url }] : [])],
        ];
        const note =
          proposal.kind === 'conta' || (proposal.kind === 'entrada' && proposal.status === 'a_pagar')
            ? '\nEla aparece no Nexus; o aviso pelo chat ainda não existe.'
            : '';
        await edit(input.chatId, messageId, `Pronto, anotado. ${summaryOf(proposal, today)}.${note}`, keyboard);
        return void (await answer(input.id, 'Anotado.'));
      }

      if (action === 'back') return void (await show(proposal));
      if (action === 'mcat' || action === 'mday' || action === 'mtime') {
        const menu = menuKeyboard(id, proposal, action === 'mcat' ? 'cat' : action === 'mday' ? 'day' : 'time');
        await edit(input.chatId, messageId, menu.text, menu.keyboard);
        return void (await answer(input.id));
      }

      let next: Proposal | null = null;
      const [kind, arg = ''] = action.split('.');
      if (kind === 'cat' && proposal.kind !== 'tarefa') {
        const label = categoriesOf(proposal)[Number(arg)];
        next = label === undefined ? null : { ...proposal, category: label };
      } else if (kind === 'day') next = applyDay(proposal, arg, today);
      else if (kind === 'time') next = applyTime(proposal, arg);
      if (next === null) return void (await answer(input.id, 'Esse botão não vale mais.'));
      if (!(await captures.updatePayload(id, next))) return void (await answer(input.id, 'Já anotado.'));
      return void (await show(next));
    },
  };
}

export type CaptureFlow = ReturnType<typeof makeCaptureFlow>;
