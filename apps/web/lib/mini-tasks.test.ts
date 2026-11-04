import type { IsoDate } from "@aj/shared";
import { describe, expect, it } from "vitest";
import { makeTask } from "@/test/factories";
import { pluralTasks, postponeOptions, reminderState, spokenTime, whenLabel } from "./mini-tasks";

const today = "2026-11-03" as IsoDate;

describe("spokenTime", () => {
  it("fala horas cheias e quebradas", () => {
    expect(spokenTime("14:00")).toBe("14h");
    expect(spokenTime("09:30")).toBe("9h30");
  });
});

describe("whenLabel", () => {
  it("explica o atraso sem bronca", () => {
    expect(whenLabel(makeTask({ dueDate: "2026-11-02" }), today)).toBe("Atrasada desde ontem");
    expect(whenLabel(makeTask({ dueDate: "2026-10-30" }), today)).toBe("Atrasada desde 30/10");
  });
  it("junta dia e horário", () => {
    expect(whenLabel(makeTask({ dueDate: today, dueTime: "14:00" }), today)).toBe("Hoje, 14h");
    expect(whenLabel(makeTask({ dueDate: "2026-11-04" }), today)).toBe("Amanhã, sem horário");
    expect(whenLabel(makeTask({ dueDate: null }), today)).toBe("Sem data");
  });
  it("não chama de atrasada uma tarefa concluída", () => {
    expect(whenLabel(makeTask({ dueDate: "2026-11-02", status: "concluida" }), today)).toBe("Ontem, sem horário");
  });
});

describe("reminderState", () => {
  it("só afirma o que sabe", () => {
    expect(reminderState(makeTask({ dueDate: today, dueTime: "14:00" }))).toBe("Agendado para 14h");
    expect(reminderState(makeTask({ dueDate: today }))).toMatch(/^Sem lembrete/);
    expect(reminderState(makeTask({ status: "concluida" }))).toBe("Concluída");
  });
});

describe("postponeOptions", () => {
  it("oferece +1 hora só para tarefa de hoje com horário e vira o dia à meia-noite", () => {
    const t = makeTask({ dueDate: today, dueTime: "23:30" });
    const hora = postponeOptions(t, today).find((o) => o.key === "hora");
    expect(hora?.input).toEqual({ dueDate: "2026-11-04", dueTime: "00:30" });
    expect(postponeOptions(makeTask({ dueDate: "2026-11-05", dueTime: "10:00" }), today).some((o) => o.key === "hora")).toBe(false);
  });
  it("atrasada pode ir para hoje", () => {
    const keys = postponeOptions(makeTask({ dueDate: "2026-11-01" }), today).map((o) => o.key);
    expect(keys).toContain("hoje");
  });
  it("amanhã preserva o horário", () => {
    const o = postponeOptions(makeTask({ dueDate: today, dueTime: "09:00" }), today).find((x) => x.key === "amanha");
    expect(o?.input).toEqual({ dueDate: "2026-11-04", dueTime: "09:00" });
  });
});

describe("pluralTasks", () => {
  it("concorda em número", () => {
    expect(pluralTasks(0)).toBe("Nenhuma tarefa");
    expect(pluralTasks(1)).toBe("1 tarefa");
    expect(pluralTasks(3)).toBe("3 tarefas");
  });
});

import { captureSummary, closedLabel, clockIn, dayTitle, nextUp, timeOnlyLabel } from "./mini-tasks";

describe("timeOnlyLabel", () => {
  it("mostra só o horário", () => {
    expect(timeOnlyLabel(makeTask({ dueTime: "16:30" }))).toBe("16h30");
    expect(timeOnlyLabel(makeTask({ dueTime: null }))).toBe("Sem horário");
  });
});

describe("nextUp", () => {
  const list = [
    makeTask({ id: "a", dueTime: "09:00" }),
    makeTask({ id: "b", dueTime: "14:00" }),
    makeTask({ id: "c", dueTime: "16:30" }),
    makeTask({ id: "d", dueTime: null }),
  ];
  it("pega o primeiro horário que ainda não passou", () => {
    expect(nextUp(list, "13:10")?.id).toBe("b");
    expect(nextUp(list, "14:00")?.id).toBe("b");
  });
  it("devolve null quando nada resta ou sem relógio", () => {
    expect(nextUp(list, "20:00")).toBeNull();
    expect(nextUp(list, null)).toBeNull();
  });
});

describe("clockIn / closedLabel", () => {
  it("usa o fuso informado", () => {
    expect(clockIn("America/Sao_Paulo", new Date("2026-11-03T17:12:00Z"))).toBe("14:12");
    expect(clockIn("Fuso/Invalido", new Date())).toBeNull();
  });
  it("descreve o encerramento", () => {
    const t = makeTask({ status: "concluida", completedAt: "2026-11-03T17:12:00Z" });
    expect(closedLabel(t, "America/Sao_Paulo")).toBe("Concluída às 14h12");
    expect(closedLabel({ ...t, status: "cancelada" }, "America/Sao_Paulo")).toBe("Cancelada às 14h12");
    expect(closedLabel(makeTask({ status: "concluida" }), "America/Sao_Paulo")).toBeNull();
  });
});

describe("dayTitle", () => {
  it("usa Hoje e Ontem, depois a data por extenso", () => {
    expect(dayTitle(today, today)).toBe("Hoje");
    expect(dayTitle("2026-11-02" as IsoDate, today)).toBe("Ontem");
    expect(dayTitle("2026-10-30" as IsoDate, today)).toBe("Sexta-feira, 30 de outubro");
  });
});

describe("captureSummary", () => {
  it("descreve data e horário confirmados", () => {
    expect(captureSummary(today, "14:00", today)).toEqual({ when: "Hoje, 14h", scheduled: true });
    expect(captureSummary("2026-11-04" as IsoDate, "", today)).toEqual({ when: "Amanhã, sem horário", scheduled: true });
    expect(captureSummary("2026-11-10" as IsoDate, "09:30", today).when).toBe("10/11, 9h30");
  });
  it("sem data não agenda", () => {
    expect(captureSummary(null, "", today)).toEqual({ when: "Sem data", scheduled: false });
  });
});
