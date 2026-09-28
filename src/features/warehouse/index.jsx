import { useState } from "react";
import { AssetsPane } from "./assets.jsx";
import { CountsPane } from "./counts.jsx";
import { ItemsPane } from "./items.jsx";
import { ConsumableReviewPane, StockReviewPane } from "./review.jsx";
import { WarehouseSetupPane } from "./setup.jsx";
import { StockPane } from "./stock.jsx";
import { TurnoverPane } from "./turnover.jsx";
import { VoucherPane } from "./vouchers.jsx";
import { hasAccess, readRoute, writeRoute } from "../../shared/core.jsx";

export function WarehouseView({ session }) {
  const [paneWanted, setPaneWanted] = useState(() => {
    const r = readRoute();
    return r.tab === "warehouse" && r.sub ? r.sub : "stock";
  });
  const setPane = (id) => { setPaneWanted(id); writeRoute("warehouse", id); };
  const isManager = hasAccess(session, "warehouse.setup");
  const panes = [
    { id: "stock", label: "موجودی" },
    { id: "vouchers", label: "حواله‌ها" },
    { id: "counts", label: "انبارگردانی" },
    { id: "turnover", label: "گردش کالا" },
    { id: "items", label: "کالاها" },
    { id: "assets", label: "اموال" },
    hasAccess(session, "consumables") && { id: "consumables", label: "مواد مصرفی" },
    hasAccess(session, "stockreview") && { id: "review", label: "بازبینی" },
    isManager && { id: "setup", label: "تعریف و بارگذاری" },
  ].filter(Boolean);
  // بخشی که در نشانی آمده ولی این کاربر به آن دسترسی ندارد → «موجودی».
  const pane = panes.some((p) => p.id === paneWanted) ? paneWanted : "stock";

  return (
    <>
      <div className="sub-tabs no-print">
        {panes.map((p) => (
          <button key={p.id} className={pane === p.id ? "sub-tab on" : "sub-tab"}
            onClick={() => setPane(p.id)}>{p.label}</button>
        ))}
      </div>
      {pane === "stock" && <StockPane session={session} />}
      {pane === "vouchers" && <VoucherPane session={session} />}
      {pane === "counts" && <CountsPane />}
      {pane === "turnover" && <TurnoverPane />}
      {pane === "items" && <ItemsPane />}
      {pane === "assets" && <AssetsPane />}
      {pane === "consumables" && hasAccess(session, "consumables") && <ConsumableReviewPane />}
      {pane === "review" && hasAccess(session, "stockreview") && <StockReviewPane />}
      {pane === "setup" && <WarehouseSetupPane />}
    </>
  );
}
