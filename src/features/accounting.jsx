import { useState } from "react";
import { DriverReportExport } from "./driver.jsx";
import { LabourShareReport } from "./labourShare.jsx";
import { PayrollView } from "./payroll.jsx";
import { PettyCash } from "./pettycash.jsx";
import { SalesInvoices } from "./salesInvoice.jsx";
import { hasAccess, readRoute, writeRoute } from "../shared/core.jsx";

/* ============ دستیار حسابداری ============
   کارهای واحد حسابداری که سامانه خودش آماده می‌کند، یک‌جا: تنخواه، فاکتور فروش، تسهیم حقوق به پروژه‌ها، حقوق و
   دستمزد و خروجیِ گزارش کار راننده. هر بخش کلیدِ خودش را دارد؛ «تنخواهِ من» برای کسی است که مالی تنخواه‌دارش کرده. */
export const accountingPanes = (session) => [
  hasAccess(session, "accounting.cash") ? { id: "cash", label: "تنخواه" } : session?.pettyHolder && { id: "cash", label: "تنخواهِ من" },
  hasAccess(session, "accounting.invoice") && { id: "invoice", label: "فاکتور فروش" },
  hasAccess(session, "accounting.salary") && { id: "labour", label: "تسهیم حقوق به پروژه‌ها" },
  hasAccess(session, "accounting.payroll") && { id: "payroll", label: "حقوق و دستمزد" },
  hasAccess(session, "accounting.driver") && { id: "driver", label: "گزارش کار راننده" },
].filter(Boolean);

export function AccountingView({ session, drivers, driverReports }) {
  const panes = accountingPanes(session);
  const [pane, setPane] = useState(() => panes.find((p) => p.id === readRoute().sub)?.id || panes[0]?.id);
  const pick = (id) => { setPane(id); writeRoute("accounting", id); };
  const now = panes.find((p) => p.id === pane)?.id || panes[0]?.id;
  // سربرگ را دارد ولی هیچ بخشی نه (مثلاً تنخواه‌داری که برداشته شده): همان پیامِ صفحهٔ تنخواه
  if (!panes.length) return <PettyCash />;
  return (
    <>
      {panes.length > 1 && (
        <div className="seg-row no-print" role="tablist">
          {panes.map((p) => <button key={p.id} role="tab" aria-selected={now === p.id} className={now === p.id ? "seg on" : "seg"} onClick={() => pick(p.id)}>{p.label}</button>)}
        </div>
      )}
      {now === "invoice" ? <SalesInvoices /> : now === "labour" ? <LabourShareReport /> : now === "payroll" ? <PayrollView session={session} />
        : now === "driver" ? <div className="card"><DriverReportExport drivers={drivers} driverReports={driverReports} /></div> : <PettyCash />}
    </>
  );
}
