import { todayIn, type CreateFinanceEntryInput, type CreateTaskInput, type FinanceEntryDto, type IsoDate, type TaskDto } from '@nexus/shared';
import { z } from 'zod';
import { addDays, weekdayOf } from '../../domain/calendar.js';
import { interpretCapture, type CaptureProposal } from '../../domain/chat-capture.js';
import type { TelegramErrorClass } from '../../domain/reminder-message.js';
import { InvalidLocalTimeError } from '../../domain/reminders.js';
import type { AssistantLogger } from '../assistant/process-message.js';
import type { CaptureRepository, Clock, InlineKeyboard, ProfileRepository, TelegramClient } from '../ports.js';

/*
 * Registro pelo chat por regras (sem IA). Fluxo: o interpretador lê a mensagem, o bot mostra a proposta com
 * botões e NADA é gravado em tarefas ou lançamentos antes de "Confirmar". A proposta vive em `chat_captures`
 * (uma hora; 24 h depois de confirmada, para o "Desfazer"). Cada botão leva `c:<id>:<ação>` (até 64 bytes).
 *
 * Logs: só nomes de evento e de erro; nunca o texto da mensagem, valores, títulos nem o chat id.
 */

const ISO_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY_FORMAT = /^\d{2}:\d{2}$/;

const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['gasto', 'entrada', 'conta']),
    description: z.string().min(1),
    amountCents: z.number().int().positive(),
    category: z.string().nullable(),
    date: z.string().regex(ISO_DATE_FORMAT).nullable(),
    time: z.string().regex(TIME_OF_DAY_FORMAT).nullable(),
    status: z.enum(['paga', 'a_pagar']),
  }),
  z.object({
    kind: z.literal('tarefa'),
    title: z.string().min(1),
    date: z.string().regex(ISO_DATE_FORMAT).nullable(),
    time: z.string().regex(TIME_OF_DAY_FORMAT).nullable(),
    vagueTime: z.boolean(),
  }),
]);

type Proposal = z.infer<typeof proposalSchema>;
type FinanceProposal = Extract<Proposal, { kind: 'gasto' | 'entrada' | 'conta' }>;
type MenuKind = 'cat' | 'day' | 'time';

/** Resposta quando as regras não entendem a mensagem e não há assistente de IA. */
export const CAPTURE_NOT_UNDERSTOOD_MESSAGE =
  'Não entendi. Tente: gastei 45 no mercado · recebi 800 de um serviço · reunião com a equipe sexta 9h30';

const EXPENSE_CATEGORIES = ['Moradia', 'Mercado', 'Transporte', 'Lazer', 'Saúde', 'Roupas', 'Outra'] as const;
const INCOME_CATEGORIES = ['Salário', 'Freela', 'Outra'] as const;
const TIME_CHOICES = ['09:00', '12:00', '14:00', '16:00', '18:00'] as const;
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
/** Até quantos dias à frente a data é dita com o nome do dia da semana ("sexta, 06/11"). */
const MAX_DAYS_AHEAD_WITH_WEEKDAY = 6;
/** Botões de categoria por linha do teclado. */
const CATEGORY_BUTTONS_PER_ROW = 3;
/** Códigos dos botões de dia -> deslocamento em dias a partir de hoje. */
const DAY_OFFSET_BY_CODE: Record<string, number> = { h: 0, o: -1, a: -2, m: 1, d: 2, w: 7 };
/** `c:<uuid da proposta>:<ação>`; a ação pode ter argumento depois do ponto (`cat.2`, `day.m`, `time.0900`). */
const CALLBACK_DATA_FORMAT = /^c:([0-9a-f-]{36}):([a-z]+(?:\.[0-9a-z]+)?)$/;

const categoriesFor = (proposal: FinanceProposal): readonly string[] =>
  proposal.kind === 'entrada' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
/** Gasto ou entrada já paga: os botões de dia oferecem datas passadas (hoje, ontem, anteontem). */
const isPastEntry = (proposal: Proposal): boolean =>
  proposal.kind !== 'tarefa' && proposal.kind !== 'conta' && proposal.status === 'paga';
/** Lançamento a pagar/receber sem data ainda não pode ser confirmado: falta o vencimento. */
const isMissingDueDate = (proposal: Proposal): boolean =>
  proposal.kind !== 'tarefa' && proposal.status === 'a_pagar' && proposal.date === null;

/** 123456 -> "R$ 1.234,56" (espaço comum). */
export function formatMoney(cents: number): string {
  const wholeReais = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${wholeReais},${String(cents % 100).padStart(2, '0')}`;
}

/** "14:00" -> "14h", "09:30" -> "9h30". */
export function spokenTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return minutes === '00' ? `${Number(hours)}h` : `${Number(hours)}h${minutes}`;
}

/** hoje, amanhã, ontem; até 6 dias à frente "sexta, 06/11"; senão "10/11". */
export function dayText(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'hoje';
  if (date === addDays(today, 1)) return 'amanhã';
  if (date === addDays(today, -1)) return 'ontem';
  const [, month = '', day = ''] = date.split('-');
  const shortDate = `${day}/${month}`;
  for (let daysAhead = 2; daysAhead <= MAX_DAYS_AHEAD_WITH_WEEKDAY; daysAhead += 1) {
    if (date === addDays(today, daysAhead)) return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${shortDate}`;
  }
  return shortDate;
}

const describeWhen = (proposal: Proposal, today: IsoDate): string => {
  if (proposal.date === null) return proposal.kind === 'tarefa' ? 'sem data' : '';
  const day = dayText(proposal.date as IsoDate, today);
  return proposal.time === null ? day : `${day} às ${spokenTime(proposal.time)}`;
};

/** Minúsculas e sem acentos, para comparar categoria e descrição. */
const normalizeForComparison = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Frase curta do que foi entendido, igual antes e depois de confirmar (muda só o prefixo). */
function summarizeProposal(proposal: Proposal, today: IsoDate): string {
  const when = describeWhen(proposal, today);
  if (proposal.kind === 'tarefa') return `${proposal.title}, ${when}`;
  const money = formatMoney(proposal.amountCents);
  // A descrição só aparece quando acrescenta algo à categoria ("roupa" já está em "Roupas"; "uber" não está em "Transporte").
  const category = proposal.category;
  const description = normalizeForComparison(proposal.description);
  const descriptionIsRedundant =
    category !== null &&
    (normalizeForComparison(category).includes(description) || description.includes(normalizeForComparison(category)));
  const descriptionSuffix = category !== null && !descriptionIsRedundant ? ` (${proposal.description})` : '';
  const what = category !== null ? `em ${category}${descriptionSuffix}` : `(${proposal.description})`;
  if (proposal.kind === 'gasto') return `${money} ${what}, ${when}`;
  if (proposal.kind === 'entrada') {
    return proposal.status === 'paga' ? `entrada de ${money} ${what}, ${when}` : `a receber ${money} ${what}, ${when}`;
  }
  return proposal.date === null ? `conta de ${money} ${what}` : `conta de ${money} ${what}, vence ${when}`;
}

/** Texto da proposta: o resumo, quando o aviso vai chegar e o que ainda falta informar. */
function buildProposalMessage(proposal: Proposal, today: IsoDate, earlyMinutes: number): string {
  const lines = [`Anotei: ${summarizeProposal(proposal, today)}.`];
  if (proposal.kind === 'tarefa') {
    if (proposal.date !== null && proposal.time !== null) {
      lines.push(`Aviso: ${earlyMinutes > 0 ? `${earlyMinutes} min antes e na hora` : 'na hora'}.`);
    } else if (proposal.date !== null) lines.push('Aviso: na véspera e no dia, às 8h.');
    if (proposal.vagueTime) lines.push('Você não disse a hora: fica sem horário por enquanto.');
  } else if ((proposal.kind === 'conta' || proposal.status === 'a_pagar') && proposal.date === null) {
    lines.push(proposal.kind === 'conta' ? 'Qual o vencimento?' : 'Quando você recebe?');
  }
  return lines.join('\n');
}

const captureButton = (captureId: string, text: string, action: string) => ({ text, callbackData: `c:${captureId}:${action}` });

function buildProposalKeyboard(captureId: string, proposal: Proposal): InlineKeyboard {
  const confirmRow = isMissingDueDate(proposal) ? [] : [captureButton(captureId, 'Confirmar', 'ok')];
  if (proposal.kind === 'tarefa') {
    const changeRow = [
      captureButton(captureId, 'Mudar dia', 'mday'),
      ...(proposal.date !== null ? [captureButton(captureId, 'Mudar horário', 'mtime')] : []),
    ];
    return [confirmRow, changeRow].filter((row) => row.length > 0);
  }
  const rows: InlineKeyboard = [
    confirmRow,
    [captureButton(captureId, 'Mudar categoria', 'mcat'), captureButton(captureId, 'Mudar data', 'mday')],
  ];
  if (proposal.kind === 'conta') rows.push([captureButton(captureId, 'Mudar horário', 'mtime')]);
  return rows.filter((row) => row.length > 0);
}

const backButtonRow = (captureId: string) => [captureButton(captureId, 'Voltar', 'back')];

/** Submenu de edição (categoria, dia ou horário): pergunta e botões de escolha. */
function buildEditMenu(captureId: string, proposal: Proposal, menu: MenuKind): { text: string; keyboard: InlineKeyboard } {
  if (menu === 'cat' && proposal.kind !== 'tarefa') {
    const categoryButtons = categoriesFor(proposal).map((label, index) => captureButton(captureId, label, `cat.${index}`));
    const perRow = CATEGORY_BUTTONS_PER_ROW;
    return {
      text: 'Qual categoria?',
      keyboard: [
        categoryButtons.slice(0, perRow),
        categoryButtons.slice(perRow, perRow * 2),
        categoryButtons.slice(perRow * 2),
        backButtonRow(captureId),
      ].filter((row) => row.length > 0),
    };
  }
  if (menu === 'day') {
    const dayOptions = isPastEntry(proposal)
      ? [['h', 'Hoje'], ['o', 'Ontem'], ['a', 'Anteontem']]
      : [['h', 'Hoje'], ['m', 'Amanhã'], ['d', 'Depois de amanhã'], ['w', 'Em 1 semana']];
    const question =
      proposal.kind === 'tarefa'
        ? 'Para qual dia?'
        : proposal.kind === 'conta'
          ? 'Qual o vencimento?'
          : isPastEntry(proposal)
            ? 'Foi quando?'
            : 'Quando você recebe?';
    return {
      text: question,
      keyboard: [dayOptions.map(([code, label]) => captureButton(captureId, label!, `day.${code}`)), backButtonRow(captureId)],
    };
  }
  const timeButtons = TIME_CHOICES.map((time) => captureButton(captureId, spokenTime(time), `time.${time.replace(':', '')}`));
  return {
    text: 'Que horas?',
    keyboard: [
      timeButtons.slice(0, 3),
      [...timeButtons.slice(3), captureButton(captureId, 'Sem horário', 'time.none')],
      backButtonRow(captureId),
    ].filter((row) => row.length > 0),
  };
}

/** Aplica o dia escolhido no botão; código desconhecido = `null` (botão antigo ou adulterado). */
function applyDay(proposal: Proposal, dayCode: string, today: IsoDate): Proposal | null {
  const offset = DAY_OFFSET_BY_CODE[dayCode];
  if (offset === undefined) return null;
  return { ...proposal, date: addDays(today, offset) } as Proposal;
}

/** Aplica o horário escolhido (`0900` ou `none`); só aceita horários oferecidos nos botões. */
function applyTime(proposal: Proposal, timeCode: string): Proposal | null {
  if (proposal.date === null) return null;
  if (timeCode === 'none') return { ...proposal, time: null } as Proposal;
  const match = /^(\d{2})(\d{2})$/.exec(timeCode);
  if (match === null) return null;
  const time = `${match[1]}:${match[2]}`;
  if (!TIME_CHOICES.includes(time as (typeof TIME_CHOICES)[number])) return null;
  return { ...proposal, time } as Proposal;
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

const errorNameOf = (error: unknown) => (error instanceof Error ? error.name : 'desconhecido');
const sendFailureCode = (error: TelegramErrorClass): string =>
  error.kind === 'permanent' ? `permanent:${error.reason}` : 'transient';

/** Cria o fluxo de registro por regras: interpretar, propor com botões e tratar os toques (confirmar, editar, desfazer). */
export function makeCaptureFlow(deps: CaptureFlowDeps) {
  const { captures, telegram, clock, logger } = deps;

  /** "Hoje" no fuso do usuário e a antecedência do aviso, que mudam o texto da proposta. */
  async function loadUserContext(userId: string): Promise<{ today: IsoDate; earlyMinutes: number }> {
    const profile = await deps.profiles.get(userId);
    return { today: todayIn(profile.timezone, clock.now()), earlyMinutes: profile.earlyReminderMinutes };
  }

  async function editMessage(chatId: number, messageId: number | null, text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (messageId === null) return;
    const result = await telegram.editMessageText(chatId, messageId, text, keyboard !== undefined ? { keyboard } : undefined);
    if (!result.ok) logger.error('telegram.capture_edit_failed', { code: sendFailureCode(result.error) });
  }

  async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    const result = await telegram.answerCallbackQuery(callbackQueryId, text);
    if (!result.ok) logger.error('telegram.capture_answer_failed', { code: sendFailureCode(result.error) });
  }

  /** Link do botão "Ver no Nexus": tela de tarefas ou de finanças do Mini App. */
  function miniAppViewUrlFor(proposal: Proposal): string | null {
    if (deps.miniAppUrl === undefined) return null;
    const baseUrl = deps.miniAppUrl.replace(/\/+$/, '');
    return `${baseUrl}${proposal.kind === 'tarefa' ? '/mini' : '/mini/financas'}`;
  }

  async function createEntity(
    userId: string,
    proposal: Proposal,
    today: IsoDate,
  ): Promise<{ kind: 'tarefa' | 'lancamento'; id: string }> {
    if (proposal.kind === 'tarefa') {
      const task = await deps.tasks.create(
        userId,
        { title: proposal.title, type: 'tarefa', dueDate: proposal.date as IsoDate | null, dueTime: proposal.time, fatal: false },
        'telegram',
      );
      return { kind: 'tarefa', id: task.id };
    }
    const entry = await deps.finance.create(userId, {
      kind: proposal.kind,
      description: proposal.description,
      amountCents: proposal.amountCents,
      category: proposal.category,
      dueDate: (proposal.date ?? today) as IsoDate,
      status: proposal.status,
      reminderTime: proposal.time,
    });
    return { kind: 'lancamento', id: entry.id };
  }

  return {
    /** Entende a mensagem pelas regras; `null` = não entendeu (quem chamou decide o plano B). */
    async interpret(userId: string, text: string): Promise<CaptureProposal | null> {
      const { today } = await loadUserContext(userId);
      return interpretCapture(text, today);
    },

    /** Grava a proposta e mostra a mensagem com os botões. Nada vira tarefa nem lançamento aqui. */
    async propose(userId: string, chatId: number, proposal: CaptureProposal): Promise<void> {
      const parsed = proposalSchema.parse(proposal);
      const { today, earlyMinutes } = await loadUserContext(userId);
      const record = await captures.create(userId, chatId, parsed, clock.now());
      const sent = await telegram.sendMessage(chatId, buildProposalMessage(parsed, today, earlyMinutes), {
        keyboard: buildProposalKeyboard(record.id, parsed),
      });
      if (!sent.ok) {
        logger.error('telegram.send_failed', { code: sendFailureCode(sent.error) });
        return;
      }
      await captures.setMessage(record.id, sent.messageId);
    },

    /** Trata um toque num botão. `userId` é o dono do chat (já resolvido pelo webhook). */
    async handleCallback(userId: string, input: CaptureCallback): Promise<void> {
      const callbackMatch = CALLBACK_DATA_FORMAT.exec(input.data);
      if (callbackMatch === null) return void (await answerCallback(input.id, 'Esse botão é antigo. Mande a mensagem de novo.'));
      const [, captureId = '', action = ''] = callbackMatch;
      const now = clock.now();
      const record = await captures.get(captureId, now);
      if (record === null) return void (await answerCallback(input.id, 'Essa anotação expirou. Mande a mensagem de novo.'));
      // Segurança: só o dono, no mesmo chat em que a proposta foi feita, pode mexer nela.
      if (record.userId !== userId || record.chatId !== input.chatId) {
        logger.error('telegram.capture_foreign', { code: 'dono_diferente' });
        return void (await answerCallback(input.id));
      }
      const parsed = proposalSchema.safeParse(record.payload);
      if (!parsed.success) return void (await answerCallback(input.id, 'Não consegui ler essa anotação. Mande a mensagem de novo.'));
      const proposal = parsed.data;
      const { today, earlyMinutes } = await loadUserContext(userId);
      const messageId = input.messageId ?? record.messageId;

      const showProposal = async (shown: Proposal): Promise<void> => {
        await editMessage(input.chatId, messageId, buildProposalMessage(shown, today, earlyMinutes), buildProposalKeyboard(captureId, shown));
        await answerCallback(input.id);
      };

      // --- Desfazer (vale depois de confirmada) ---
      if (action === 'undo') {
        const entity = await captures.beginUndo(captureId, now);
        if (entity === null) return void (await answerCallback(input.id, 'Não há mais nada para desfazer.'));
        try {
          if (entity.kind === 'tarefa') await deps.tasks.remove(userId, entity.id);
          else await deps.finance.remove(userId, entity.id);
        } catch (error) {
          // Já não existe (apagado pelo painel): tudo bem, é o que a pessoa queria.
          if (errorNameOf(error) !== 'NotFoundError') {
            await captures.abortUndo(captureId);
            logger.error('telegram.capture_undo_failed', { errorName: errorNameOf(error) });
            return void (await answerCallback(input.id, 'Não consegui desfazer agora. Tente de novo.'));
          }
        }
        await editMessage(input.chatId, messageId, `Desfeito. Apaguei: ${summarizeProposal(proposal, today)}.`);
        return void (await answerCallback(input.id, 'Desfeito.'));
      }

      // Daqui em diante só faz sentido enquanto a proposta ainda não foi confirmada.
      if (record.status !== 'pendente') {
        return void (await answerCallback(input.id, record.status === 'confirmando' ? 'Já estou anotando. Um instante.' : 'Já anotado.'));
      }

      // --- Confirmar: `beginConfirm` reserva a proposta, então dois toques seguidos não criam dois registros ---
      if (action === 'ok') {
        if (isMissingDueDate(proposal)) {
          return void (await answerCallback(input.id, 'Escolha o dia antes de confirmar.'));
        }
        if (!(await captures.beginConfirm(captureId, now))) return void (await answerCallback(input.id, 'Já anotado.'));
        let entity: { kind: 'tarefa' | 'lancamento'; id: string };
        try {
          entity = await createEntity(userId, proposal, today);
        } catch (error) {
          await captures.abortConfirm(captureId);
          logger.error('telegram.capture_create_failed', { errorName: errorNameOf(error) });
          const text =
            error instanceof InvalidLocalTimeError
              ? 'Esse horário não existe no seu fuso (horário de verão). Escolha outro.'
              : 'Não consegui anotar agora. Nada foi salvo. Tente de novo.';
          return void (await answerCallback(input.id, text));
        }
        await captures.finishConfirm(captureId, entity, clock.now());
        const viewUrl = miniAppViewUrlFor(proposal);
        const keyboard: InlineKeyboard = [
          [captureButton(captureId, 'Desfazer', 'undo'), ...(viewUrl !== null ? [{ text: 'Ver no Nexus', webAppUrl: viewUrl }] : [])],
        ];
        const hasNoChatReminderYet =
          proposal.kind === 'conta' || (proposal.kind === 'entrada' && proposal.status === 'a_pagar');
        const note = hasNoChatReminderYet ? '\nEla aparece no Nexus; o aviso pelo chat ainda não existe.' : '';
        await editMessage(input.chatId, messageId, `Pronto, anotado. ${summarizeProposal(proposal, today)}.${note}`, keyboard);
        return void (await answerCallback(input.id, 'Anotado.'));
      }

      // --- Navegação: voltar à proposta ou abrir um submenu de edição ---
      if (action === 'back') return void (await showProposal(proposal));
      if (action === 'mcat' || action === 'mday' || action === 'mtime') {
        const menuKind: MenuKind = action === 'mcat' ? 'cat' : action === 'mday' ? 'day' : 'time';
        const menu = buildEditMenu(captureId, proposal, menuKind);
        await editMessage(input.chatId, messageId, menu.text, menu.keyboard);
        return void (await answerCallback(input.id));
      }

      // --- Escolha dentro de um submenu (`cat.<índice>`, `day.<código>`, `time.<HHmm|none>`) ---
      let updatedProposal: Proposal | null = null;
      const [choiceKind, choice = ''] = action.split('.');
      if (choiceKind === 'cat' && proposal.kind !== 'tarefa') {
        const label = categoriesFor(proposal)[Number(choice)];
        updatedProposal = label === undefined ? null : { ...proposal, category: label };
      } else if (choiceKind === 'day') updatedProposal = applyDay(proposal, choice, today);
      else if (choiceKind === 'time') updatedProposal = applyTime(proposal, choice);
      if (updatedProposal === null) return void (await answerCallback(input.id, 'Esse botão não vale mais.'));
      if (!(await captures.updatePayload(captureId, updatedProposal))) return void (await answerCallback(input.id, 'Já anotado.'));
      return void (await showProposal(updatedProposal));
    },
  };
}

export type CaptureFlow = ReturnType<typeof makeCaptureFlow>;
