import type { IsoDate } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { makeTask } from "@/test/factories";
import {
  canPostpone,
  dateWords,
  nextMonday,
  postponeBase,
  postponeDate,
  postponeInput,
  postponeMessage,
  postponeOptions,
  postponeShortcuts,
  restoreInput,
} from "./postpone";

const d = (s: string) => s as IsoDate;
const wed = d("2026-11-04"); // quarta-feira

describe("nextMonday", () => {
  it("é sempre depois da data, nunca a própria", () => {
    expect(nextMonday(d("2026-11-04"))).toBe("2026-11-09"); // quarta
    expect(nextMonday(d("2026-11-09"))).toBe("2026-11-16"); // segunda
    expect(nextMonday(d("2026-11-08"))).toBe("2026-11-09"); // domingo
    expect(nextMonday(d("2026-11-07"))).toBe("2026-11-09"); // sábado
  });
  it("vira mês e ano", () => {
    expect(nextMonday(d("2026-12-31"))).toBe("2027-01-04");
    expect(nextMonday(d("2026-10-30"))).toBe("2026-11-02");
  });
});

describe("postponeBase", () => {
  it("usa a data da tarefa se é futura; senão, hoje", () => {
    expect(postponeBase(d("2026-11-10"), wed)).toBe("2026-11-10");
    expect(postponeBase(wed, wed)).toBe(wed);
    expect(postponeBase(d("2026-10-01"), wed)).toBe(wed);
    expect(postponeBase(null, wed)).toBe(wed);
  });
});

describe("postponeDate", () => {
  it("atrasada adiada para amanhã vira amanhã, não atual+1", () => {
    expect(postponeDate("amanha", d("2026-10-01"), wed)).toBe("2026-11-05");
  });
  it("tarefa futura parte da própria data", () => {
    expect(postponeDate("amanha", d("2026-11-10"), wed)).toBe("2026-11-11");
    expect(postponeDate("semana", d("2026-11-10"), wed)).toBe("2026-11-17");
    expect(postponeDate("segunda", d("2026-11-10"), wed)).toBe("2026-11-16");
  });
  it("sem data define a data a partir de hoje", () => {
    expect(postponeDate("amanha", null, wed)).toBe("2026-11-05");
    expect(postponeDate("segunda", null, wed)).toBe("2026-11-09");
  });
  it("vira mês, ano e 29/fev", () => {
    expect(postponeDate("amanha", d("2026-12-31"), d("2026-12-31"))).toBe("2027-01-01");
    expect(postponeDate("amanha", null, d("2026-11-30"))).toBe("2026-12-01");
    expect(postponeDate("amanha", null, d("2028-02-28"))).toBe("2028-02-29");
    expect(postponeDate("amanha", null, d("2028-02-29"))).toBe("2028-03-01");
    expect(postponeDate("amanha", null, d("2027-02-28"))).toBe("2027-03-01");
    expect(postponeDate("semana", null, d("2028-02-24"))).toBe("2028-03-02");
  });
  it("fim de semana: de sexta, sábado e domingo a segunda é a próxima", () => {
    expect(postponeDate("segunda", null, d("2026-11-06"))).toBe("2026-11-09");
    expect(postponeDate("segunda", null, d("2026-11-07"))).toBe("2026-11-09");
    expect(postponeDate("segunda", null, d("2026-11-08"))).toBe("2026-11-09");
  });
});

describe("postponeInput e restoreInput", () => {
  it("só envia a data nova (o horário fica como está)", () => {
    const t = makeTask({ dueDate: wed, dueTime: "09:00" });
    expect(postponeInput(t, "amanha", wed)).toEqual({ dueDate: "2026-11-05" });
  });
  it("restaura data e hora anteriores, inclusive vazias", () => {
    expect(restoreInput(makeTask({ dueDate: wed, dueTime: "09:00" }))).toEqual({ dueDate: wed, dueTime: "09:00" });
    expect(restoreInput(makeTask({ dueDate: null, dueTime: null }))).toEqual({ dueDate: null, dueTime: null });
  });
});

describe("postponeShortcuts", () => {
  it("oferece Amanhã e Próxima segunda, com aria-label descritivo", () => {
    const t = makeTask({ title: "Ligar", dueDate: wed });
    const s = postponeShortcuts(t, wed);
    expect(s.map((x) => x.label)).toEqual(["Amanhã", "Próxima segunda"]);
    expect(s[0]!.ariaLabel).toBe("Adiar para amanhã: Ligar");
    expect(s[1]!.ariaLabel).toBe("Adiar para segunda-feira, 09/11: Ligar");
  });
  it("de domingo, segunda é amanhã e não repete", () => {
    const sun = d("2026-11-08");
    expect(postponeShortcuts(makeTask({ dueDate: sun }), sun).map((x) => x.kind)).toEqual(["amanha"]);
  });
  it("tarefa já marcada para amanhã não chama o atalho de Amanhã", () => {
    const s = postponeShortcuts(makeTask({ title: "X", dueDate: d("2026-11-05") }), wed);
    expect(s[0]!.label).toBe("Dia 06/11");
    expect(s[0]!.ariaLabel).toBe("Adiar para sexta-feira, 06/11: X");
  });
  it("concluída e cancelada não têm atalhos", () => {
    expect(postponeShortcuts(makeTask({ status: "concluida" }), wed)).toEqual([]);
    expect(postponeShortcuts(makeTask({ status: "cancelada" }), wed)).toEqual([]);
    expect(canPostpone(makeTask({ status: "em_andamento" }))).toBe(true);
  });
  it("com semana, inclui 1 semana", () => {
    expect(postponeShortcuts(makeTask({ dueDate: wed }), wed, true).map((x) => x.kind)).toEqual(["amanha", "segunda", "semana"]);
  });
});

describe("dateWords", () => {
  it("hoje, amanhã ou dia da semana com data", () => {
    expect(dateWords(wed, wed)).toBe("hoje");
    expect(dateWords(d("2026-11-05"), wed)).toBe("amanhã");
    expect(dateWords(d("2026-11-09"), wed)).toBe("segunda-feira, 09/11");
  });
});

describe("postponeMessage", () => {
  it("diz a ação e a data, com horário quando há", () => {
    const t = makeTask({ title: "Ligar", dueDate: wed, dueTime: "14:00" });
    expect(postponeMessage(t, { dueDate: d("2026-11-05") }, wed)).toBe("Adiada para amanhã, 14h: Ligar.");
  });
  it("prazo fatal deixa claro que o prazo mudou, com a data por extenso", () => {
    const t = makeTask({ title: "Contestação", fatal: true, type: "prazo", dueDate: wed });
    expect(postponeMessage(t, { dueDate: d("2026-11-09") }, wed)).toBe("Prazo fatal movido para segunda-feira, 09/11: Contestação.");
  });
});

describe("postponeOptions", () => {
  it("oferece +1 hora só para tarefa de hoje com horário e vira o dia à meia-noite", () => {
    const t = makeTask({ dueDate: wed, dueTime: "23:30" });
    const hora = postponeOptions(t, wed).find((o) => o.key === "hora");
    expect(hora?.input).toEqual({ dueDate: "2026-11-05", dueTime: "00:30" });
    expect(postponeOptions(makeTask({ dueDate: "2026-11-06", dueTime: "10:00" }), wed).some((o) => o.key === "hora")).toBe(false);
  });
  it("atrasada pode ir para hoje", () => {
    expect(postponeOptions(makeTask({ dueDate: "2026-11-01" }), wed).map((o) => o.key)).toContain("hoje");
  });
  it("amanhã preserva o horário", () => {
    const o = postponeOptions(makeTask({ dueDate: wed, dueTime: "09:00" }), wed).find((x) => x.key === "amanha");
    expect(o?.input).toEqual({ dueDate: "2026-11-05", dueTime: "09:00" });
  });
  it("inclui a próxima segunda", () => {
    const o = postponeOptions(makeTask({ dueDate: wed }), wed).find((x) => x.key === "segunda");
    expect(o?.input.dueDate).toBe("2026-11-09");
  });
});
