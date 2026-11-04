import type {
  AssistantMessageInput,
  AssistantReplyDto,
  BriefingDto,
  CalculateDeadlineResultDto,
  CaseDto,
  CaseStatus,
  CreateFinanceEntryInput,
  CreateHolidayInput,
  CreateTaskInput,
  DeadlineRule,
  FinanceEntryDto,
  FinanceStatus,
  HolidayDto,
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
} from '@aj/shared';

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

function codeOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return 'desconhecido';
}

/** Ordem fixa dos parâmetros para URLs estáveis. */
function tasksQueryString(q: ListTasksQuery): string {
  const params = new URLSearchParams();
  if (q.from !== undefined) params.set('from', q.from);
  if (q.to !== undefined) params.set('to', q.to);
  if (q.status !== undefined && q.status.length > 0) params.set('status', q.status.join(','));
  if (q.caseId !== undefined) params.set('caseId', q.caseId);
  if (q.withoutDate !== undefined) params.set('withoutDate', String(q.withoutDate));
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

export type FinanceListQuery = { from?: IsoDate; to?: IsoDate; status?: FinanceStatus };

function financeQueryString(q: FinanceListQuery): string {
  const params = new URLSearchParams();
  if (q.from !== undefined) params.set('from', q.from);
  if (q.to !== undefined) params.set('to', q.to);
  if (q.status !== undefined) params.set('status', q.status);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    if (token === null) {
      opts.onUnauthorized();
      throw new ApiError(401, 'nao_autenticado', null);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiError(0, 'rede', cause);
    }

    if (res.status === 204) return undefined as T;

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized();
      throw new ApiError(res.status, codeOf(payload), payload);
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
    listCases: (status?: CaseStatus) =>
      request<CaseDto[]>('GET', status === undefined ? '/cases' : `/cases?status=${status}`),
    calculateDeadline: (input: DeadlineRule) =>
      request<CalculateDeadlineResultDto>('POST', '/deadlines/calculate', input),
    getSettings: () => request<SettingsDto>('GET', '/settings'),
    updateSettings: (input: UpdateSettingsInput) =>
      request<UpdateSettingsResultDto>('PATCH', '/settings', input),
    listHolidays: () => request<HolidayDto[]>('GET', '/holidays'),
    createHoliday: (input: CreateHolidayInput) => request<HolidayDto>('POST', '/holidays', input),
    deleteHoliday: (id: string) => request<void>('DELETE', `/holidays/${encodeURIComponent(id)}`),
    createLinkCode: () => request<LinkCodeDto>('POST', '/telegram/link-codes'),
    unlinkTelegram: () => request<void>('DELETE', '/telegram/link'),
    listInvites: () => request<InviteListDto>('GET', '/invites'),
    createInvite: () => request<InviteDto>('POST', '/invites'),
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
