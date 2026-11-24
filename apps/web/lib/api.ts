import type {
  AssistantMessageInput,
  AssistantReplyDto,
  BriefingDto,
  CreateFinanceEntryInput,
  CreateTaskInput,
  FinanceEntryDto,
  FinanceStatus,
  InviteDto,
  InviteListDto,
  InterpretCaptureInput,
  InterpretCaptureResultDto,
  IsoDate,
  LinkCodeDto,
  ListTasksQuery,
  MeDto,
  SettingsDto,
  TaskDto,
  UpdateFinanceEntryInput,
  UpdateSettingsInput,
  UpdateSettingsResultDto,
  UpdateTaskInput,
} from '@nexus/shared';
import { HTTP_NO_CONTENT, HTTP_UNAUTHORIZED } from './http';

/** Status usado quando a requisição nem chegou ao servidor (sem resposta HTTP). */
const NETWORK_FAILURE_STATUS = 0;

/** Erro de uma chamada à API: status HTTP, código do corpo (`{ error: "..." }`) e o corpo cru. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`API error ${status} ${code}`);
    this.name = 'ApiError';
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  fetch?: typeof fetch;
};

function errorCodeOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return 'desconhecido';
}

/** Ordem fixa dos parâmetros para URLs estáveis. */
function tasksQueryString(query: ListTasksQuery): string {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.status !== undefined && query.status.length > 0) params.set('status', query.status.join(','));
  if (query.withoutDate !== undefined) params.set('withoutDate', String(query.withoutDate));
  const queryString = params.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

export type FinanceListQuery = { from?: IsoDate; to?: IsoDate; status?: FinanceStatus };

function financeQueryString(query: FinanceListQuery): string {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.status !== undefined) params.set('status', query.status);
  const queryString = params.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

/**
 * Cliente tipado da API do Nexus. Toda chamada leva o token da sessão; sem token (ou com 401) avisa
 * `onUnauthorized` para a tela levar a pessoa ao login. Falhas viram sempre `ApiError`.
 */
export function createApiClient(options: ApiClientOptions) {
  // Sem `fetch` injetado, busca o global no momento de cada chamada (não na criação do cliente).
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await options.getToken();
    if (token === null) {
      options.onUnauthorized();
      throw new ApiError(HTTP_UNAUTHORIZED, 'nao_autenticado', null);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiError(NETWORK_FAILURE_STATUS, 'rede', cause);
    }

    if (response.status === HTTP_NO_CONTENT) return undefined as T;

    // Corpo que não é JSON (ex.: página de erro do proxy) vira null em vez de quebrar a chamada.
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (response.status === HTTP_UNAUTHORIZED) options.onUnauthorized();
      throw new ApiError(response.status, errorCodeOf(payload), payload);
    }
    return payload as T;
  }

  return {
    me: () => request<MeDto>('GET', '/me'),
    listTasks: (query: ListTasksQuery) => request<TaskDto[]>('GET', `/tasks${tasksQueryString(query)}`),
    getTask: (id: string) => request<TaskDto>('GET', `/tasks/${encodeURIComponent(id)}`),
    createTask: (input: CreateTaskInput) => request<TaskDto>('POST', '/tasks', input),
    updateTask: (id: string, input: UpdateTaskInput) =>
      request<TaskDto>('PATCH', `/tasks/${encodeURIComponent(id)}`, input),
    deleteTask: (id: string) => request<void>('DELETE', `/tasks/${encodeURIComponent(id)}`),
    getSettings: () => request<SettingsDto>('GET', '/settings'),
    updateSettings: (input: UpdateSettingsInput) =>
      request<UpdateSettingsResultDto>('PATCH', '/settings', input),
    createLinkCode: () => request<LinkCodeDto>('POST', '/telegram/link-codes'),
    unlinkTelegram: () => request<void>('DELETE', '/telegram/link'),
    listInvites: () => request<InviteListDto>('GET', '/invites'),
    createInvite: (label?: string) => request<InviteDto>('POST', '/invites', label === undefined ? undefined : { label }),
    deleteInvite: (code: string) => request<void>('DELETE', `/invites/${encodeURIComponent(code)}`),
    getBriefing: () => request<BriefingDto>('GET', '/briefing'),
    listFinanceEntries: (query: FinanceListQuery = {}) =>
      request<FinanceEntryDto[]>('GET', `/finance-entries${financeQueryString(query)}`),
    createFinanceEntry: (input: CreateFinanceEntryInput) => request<FinanceEntryDto>('POST', '/finance-entries', input),
    updateFinanceEntry: (id: string, input: UpdateFinanceEntryInput) =>
      request<FinanceEntryDto>('PATCH', `/finance-entries/${encodeURIComponent(id)}`, input),
    deleteFinanceEntry: (id: string) => request<void>('DELETE', `/finance-entries/${encodeURIComponent(id)}`),
    interpretCapture: (input: InterpretCaptureInput) =>
      request<InterpretCaptureResultDto>('POST', '/capture/interpret', input),
    sendAssistantMessage: (input: AssistantMessageInput) =>
      request<AssistantReplyDto>('POST', '/assistant/message', input),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
