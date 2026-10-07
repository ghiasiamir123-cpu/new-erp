/* ============ استایل ============ */
export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
html,body{margin:0;background:#F5F8F7}
.app{--paper:#F5F8F7;--card:#fff;--ink:#172A33;--muted:#5C6B66;--line:#E3EBE8;--accent:#147D70;--accent2:#E0F3EF;
  --shadow:0 4px 14px rgba(24,64,69,.04);
  font-family:'Vazirmatn',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;padding:14px}
/* ستون ۶۰۰ پیکسلی برای موبایل است؛ روی نمایشگر بزرگ صفحه باز می‌شود. سربرگ و
   نوار تب‌ها هم باید همان عرض را بگیرند وگرنه تب‌ها اسکرول می‌خورند. چون
   قاعده‌هایشان پایین‌تر آمده، اینجا با .app نوشته می‌شوند تا وزن بیشتری
   داشته باشند. */
@media(min-width:900px){
  .app .wrap,.app .hd-top,.app .tabs{max-width:1080px}
  .app .wrap{padding:18px 20px}
  .app .hd-top{padding:12px 20px}
  .app .tabs{padding:0 16px;overflow-x:visible}
  /* انبار و حقوق جدول پهن دارند و تا ته صفحه باز می‌شوند. */
  .app-wide .wrap,.app-wide .hd-top,.app-wide .tabs{max-width:1560px}
}
.center{display:flex;align-items:center;justify-content:center;min-height:60vh;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}.sm2{font-size:12px}

/* header */
.hd{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.hd-top{max-width:600px;margin:0 auto;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:38px;height:38px;border-radius:10px;background:#fff;flex:0 0 auto;padding:4px;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.mark.big{width:72px;height:72px;border-radius:16px;margin:0 auto 8px;padding:8px}
.brand h1{margin:0;font-size:19px;font-weight:700;letter-spacing:-.3px}.brand p{margin:0;font-size:11.5px;color:var(--muted)}
.who{display:flex;align-items:center;gap:7px}
.who-name{font-size:13px;font-weight:600}
.role-chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:14px;white-space:nowrap}
.logout{background:none;border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-family:inherit;font-size:12px;color:var(--muted);cursor:pointer}
.tabs{max-width:600px;margin:0 auto;padding:0 10px;display:flex;gap:4px;overflow-x:auto}
.tab{background:none;border:none;border-bottom:2.5px solid transparent;padding:9px 12px;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.tab.on{color:var(--accent);border-color:var(--accent)}

/* ---- پوسته: منوی کناری تیره و نوار بالا ---- */
.shell{display:flex;min-height:100vh}
.sb{width:248px;flex:0 0 248px;background:#102C35;color:#DBE7E8;padding:22px 14px 16px;display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto;z-index:20}
.sb-brand{display:flex;align-items:center;gap:11px;padding:0 8px 20px}
.sb-brand .mark{background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.sb-brand b{display:block;color:#fff;font-size:18px;font-weight:700;line-height:1.3}
.sb-brand small{display:block;color:#8FAEB1;font-size:11px}
.sb-close{display:none;margin-inline-start:auto;background:none;border:0;color:#A8C0C1;cursor:pointer;padding:4px;border-radius:8px}
.sb-nav{display:flex;flex-direction:column;gap:14px}
.sb-group{display:flex;flex-direction:column;gap:3px}
.sb-label{color:#7F9C9F;font-size:11px;margin:0 12px 4px}
.sb-item{display:flex;align-items:center;gap:11px;width:100%;min-height:42px;padding:0 12px;border:0;border-radius:9px;
  background:transparent;color:#B8CBCD;font-family:inherit;font-size:13.5px;font-weight:500;text-align:right;cursor:pointer;
  transition:background .15s,color .15s}
.sb-item:hover{background:#173A43;color:#fff}
.sb-item.on{background:#147D70;color:#fff;font-weight:600;box-shadow:0 7px 17px rgba(7,69,64,.28)}
.sb-item svg{flex:none}
.sb-item:focus-visible,.sb-close:focus-visible,.sb-logout:focus-visible{outline:2px solid #83E1D3;outline-offset:2px}
.sb-user{margin-top:auto;display:flex;align-items:center;gap:10px;border-top:1px solid #26464D;padding:16px 6px 0}
.sb-user>div{flex:1;min-width:0}
.sb-user b{display:block;color:#E2EDEC;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-user small{display:block;color:#8FAEB1;font-size:11px}
.sb-logout{background:none;border:0;color:#8FAEB1;cursor:pointer;padding:7px;border-radius:8px;display:grid;place-items:center}
.sb-logout:hover{color:#fff;background:#173A43}
.avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#E7D2BA;color:#7A5939;
  font-weight:700;font-size:14px;flex:none}
.avatar.sm{width:32px;height:32px;font-size:13px}
.avatar.lg{width:72px;height:72px;font-size:28px;border-radius:14px}
.avatar-img{object-fit:cover;background:#F2ECE5;border:1px solid var(--line)}
.user-photo{display:flex;gap:14px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:12px;
  background:#FBFCFB;margin-bottom:14px}
.user-photo-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.user-photo-body b{font-size:13.5px}
.user-photo-body small{color:var(--muted);font-size:12px;line-height:1.7}
.user-photo-body .ghost{padding:6px 14px;flex:0 0 auto}
.top-me{display:flex;align-items:center;gap:9px;background:transparent;border:0;padding:6px 10px;border-radius:10px;
  cursor:pointer;font-family:inherit;text-align:right}
.top-me:hover{background:#F3F7F6}
.top-me:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top-me .top-user-name{display:flex;flex-direction:column}
.top-me .top-user-name b{font-size:13.5px;color:var(--ink);line-height:1.4;font-weight:600}
.top-me .top-user-name small{font-size:11.5px;color:var(--muted)}
/* تولید */
/* «اگر نفر اضافه کنم چه می‌شود؟» (features/planning.jsx → WhatIfDialog) */
.wi-now{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;background:var(--accent2);border-radius:10px;padding:10px 14px;margin-bottom:12px}
.wi-now>span:first-child{font-size:12px;color:var(--muted)}
.wi-good{color:#1B7F5C}.wi-bad{color:#B02A2A}
.wi-best{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.wi-combo{display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-top:1px dashed var(--line)}
.wi-combo:first-of-type{border-top:0}
.wi-n{flex:0 0 auto;background:var(--accent);color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;margin-top:2px}
.wi-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
.wi-chip{font-size:11px;border-radius:999px;padding:2px 9px;white-space:nowrap}
.wi-chip.good{background:#E3F4EC;color:#1B7F5C}.wi-chip.bad{background:#FBE9E9;color:#B02A2A}
.wi-table td{vertical-align:top}.wi-table tr.wi-row.good td{background:#F3FAF6}
.wi-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 10px;align-items:end}
.wi-form select,.wi-form input{width:100%}
.wi-check{display:flex!important;align-items:center;gap:6px;padding-bottom:8px}.wi-check input{width:auto}
.why-box{background:#FFF8E8;border:1px solid #F3D9AD;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.9;margin-bottom:10px}
.crit-card{padding:10px 14px}
.crit-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer;font-size:13px}
.crit-head .linkish{margin-inline-start:auto}
.crit-row{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px dashed var(--line);margin-top:7px}
.crit-n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:#FCE9E9;color:#B02A2A;font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center}
.g-bar.critical::after{content:"";position:absolute;inset-inline:0;bottom:0;height:3px;background:#C62828}
.tbl-scroll .print-table.sk-table th{font-size:10.5px;white-space:normal;min-width:58px;max-width:84px;line-height:1.6;vertical-align:bottom;text-align:center;padding:6px 4px}.tbl-scroll .print-table.sk-table th:first-child{text-align:start;min-width:110px}.sk-table td{text-align:center;padding:6px 4px}.sk-table td.nm{text-align:start;white-space:nowrap;padding-inline:10px}
.sk-table tr.sk-help td{background:#FFF8E8;border-top:2px solid #F3D9AD}
.sk-table .sk-gen{background:#EEF7F2;border-inline-start:2px solid #B7DED1}
.sk-table .sk-fore{background:#EEF1FB;border-inline-start:2px solid #C2CDEA}
.sk-table tr.sk-help td.sk-fore{background:#fff}
.idle-tag.f{background:#33478F;color:#fff}
.idle-tag.m{background:#E7ECFA;color:#33478F}
.pp-tag.f{background:#33478F;color:#fff!important}
.sk-table tr.sk-help td.sk-gen{background:#EEF7F2}
.idle-table td,.idle-table th{text-align:center;white-space:nowrap;padding:6px 7px}
.idle-table td.nm{text-align:start}
.idle-tag{display:inline-block;margin-inline-start:6px;padding:1px 7px;border-radius:999px;background:#E3F4EE;color:#0F7A5A;font-size:10.5px;font-weight:600}
.idle-h{display:inline-block;min-width:22px;padding:1px 5px;border-radius:6px;background:#FDF2E0;color:#B26A00;font-weight:700;font-size:12px}
.idle-f{display:inline-block;min-width:22px;padding:1px 5px;border-radius:6px;background:#E3F4EE;color:#0F7A5A;font-weight:700;font-size:12px;margin-inline-start:3px}
.idle-table button.idle-btn{padding:5px 10px;font-size:12px;white-space:nowrap;min-height:0;width:auto}
.wh-dialog.wide:has(.sk-table){max-width:960px}
.idle-g{display:inline-block;min-width:22px;padding:1px 5px;border-radius:6px;background:#E7ECFA;color:#33478F;font-weight:700;font-size:12px;margin-inline-end:3px}
.idle-mode{display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer;line-height:1.9}
.idle-mode input{margin-top:6px;flex:0 0 auto;width:auto}
.idle-see{margin-top:2px;line-height:1.9}
.idle-open{padding:11px 12px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);background:#fff}
.idle-check{display:flex;gap:6px;align-items:center;justify-content:flex-start;margin-top:6px;font-size:12px;cursor:pointer;white-space:nowrap}
.fld .idle-check input{width:16px;height:16px;min-height:0;flex:0 0 16px;padding:0;margin:0}
.wi-warn{color:#B26A00}
.g-mhead .g-label b{color:#33478F}
.g-mhead{border-top:2px solid #D5DCEE}
.g-cell.load.maint{background:#E3F4EE;color:#0F7A5A;font-weight:700}
.g-cell.load.can{cursor:pointer}
.g-cell.load.can:hover{box-shadow:0 0 0 2px #9CCFBE inset}
.g-mrow .g-label small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-weight:500}
.g-bar.maint{text-align:center;opacity:1}
.g-bar.maint.idle,.g-key.maint.idle{background:#2E9E7B}
.g-bar.maint.must,.g-key.maint.must{background:#3D56B0}
.g-bar.maint.can{cursor:pointer}
.g-bar.site,.g-key.site{background:repeating-linear-gradient(135deg,#8A5A2B 0 8px,#A56E38 8px 16px)}
.g-bar.site{text-align:center;opacity:1}.g-bar.site.can{cursor:pointer}
.g-srow .g-label small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-weight:500}
.g-srow .g-need{color:#B02A2A}
.g-pause.on{border-color:#8A5A2B;color:#8A5A2B;background:#F7EEE3}
.g-pause.ask{border-color:#B02A2A;color:#B02A2A;background:#FBEAEA}
.plan-line.pp-site,.pp-key.site{border-color:#8A5A2B;background:#F7EEE3}
.site-how{display:flex;gap:6px 18px;flex-wrap:wrap;margin-bottom:8px;font-size:13px}
.site-how label,.site-ticks label{display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap}
.site-how input,.site-ticks input{width:16px;height:16px;min-height:0;flex:0 0 16px;padding:0;margin:0}
.site-ticks{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:13px;padding:4px 0}
.site-see{margin:8px 0 2px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.site-see:empty{display:none}
.pp-grid tbody th{white-space:normal;width:130px;min-width:120px}
.pp-grid td.pp-can{cursor:pointer}
.pp-grid td.pp-can:hover{box-shadow:0 0 0 2px #B7DED1 inset}
.pp-tag{display:inline-block!important;margin:2px 0 0 4px;padding:0 6px;border-radius:999px;font-size:10px!important;font-weight:600!important}
.pp-tag.m{background:#E7ECFA;color:#33478F!important}
.pp-tag.g{background:#E3F4EE;color:#0F7A5A!important}
.plan-line.can{cursor:pointer}
.plan-line.pp-job{border-color:var(--accent);background:var(--accent2)}
.plan-line.pp-setup{border-color:#8A9592;background:#F1F4F3}
.plan-line.pp-fill,.pp-key.fill{border-color:#2E9E7B;background:#E3F4EE}
.plan-line.pp-must,.pp-key.must{border-color:#3D56B0;background:#E7ECFA}
.plan-line.pp-idle,.pp-key.idle{border-color:#D9A23B;background:#FDF2E0}
.plan-line.pp-watch,.pp-key.watch{border-color:#33478F;background:#EEF1FB}
.plan-line.pp-leave,.pp-key.leave{border-color:#B9C2C0;background:#F3F3F3;color:var(--muted)}
.pp-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px}
.pp-key{display:inline-block;width:14px;height:10px;border-radius:3px;margin-inline-end:5px;vertical-align:middle;border-inline-start:3px solid}
.pp-key.job{border-color:var(--accent);background:var(--accent2)}
.pp-who{width:auto;min-width:150px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff}
.pp-one tbody th{width:120px}
.idle-form{margin-top:12px;padding:12px;border:1px solid #B7DED1;border-radius:12px;background:#F6FBF8;font-size:13px}
.day-fill{margin-top:10px;font-size:13px;line-height:2}
.col-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px 12px}
.col-grid input{width:100%}
tr.hist-undone td{color:var(--muted);text-decoration:line-through}tr.hist-undone td:last-child{text-decoration:none}
.prod-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.prod-tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.prod-tile span{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}
.prod-tile b{font-size:18px;color:var(--ink);display:block}
.prod-tile small{display:block;color:var(--muted);font-size:11.5px;margin-top:3px}
.prod-tile.ok b{color:#0F7A5A}
.prod-tile.run b{color:#B26A00}
.prod-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.prod-name{flex:1;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prod-name b{font-size:15px}
.pill{font-size:11.5px;padding:2px 9px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.pill.ok{background:#E3F4EE;color:#0F7A5A;border-color:#B7DED1}
.pill.run{background:#FDF2E0;color:#B26A00;border-color:#F3D9AD}
.pill.bad{background:#FCE9E9;color:#B02A2A;border-color:#F0C0C0}
.pill.idle{background:#EEF2F1;color:var(--muted);border-color:var(--line)}
.pill.done{background:#E7ECFA;color:#33478F;border-color:#C2CDEA}
.card.closed{background:#FAFBFC;border-style:dashed}
.card.closed .prod-name b{color:var(--muted)}
.close-note{font-size:12.5px;color:var(--muted);background:#F3F6F9;border:1px solid #E1E8EF;
  border-radius:10px;padding:8px 12px;margin-bottom:8px;line-height:1.9}
.ok-txt{color:#0F7A5A}
.wh-dialog.wide{max-width:640px}
.ref-box{background:#F3F7FB;border:1px solid #D6E2EE;border-radius:10px;padding:10px 12px;
  font-size:13px;line-height:1.9;margin-top:10px}
.ref-box.warn{background:#FFF8EC;border-color:#F3D9AD}
.price-edit{display:flex;gap:6px;align-items:center;margin-top:4px}
.price-line .link-btn{margin-inline-start:8px}
.var-ok{color:#1F8A5B;font-weight:600}
.var-mid{color:#B7791F;font-weight:600}
.var-hi{color:#C53030;font-weight:600}
.rate-in{width:120px;padding:4px 8px;border:1px solid #CBD5E1;border-radius:8px;font:inherit;font-size:13px}
.price-edit input{width:160px;padding:4px 8px;border:1px solid #CBD5E1;border-radius:8px;font:inherit;font-size:13px}
.ref-box .link-btn{margin-inline-start:6px}
.reason-list{display:grid;gap:8px;margin-bottom:12px}
.reason-row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;cursor:pointer;
  border:1px solid var(--line);border-radius:10px;background:#fff}
.reason-row.on{border-color:var(--accent);background:#F2F9F7}
.reason-row.off{opacity:.45;cursor:not-allowed}
.reason-row b{display:block;font-size:13.5px;margin-bottom:2px}
.reason-row small{color:var(--muted);font-size:12px;line-height:1.7}
.bulk-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;
  background:#FDF7EC;border:1px solid #F3D9AD;border-radius:12px;margin-bottom:12px}
.bulk-bar span{flex:1;font-size:13px;color:#8A4B00}
.prod-issues{margin:8px 0 0;padding-inline-start:18px;color:#B02A2A;font-size:12.5px;line-height:1.9}
.prod-stages{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px}
.prod-stage{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#FAFCFB}
.prod-stage.bad{border-color:#F0C0C0;background:#FEF7F7}
.prod-stage-hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.prod-stage-hd b{font-size:13px}
.chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:12px;padding:3px 10px;border-radius:999px;background:#EEF2F1;border:1px solid var(--line)}
.chip.bad{background:#FCE9E9;color:#B02A2A;border-color:#F0C0C0}
.chip-x{border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--muted);
  padding:0 2px;margin-inline-start:6px;font-family:inherit}
.chip-x:hover{color:var(--accent)}
.chk-line{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;cursor:pointer}
.warn-txt{color:#B26A00}
.fld input.need{border-color:#E8A33D;background:#FFFBF4}
.quote-box{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#FAFCFB;margin-top:10px}
.quote-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:6px 0}
.quote-row span{flex:1;color:var(--muted);font-size:13px}
.quote-row b{font-size:15px;color:var(--ink)}
.quote-row small{color:var(--muted);font-size:12px}
.quote-row.main{border-top:1px solid var(--line);margin-top:4px;padding-top:10px}
.quote-row.main b{color:var(--accent);font-size:17px}
.month-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px}
.month-nav b{font-size:15px;min-width:130px;text-align:center}
.month-nav .ghost{flex:0 0 auto;padding:6px 12px}
.plan-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.plan-bar .ghost,.plan-bar .submit{width:auto;flex:0 0 auto;margin:0;padding:8px 16px;white-space:nowrap}
.mini-table select{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:#fff;max-width:260px}
.plan-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:2px 0 8px}
.plan-chips .chip{cursor:pointer;font:inherit;font-size:12px}
.plan-chips .chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.plan-strong td{font-weight:700;background:#F6FAF9}
.plan-days{width:72px;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#FBFCFB;text-align:center}
.mini-table .jp-input{padding:6px 9px;font-size:13px}
.table-scroll{overflow-x:auto}
.plan-grid{border-collapse:collapse;width:100%;min-width:980px;font-size:12.5px}
.plan-grid th,.plan-grid td{border:1px solid var(--line);padding:6px 7px;vertical-align:top;text-align:start}
.plan-grid thead th{background:#F6FAF9;font-weight:700;white-space:nowrap}
.plan-grid thead th span{font-weight:500;color:var(--muted)}
.plan-grid th small{display:block;font-weight:500;color:var(--muted);font-size:11px;white-space:normal;margin-top:2px}
.plan-grid tbody th{background:#F6FAF9;white-space:nowrap;width:110px}
.plan-grid td{min-width:118px;height:54px}
.plan-grid .today{background:#FFFBEA}
.plan-grid td.off,.plan-grid th.off{background:#F3F3F3;color:var(--muted)}
.plan-grid td.past{background:#FAFAFA}
.plan-line{border-inline-start:3px solid var(--accent);background:var(--accent2);border-radius:6px;padding:4px 7px;margin-bottom:4px;line-height:1.7}
.plan-line small{display:block;color:var(--muted);font-size:11.5px}
.plan-line.done{border-color:#1E7D46;background:#E7F5EC}
.plan-line.short{border-color:#D9822B;background:#FFF4E5}
.gantt{overflow-x:auto;position:relative;--g-label:340px}
.g-row{display:flex;align-items:stretch;width:max-content;min-width:100%;border-bottom:1px solid #EEF2F1}
.g-label{position:sticky;inset-inline-start:0;z-index:7;background:var(--card);width:var(--g-label);flex:none;padding:5px 10px;
  display:flex;align-items:center;gap:6px;border-inline-end:1px solid var(--line);font-size:12.5px;overflow:hidden}
.g-label b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.g-head .g-label{font-weight:700;background:#F6FAF9}
.g-head{position:sticky;top:0;z-index:9;background:#F6FAF9}
.g-months,.g-days{display:flex}
.g-months span{flex:none;font-size:11.5px;font-weight:700;padding:3px 6px;border-inline-start:1px solid var(--line);white-space:nowrap;overflow:hidden}
.g-days span{flex:none;width:var(--g-day,28px);text-align:center;font-size:11px;padding:2px 0 3px;border-inline-start:1px solid #EEF2F1}
.g-days small{display:block;font-size:9.5px;color:var(--muted)}
.g-days .fri{background:#EFEFEF;color:var(--muted)}
.g-days .today{background:#FFE9A8;font-weight:700}
.g-project .g-label{background:#F6FAF9}
.g-body .g-project .g-label{padding-block:2px}
.g-ptext{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px}
.g-ptext b{flex:none;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow:hidden;
  font-size:12px;line-height:1.3;overflow-wrap:anywhere}
.g-pmeta{display:flex;align-items:center;gap:6px;min-width:0;height:18px}
.g-pmeta .pill{padding:0 7px;font-size:10.5px;line-height:16px}
.g-pmeta .plan-rank{display:none;min-width:16px;height:16px;font-size:10px}
.g-pmeta .g-pause{line-height:15px}
.g-job .g-label{flex-direction:column;align-items:flex-start;gap:0;padding-inline-start:44px}
.g-stage{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.g-track{position:relative;display:flex;flex:none;min-height:34px}
.g-body{position:relative}
.g-body .g-row{height:58px}
.g-body .g-track{height:57px;min-height:0}
.g-body .g-bar{top:19px}.g-body .g-bar.project{top:20px}.g-body .g-bar.actual{top:25px}.g-body .g-mark{top:23px}
.g-body .g-job .g-label{justify-content:center;gap:6px}
.g-body .g-stage{font-size:12.5px;line-height:1.3}
.g-stage.can{cursor:pointer}
.g-edit{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--muted);white-space:nowrap;line-height:1}
.g-edit button{width:20px;height:20px;padding:0;border:1px solid var(--line);border-radius:5px;background:#fff;color:var(--ink);
  font:inherit;font-size:11px;line-height:1;cursor:pointer}
.g-edit button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.g-edit button:disabled{opacity:.35;cursor:default}
.g-edit input{width:42px;height:20px;padding:0 2px;border:1px solid var(--line);border-radius:5px;font:inherit;font-size:11px;
  text-align:center;background:#FBFCFB;-moz-appearance:textfield}
.g-edit input::-webkit-outer-spin-button,.g-edit input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.g-edit i{width:8px}
.g-edit input.g-crew{width:30px}
.g-edit input.g-crew.own{border-color:#3D6FB6;color:#3D6FB6;font-weight:700}
.g-edit button.g-date{width:auto;padding:0 6px;color:var(--accent);border-color:#BFD9D4;background:var(--accent2);font-weight:600}
.g-pick-back{position:fixed;inset:0;z-index:70}
.g-pick{position:fixed;z-index:71;width:272px}
.g-pick .jp-input{height:0;padding:0;border:0;opacity:0;pointer-events:none;display:block}
.g-pick .jp-pop{position:static;width:272px;box-shadow:0 10px 30px #0004}
.g-edit span{min-width:0}
/* گوشی: ستونِ نام باریک می‌شود و دکمه‌های ریزِ زیرِ نام کنار می‌روند (با زدن روی نامِ مرحله، پنجرهٔ همان کار باز می‌شود). */
@media (max-width:720px){
  .gantt{--g-label:150px}
  .g-label{padding:4px 6px;font-size:11.5px}
  .g-job .g-label{padding-inline-start:10px}
  .g-edit{display:none}
  .g-project .plan-arrows{display:none}
  /* شمارهٔ نوبت به خطِ پایین می‌رود تا نامِ پروژه همهٔ پهنای ستون را بگیرد */
  .g-project .g-label>.plan-rank{display:none}
  .g-pmeta .plan-rank{display:inline-flex}
  .g-project .g-label .pill{display:none}
}
.sub-tabs .sub-tab{white-space:nowrap;flex:1 0 auto}
.g-body .g-label{overflow:hidden}
.g-body .g-job .g-label small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-size:11px}
.g-links{position:absolute;top:0;z-index:2;pointer-events:none;overflow:visible}
.g-links path{stroke:#7d8a87;stroke-width:1.3}
.g-links .head{fill:#7d8a87;stroke:none}
.g-links .late path{stroke:#C62828}.g-links .late .head{fill:#C62828}
.g-body .g-bar{z-index:3}.g-body .g-bar.actual{z-index:1}.g-body .g-mark{z-index:4}
.st-dot{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink);white-space:nowrap}
.st-dot i{width:9px;height:9px;border-radius:50%;flex:none}
.st-dot b{font-weight:700}
.st-bar{display:flex;gap:2px;height:8px;margin-top:6px}
.st-bar i{min-width:4px;border-radius:2px}
.st-bar.tall{height:18px;margin:6px 0 8px}.st-bar.tall i{border-radius:4px}
.st-legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin:6px 0}
.meter{height:6px;border-radius:3px;background:#E3ECEA;overflow:hidden;display:inline-block;width:100%;vertical-align:middle}
.meter i{display:block;height:100%;background:var(--accent);border-radius:3px}
.meter.big{height:10px;border-radius:5px}.meter.big i{border-radius:5px}
.kb{display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}
.kb-col{flex:0 0 232px;background:#F1F5F4;border:1px solid var(--line);border-radius:12px;padding:8px;min-height:120px}
.kb-col.over{outline:2px dashed var(--accent);outline-offset:-2px;background:var(--accent2)}
.kb-hd{padding:2px 4px 8px}
.kb-hd b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kb-hd small{color:var(--muted);font-size:11.5px}
.kb-key{display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:5px}
.kb-hd .kb-key + b{display:inline}
.kb-empty{color:var(--muted);font-size:12px;text-align:center;padding:14px 0}
.kb-card{background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:9px;
  padding:8px 9px;margin-bottom:7px;font-size:12.5px;line-height:1.75;box-shadow:0 1px 2px #0001}
.kb-card.can{cursor:pointer}.kb-card[draggable="true"]{cursor:grab}
.kb-card b{display:block}
.kb-card small{display:block;color:var(--muted);font-size:11.5px}
.kb-stage{color:var(--ink);font-size:12px}
.kb-foot{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:5px}
.cal{display:grid;grid-template-columns:repeat(7,minmax(128px,1fr));min-width:920px}
.cal-hd{background:#F6FAF9;font-weight:700;font-size:12.5px;padding:7px 8px;border-bottom:1px solid var(--line);border-inline-start:1px solid var(--line)}
.cal-day{min-height:104px;padding:5px 6px;border-bottom:1px solid var(--line);border-inline-start:1px solid var(--line);font-size:11.5px}
.cal-day.blank{background:#FAFAFA}
.cal-day.off{background:#F3F3F3}
.cal-day.today{background:#FFFBEA;box-shadow:inset 0 0 0 2px #FFD24D}
.cal-num{display:flex;align-items:baseline;gap:6px;margin-bottom:3px}
.cal-num b{font-size:13px}.cal-num small{color:var(--muted);font-size:10.5px}
.cal-ev{border-inline-start:3px solid #9aa3a1;background:#F4F7F6;border-radius:5px;padding:2px 5px;margin-bottom:3px;line-height:1.6;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cal-ev span{color:var(--muted)}
.cal-ev.done{opacity:.62}
.cal-ev.c0,.cal-key.c0{border-color:#2a78d6}.cal-ev.c1,.cal-key.c1{border-color:#eb6834}.cal-ev.c2,.cal-key.c2{border-color:#1baf7a}
.cal-ev.c3,.cal-key.c3{border-color:#eda100}.cal-ev.c4,.cal-key.c4{border-color:#e87ba4}.cal-ev.c5,.cal-key.c5{border-color:#008300}
.cal-key{display:inline-block;width:0;height:11px;border-inline-start:4px solid #9aa3a1;border-radius:2px}
.st-dot .cal-key{width:0;border-radius:2px}
.cal-plan{color:var(--muted);font-size:10.5px;margin-top:2px}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.dash-card{margin:0}
.dash-pct{display:flex;align-items:center;gap:10px;margin:8px 0 10px}
.dash-pct b{font-size:24px;min-width:62px}
.dash-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 10px;margin-bottom:10px}
.dash-nums span{display:block;color:var(--muted);font-size:11.5px}
.dash-nums b{font-size:13.5px}
.dash-nums small{display:block;color:var(--muted);font-size:11px}
.dash-nums small.bad{color:#B02A2A}
.g-cell{flex:none;width:var(--g-day,28px);border-inline-start:1px solid #F1F5F4}
.g-cell.fri{background:#F3F3F3}
.g-cell.today{background:#FFF6D6}
.g-bar{position:absolute;top:7px;height:20px;border-radius:5px;font-size:10.5px;line-height:20px;color:#fff;padding:0 5px;
  white-space:nowrap;overflow:hidden;z-index:1}
.g-bar.project{background:#24564D;top:8px;height:18px;line-height:18px}
.g-bar.job{background:var(--accent);opacity:.82;text-align:center}
.g-bar.job.manual{background:#3D6FB6;opacity:1}
.g-bar.late{box-shadow:0 0 0 2px #C62828 inset}
.g-bar.actual{background:#B9C2C0;top:13px;height:8px;border-radius:4px;z-index:0}
.g-bar.dry,.g-key.dry{background:repeating-linear-gradient(135deg,#C3CDCB 0 3px,#F2F5F4 3px 7px);border:1px solid #C3CDCB}
.g-bar.dry{z-index:0;padding:0;border-radius:4px}
.g-bar{transition:inset-inline-start .22s ease,width .22s ease}
.gantt.noanim .g-bar{transition:none!important}
.g-bar.grab{cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.g-bar.on{cursor:grabbing;opacity:.92;z-index:6!important;box-shadow:0 6px 16px #0005;outline:2px solid #FFD24D;transition:none;will-change:transform,width}
.g-bar.peer{transition:transform .16s ease,width .16s ease;outline:2px dashed #FFD24D;z-index:5}
.g-ghost{position:absolute;top:8px;height:24px;border:2px dashed var(--accent);background:rgba(20,125,112,.12);border-radius:6px;z-index:2;pointer-events:none}
.g-body .g-ghost{top:17px}
.g-ghost.project{border-color:#24564D}
.g-ghost.stop{border-color:#C62828;background:rgba(198,40,40,.10)}
.gantt.dragging .g-links{opacity:.15}
.g-bar.saving{opacity:.7;outline:2px dashed #FFD24D}
body.g-dragging,body.g-dragging *{cursor:grabbing!important;user-select:none!important}
.g-bar span{pointer-events:none}
.g-tip{display:none;position:fixed;z-index:80;background:#1F2A2C;color:#fff;font-style:normal;font-size:12px;padding:4px 9px;
  border-radius:7px;pointer-events:none;max-width:250px;line-height:1.8;box-shadow:0 4px 12px #0004}
.g-grip{position:absolute;top:0;bottom:0;width:10px;cursor:ew-resize}
.g-grip.s{inset-inline-start:0;border-inline-start:3px solid #fff8}
.g-grip.e{inset-inline-end:0;border-inline-end:3px solid #fff8}
.g-job.done .g-stage{color:var(--muted)}
.g-label.can{cursor:pointer}
.g-hint{padding:10px 12px 8px;line-height:1.9}
.g-zoom{display:flex;align-items:center;gap:6px;padding:10px 12px 0;font-size:12px;color:var(--muted)}
.g-zoom button{width:30px;height:28px;padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:inherit;font-size:16px;line-height:1;cursor:pointer}
.g-zoom button.wide{width:auto;padding:0 10px;font-size:12px;margin-inline-start:6px}
.g-zoom button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.g-zoom button:disabled{opacity:.35;cursor:default}
/* نمودارِ کوچک‌شده: نامِ روزِ هفته جا نمی‌شود؛ خیلی کوچک که شود خطِ میانِ روزها هم برداشته می‌شود و لبه‌های کشیدنی کنار می‌روند. */
.gantt.zs .g-days small{display:none}
.gantt.zs .g-days span{font-size:10px;padding:6px 0}
.gantt.zs .g-grip{width:5px}
.gantt.zxs .g-days span{font-size:9px;overflow:visible;white-space:nowrap;border-inline-start-color:transparent}
.gantt.zxs .g-cell{border-inline-start-color:transparent}
.gantt.zxs .g-cell.load{font-size:8px}
.gantt.zxs .g-grip{display:none}
.gantt.zxs .g-bar{padding:0 1px}
.g-load .g-label{flex-direction:column;align-items:flex-start;gap:0;background:#F6FAF9}
.g-cell.load{font-style:normal;font-size:11px;text-align:center;line-height:34px;color:var(--muted)}
.g-cell.load.over{background:#FCE0E0;color:#B02A2A;font-weight:700}
.g-cell.load.hot{background:#FFF1D6;color:#8A5A00;font-weight:700}
.g-cell.load.some{background:#E7F5EC;color:#1E6B40}
.g-load .g-label .linkish{font-size:11.5px}
.q-trend{display:inline-flex;align-items:center;gap:8px}
.day-sheet .ds-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.day-sheet .ds-head b{font-size:16px}
.day-sheet .ds-head span{font-size:12.5px;color:var(--muted)}
.plan-grid.ds{min-width:0}
/* برنامهٔ هفتگیِ چاپی: هفت روز باید روی یک برگ افقی جا شود */
.plan-grid.wk{min-width:0;table-layout:fixed;font-size:10.5px}
.plan-grid.wk th,.plan-grid.wk td{padding:4px 5px}
.plan-grid.wk td{min-width:0;height:34px}
.plan-grid.wk tbody th{width:104px;white-space:normal;font-size:10.5px}
.plan-grid.wk thead th{white-space:normal;font-size:10.5px}
.plan-grid.wk th small{font-size:9px}
.plan-grid.wk thead th.off{width:64px}
.plan-grid.wk .plan-line{padding:3px 5px;margin-bottom:3px;font-size:10px;line-height:1.5}
.plan-grid.wk .plan-line small{font-size:9px}
.plan-grid.wk tr.sum th,.plan-grid.wk tr.sum td{background:var(--accent2);font-weight:700;height:auto;text-align:center;font-size:10px}
.wk-sheet .doc-head{padding-bottom:9px;margin-bottom:12px}
.wk-sheet .doc-sign{margin-top:16px;padding-top:12px}
.wk-sheet .doc-foot{margin-top:8px}
.plan-grid.ds td{min-width:0;height:40px;vertical-align:middle}
.plan-grid.ds td:nth-child(n+4){text-align:center}
.plan-grid.ds th:nth-last-child(2),.plan-grid.ds td:nth-last-child(2){width:110px}
.plan-grid.ds th:last-child,.plan-grid.ds td:last-child{width:30%}
.day-sheet .ds-foot{display:flex;justify-content:space-between;gap:20px;margin-top:26px;font-size:13px}
@media print{.day-sheet{border:0!important;box-shadow:none!important;padding:0!important}}
.g-key.actual{background:#B9C2C0}
.g-body .g-bar.actual{top:11px;height:5px;border-radius:3px;background:#2E7D32;z-index:2}.g-key.actual{background:#2E7D32;height:5px!important}
.g-base{position:absolute;top:43px;height:5px;border-radius:3px;background:#8A9592;opacity:.75;z-index:1;pointer-events:auto}
.g-gap{position:absolute;top:42px;height:7px;border-radius:3px;z-index:1}
.g-gap.late{background:repeating-linear-gradient(135deg,#C62828 0 3px,#F6D3D3 3px 6px)}
.g-gap.early{background:repeating-linear-gradient(135deg,#2E7D32 0 3px,#D5ECD6 3px 6px)}
.g-key.basek{background:#8A9592;height:5px!important}
.g-key.gapk.late{background:repeating-linear-gradient(135deg,#C62828 0 3px,#F6D3D3 3px 6px)}
.g-key.gapk.early{background:repeating-linear-gradient(135deg,#2E7D32 0 3px,#D5ECD6 3px 6px)}
.g-key.fillk{background:linear-gradient(90deg,#0F3D35 0 45%,var(--accent) 45%)}
.g-fill{position:absolute;inset-block:0;inset-inline-start:0;background:#0003;border-start-start-radius:5px;border-end-start-radius:5px;pointer-events:none}
.g-bar.project .g-fill{background:#0006}
.g-bar>span{position:relative}
.g-bar.job.overdue{background:#B4570B;opacity:1}.g-key.job.overdue{background:#B4570B}
.paused-card .paused-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0;border-top:1px solid var(--line)}
.paused-card .paused-row:first-of-type{border-top:0}
.paused-acts{margin-inline-start:auto;display:flex;gap:8px;align-items:center}
.paused-acts .ghost{padding:5px 12px;flex:none}
.g-pause{flex:none;border:1px solid var(--line);background:var(--card);border-radius:6px;font-size:11px;padding:0 5px;cursor:pointer;line-height:18px}
.g-pause:hover{background:#FDF2E0}
.g-pct{flex:none;position:relative;width:44px;height:14px;border-radius:7px;background:#E3E9E7;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
.g-pct i{position:absolute;inset-block:0;inset-inline-start:0;background:#8CC7A8}
.g-pct small{position:relative;font-size:10px;font-weight:600;color:#123}
.g-mark{position:absolute;top:11px;width:10px;height:10px;transform:rotate(45deg);z-index:2}
.g-mark.base{background:#111;opacity:.75}
.g-mark.due{background:#C62828}
.g-mark.still{position:static;display:inline-block;margin-inline-end:5px}
.g-legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:10px 12px;align-items:center}
.g-key{display:inline-block;width:22px;height:10px;border-radius:3px;margin-inline-end:5px;vertical-align:middle}
.g-key.project{background:#24564D}.g-key.job{background:var(--accent)}.g-key.manual{background:#3D6FB6}
.g-key.late{box-shadow:0 0 0 2px #C62828 inset;background:#fff}
@media print{.gantt{overflow:visible}.g-label{position:static}.g-head{position:static}}
.plan-arrows{display:flex;flex-direction:column;gap:2px}
.plan-arrows button{border:1px solid var(--line);background:#fff;border-radius:6px;width:26px;height:20px;font-size:10px;line-height:1;cursor:pointer;color:var(--ink)}
.plan-arrows button:disabled{opacity:.35;cursor:default}
.plan-rank{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;background:var(--accent2);color:var(--accent);font-size:12.5px;font-weight:700}
.plan-idle{color:#B5560B;font-weight:600}
.plan-day .it-line{padding:3px 0}
.linkish{border:0;background:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-decoration:underline}
.mini-table{width:100%;border-collapse:collapse;font-size:13px}
.mini-table th{text-align:start;color:var(--muted);font-weight:600;font-size:12px;
  padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.mini-table td{padding:7px 8px;border-bottom:1px solid #F1F5F4;white-space:nowrap}
.mini-table tr:last-child td{border-bottom:0}
.bar.sm{height:6px}
.bar.full > div{background:#7C8FC7}
.chat-count{font-size:11px;padding:1px 7px;border-radius:999px;background:#EEF2F1;color:var(--muted);flex:none}
.chat-count.soon{background:#FDF2E0;color:#B26A00}
.chat-count.late{background:#FCE9E9;color:#B02A2A}
@media (max-width:820px){.prod-tiles{grid-template-columns:repeat(2,1fr)}}

/* گفتگو */
.chat-shell{display:grid;grid-template-columns:320px 1fr;gap:14px;height:calc(100vh - 180px);min-height:420px}
.chat-side{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.chat-side-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}
.chat-side-hd b{flex:1}
.chat-list{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1}
.chat-item{display:flex;gap:10px;width:100%;padding:10px 12px;background:transparent;border:0;border-bottom:1px solid #EDF2F0;
  align-items:center;cursor:pointer;font-family:inherit;text-align:right}
.chat-item:hover{background:#F3F7F6}
.chat-item.on{background:#E4F1EF}
.chat-item-body{flex:1;min-width:0}
.chat-item-hd{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.chat-item-hd b{font-size:13.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-item-hd small{color:var(--muted);font-size:11px;flex:none}
.chat-item-sub{display:flex;justify-content:space-between;gap:6px;align-items:center;color:var(--muted);font-size:12px;margin-top:2px}
.chat-item-sub span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-pane{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.chat-conv{display:flex;flex-direction:column;height:100%}
.chat-conv-hd{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}
.chat-conv-hd b{display:block;font-size:14.5px;line-height:1.4}
.chat-conv-hd small{color:var(--muted);font-size:12px}
.chat-msgs{flex:1;overflow-y:auto;padding:14px 16px;background:#F7FAF9;display:flex;flex-direction:column;gap:10px}
.chat-msg{max-width:75%;background:#fff;border:1px solid var(--line);border-radius:14px 14px 14px 4px;
  padding:8px 12px;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.chat-msg.mine{align-self:flex-end;background:#DFF3EE;border-color:#B7DED1;border-radius:14px 14px 4px 14px}
.chat-msg-from{font-size:11.5px;color:var(--accent);font-weight:600;margin-bottom:2px}
.chat-msg-text{font-size:13.5px;line-height:1.8;word-wrap:break-word;white-space:pre-wrap}
.chat-msg small{display:block;font-size:10.5px;color:var(--muted);margin-top:2px;text-align:end}
.chat-msg-img{max-width:100%;max-height:220px;border-radius:8px;display:block;margin-bottom:4px}
.chat-msg-file{display:inline-flex;gap:6px;align-items:center;color:var(--accent);text-decoration:none;font-weight:600;font-size:13px}
.chat-file-pin{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#FDF7EC;border-top:1px solid #F3D9AD}
.chat-file-pin img{max-height:44px;border-radius:6px}
.chat-file-pin span{flex:1;color:#8A4B00;font-size:13px}
.chat-composer{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line);align-items:flex-end;background:#fff}
.chat-composer textarea{flex:1;font-family:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:10px;
  padding:9px 12px;resize:none;max-height:120px;line-height:1.7}
.pick-row.on{background:#E4F1EF}
@media (max-width:820px){.chat-shell{grid-template-columns:1fr;height:auto}.chat-side,.chat-pane{min-height:380px}}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.main>.wrap{width:100%}
.topbar{height:64px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;
  padding:0 28px;position:sticky;top:0;z-index:10}
.menu-btn{display:none;background:none;border:0;color:var(--accent);cursor:pointer;padding:6px;border-radius:8px}
.menu-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.crumb{display:flex;align-items:center;gap:9px;font-size:13px;color:#8A9C9A;min-width:0}
.crumb b{color:#23454B;font-weight:700;white-space:nowrap}
.crumb .sep{color:#C4CECC}
.top-user{margin-inline-start:auto;display:flex;align-items:center;gap:10px}
.top-user .today{font-size:12px;color:var(--muted);padding-inline-end:14px;border-inline-end:1px solid var(--line);white-space:nowrap}
.top-user-name b{display:block;font-size:12.5px;color:#24454B;line-height:1.4}
.top-user-name small{display:block;font-size:11px;color:#7F918F}
.sb-overlay{display:none}
@media(max-width:900px){
  .sb{position:fixed;top:0;bottom:0;right:-270px;width:256px;height:auto;transition:right .25s ease;box-shadow:-8px 0 30px rgba(12,52,56,.18)}
  .sb.open{right:0}
  .sb-close{display:grid;place-items:center}
  .sb-overlay{display:block;position:fixed;inset:0;background:rgba(13,35,39,.42);border:0;z-index:15;cursor:pointer}
  .menu-btn{display:grid;place-items:center}
  .topbar{padding:0 14px;height:58px}
  .top-user .today,.top-user-name{display:none}
}
@media(prefers-reduced-motion:reduce){.sb,.sb-item,.submit,.ghost{transition:none}}

/* login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;width:100%;max-width:340px;text-align:center}
.login-card h1{margin:0;font-size:24px}.login-card .sub{margin:2px 0 18px;color:var(--muted);font-size:13px}
.login-card .fld{text-align:right}
.login-wrap{gap:36px}
.login-hero{display:none;order:2;width:min(560px,50vw);border-radius:18px;border:1px solid var(--line)}
@media(min-width:900px){.login-hero{display:block}}
.dash-banner{position:relative;margin-bottom:14px;border-radius:14px;overflow:hidden;height:clamp(96px,13vw,170px);background:url(/dashboard-banner.webp) left center/auto 100% no-repeat,var(--paper);border:1px solid var(--line)}
.dash-banner div{position:absolute;inset:0 0 0 auto;display:flex;flex-direction:column;justify-content:center;padding:0 22px 0 48px;background:linear-gradient(to left,var(--paper) 72%,transparent)}
.dash-banner b{font-size:clamp(16px,2vw,24px);color:var(--ink)}.dash-banner span{font-size:clamp(11px,1.2vw,14px);color:var(--muted)}
.pulse{display:flex;flex-direction:column;gap:12px;margin-bottom:14px}.pulse .card{margin:0}
.pulse-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.pulse-head .seg-row{margin-bottom:6px;align-items:center}.pulse-date{min-width:150px}
.pulse-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){.pulse-grid{grid-template-columns:1fr}}
.pulse-bar{position:relative;display:flex;height:12px}.pulse-bar>div{border-radius:0}
.pulse-bar>div:first-child{border-radius:0 6px 6px 0}
.pulse-bar .pend{background:var(--accent);opacity:.35}
.pulse-bar i{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);border-radius:1px}
.pulse-v{min-width:120px;font-variant-numeric:tabular-nums}
.bar>div.hot{background:#C53030}.pulse-hot{background:#FDECEC;color:#C53030;border-color:#F5C2C2;margin-inline-end:4px}
.mc-gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media(max-width:900px){.mc-gauges{grid-template-columns:1fr}}
.mc-gauge{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--paper)}
.mc-gauge p{font-size:12.5px;line-height:1.8;margin:8px 0 6px;color:var(--ink)}
.mc-g-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.mc-g-num{margin:6px 0 8px;font-size:13px}.mc-g-num b{font-size:22px;font-variant-numeric:tabular-nums}
.mc-scale{position:relative;height:10px;border-radius:6px;background:#E6ECEA}
.mc-scale .band{position:absolute;top:0;bottom:0;background:#BFE3D6;border-radius:6px}
.mc-scale i{position:absolute;top:-4px;width:4px;height:18px;border-radius:2px;background:var(--ink);transform:translateX(50%)}
.mc-scale i.mc-ok{background:#0F7A5A}.mc-scale i.mc-high{background:#C53030}.mc-scale i.mc-low{background:#B7791F}
.pill.mc-ok{background:#E3F4EC;color:#0F7A5A}.pill.mc-high{background:#FDECEC;color:#C53030}
.pill.mc-low{background:#FDF3E1;color:#B7791F}.pill.mc-miss{background:#EEF1F0;color:var(--muted)}
.mc-notes{display:flex;flex-direction:column;gap:6px;margin-top:10px;font-size:12.5px;color:var(--ink)}
.profit-rows{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.profit-hd{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:4px}
.profit-hd b{font-variant-numeric:tabular-nums}
.empty-art{display:block;width:min(200px,60%);height:auto;margin:0 auto 12px;opacity:.95}
.err{color:#B23A3A;font-size:12.5px;margin:-4px 0 8px}
.demo{margin-top:16px;font-size:11.5px;color:var(--muted);line-height:2}
.demo code{background:#F1F3F1;padding:1px 6px;border-radius:5px;font-family:inherit}

/* fields */
.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow)}
.fld{display:block;margin-bottom:12px}.fld.sm{margin-bottom:0}
.fld>span{display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:500}
.fld input,.fld select,.fld textarea,.filters select{width:100%;font-family:inherit;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;outline:none;transition:border-color .15s}
.fld input:focus,.fld select:focus,.fld textarea:focus{border-color:var(--accent);background:#fff}
.fld textarea{resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.sup-line{font-size:12.5px;color:var(--muted);margin:2px 0 14px}

/* items editor */
.items-hd,.board-h{font-size:13.5px;font-weight:700;margin:6px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.items-hd.sub{font-size:12px;font-weight:600;color:var(--muted);border-bottom:none;margin:4px 0 6px;padding-bottom:0}
.delay-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.delay-row input{flex:1;font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:#FBFCFB}
.item-row{display:flex;gap:8px;align-items:flex-start;background:#F8FAF9;border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:9px}
.item-num{width:22px;height:22px;border-radius:50%;background:var(--accent2);color:var(--accent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}
.item-body{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.item-del{background:none;border:none;color:#B23A3A;font-size:20px;cursor:pointer;line-height:1;padding:0 2px}
.hint-remaining{font-size:11.5px;color:var(--accent);background:var(--accent2);border-radius:7px;padding:5px 9px;margin-top:-2px}
.hint-remaining.warn{color:#B5560B;background:#FFF4E5}
.new-mat-box{display:flex;flex-direction:column;gap:8px;background:#fff;border:1px dashed var(--accent);border-radius:10px;padding:10px;margin-top:4px}
.add-row{width:100%;background:var(--accent2);color:var(--accent);border:1px dashed var(--accent);border-radius:10px;padding:9px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;margin-bottom:14px}
.btn-row{display:flex;gap:9px}
.section-save{width:100%;background:#fff;color:var(--accent);border:1.5px solid var(--accent);border-radius:10px;padding:9px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;margin-bottom:16px}
.section-save:disabled{opacity:.45;cursor:not-allowed}
.draft-note{font-size:12px;color:var(--accent);background:var(--accent2);border-radius:9px;padding:8px 11px;margin-bottom:10px}
.act.edit{background:#4A7BA6}
.edit-box{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.submit{flex:1;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer;
  box-shadow:0 6px 14px rgba(20,125,112,.2);transition:background .15s,box-shadow .15s,transform .15s}
.submit:hover:not(:disabled){background:#0D685E;box-shadow:0 9px 18px rgba(20,125,112,.27);transform:translateY(-1px)}
.submit:disabled{opacity:.45;cursor:not-allowed}
.submit-warn{flex:1;background:#E8A33D;color:#1F2A2C;border:none;border-radius:10px;padding:12px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer;
  box-shadow:0 6px 14px rgba(232,163,61,.3);transition:background .15s,box-shadow .15s,transform .15s}
.submit-warn:hover:not(:disabled){background:#C6871B;box-shadow:0 9px 18px rgba(232,163,61,.35);transform:translateY(-1px)}
.submit-warn:disabled{opacity:.45;cursor:not-allowed}
.ghost{flex:1;background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:10px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
  transition:border-color .15s,color .15s}
.ghost:hover:not(:disabled){border-color:#9CC7BF;color:var(--accent)}
.ghost:disabled{opacity:.45}
.ok-msg{text-align:center;color:#1E7D46;font-size:13.5px;margin-top:11px;font-weight:600}

/* jalali picker */
.jp{position:relative}
.jp-input{width:100%;text-align:right;font-family:inherit;font-size:14px;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;cursor:pointer;color:var(--ink)}
.jp-pop{position:absolute;top:calc(100% + 6px);right:0;left:auto;width:max(100%,272px);max-width:calc(100vw - 24px);background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px #0002;padding:12px;z-index:60}
.jp-pop.flip{right:auto;left:0}
.jp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;font-size:14px}
.jp-head button{background:#F1F3F1;border:none;width:28px;height:28px;border-radius:8px;font-size:17px;cursor:pointer;color:var(--ink)}
.jp-week{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
.jp-week span{text-align:center;font-size:11px;color:var(--muted);font-weight:600}
.jp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.jp-day{aspect-ratio:1;border:none;background:none;border-radius:8px;font-family:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
.jp-day:hover{background:var(--accent2)}
.jp-day.sel{background:var(--accent);color:#fff;font-weight:700}
.jp-today{width:100%;margin-top:8px;background:var(--accent2);color:var(--accent);border:none;border-radius:8px;padding:7px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.jp-foot{display:flex;gap:6px}
.pick-row{display:flex;gap:6px;align-items:stretch}
.pick-row select{flex:1;min-width:0}
.pick-row .ghost{white-space:nowrap;font-size:12px;padding:0 10px}
.jp-input.empty{color:var(--muted);padding:9px 11px;text-align:right;background:#FBFCFB;border:1px solid var(--line);border-radius:10px;font-size:14px}

/* filters */
.filters{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;align-items:start}
.filters select{padding:9px 10px;font-size:13px}
.date-fil{font-family:inherit;font-size:13px;border:1px solid var(--accent);background:var(--accent2);color:var(--accent);border-radius:10px;padding:9px;cursor:pointer;font-weight:600}
.date-fil-wrap .jp-input{font-size:13px;padding:9px 10px}

/* report card */
.report{padding:15px}
.rep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:11px}
.rep-head.clickable{cursor:pointer}
.rep-head-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.rep-toggle{font-size:11px;color:var(--muted);white-space:nowrap}
.rep-date{font-weight:700;font-size:15px}
.rep-meta{font-size:12px;color:var(--muted);margin-top:1px}
.status-chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:16px;white-space:nowrap}
.kind-chip{font-size:11px;font-weight:600;color:var(--muted);background:#EEF2F0;padding:4px 10px;border-radius:16px;white-space:nowrap}

/* ---- انبار ---- */
.wh-search{width:100%;font-family:inherit;font-size:14px;border:1px solid var(--line);
  border-radius:10px;padding:10px 12px;background:#fff}
.wh-search:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.wh-toggles{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12.5px;color:var(--muted)}
.wh-toggles label{display:flex;align-items:center;gap:6px;cursor:pointer}
.wh-toggles input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.wh-table{min-width:1080px}
.wh-table td{vertical-align:middle}
.wh-name{text-align:right;min-width:230px;font-weight:600}
.wh-sub{display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;font-size:10.5px;font-weight:400;color:var(--muted)}
.wh-flag{background:#EEF2F0;border-radius:10px;padding:1px 7px}
/* تعریف کالا: بسته‌بندی جدا کادر می‌شود چون بیشترین اشتباه همان‌جا رخ می‌دهد */
.pack-box{background:#FAFBFA;border:1px solid var(--line);border-radius:12px;padding:12px 12px 2px;margin:4px 0 12px}
.more-box{border-top:1px solid var(--line);padding-top:8px;margin-bottom:10px}
.more-box summary{font-size:12.5px;color:var(--muted);cursor:pointer;padding:2px 0}
.wh-off{opacity:.55}
/* انتخاب ماده در فرم مصرف: دکمه‌ای به شکل فیلد، که پنجرهٔ فهرست انبار را باز می‌کند */
.pick-field{width:100%;min-height:40px;text-align:right;font-family:inherit;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;cursor:pointer}
.pick-field small{color:var(--muted);font-size:11.5px}
.pick-field.empty{color:var(--muted)}
/* ادغام ماده: از ← به */
.merge-summary{display:flex;align-items:center;gap:10px;margin:6px 0 12px}
.merge-summary>div:not(.merge-arrow){flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;background:#FAFBFA}
.merge-summary small{color:var(--muted);font-size:11.5px}
.merge-arrow{font-size:20px;color:var(--accent)}
/* کارتابل مالی */
.status-chip.fin-pending{background:#FFF4E0;color:#9A5B00;margin-inline-start:4px}
.status-chip.fin-returned{background:#FDECEC;color:#B23A3A;margin-inline-start:4px}
.status-chip.fin-approved{background:#E4F1EF;color:#0F6E64;margin-inline-start:4px}
.fin-return-note{margin-top:6px;font-size:12px;color:#B23A3A;display:flex;flex-direction:column;gap:2px;align-items:flex-start;max-width:260px;white-space:normal}
.wh-dialog.fin-dialog{max-width:1040px}
.fin-head{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 10px}
.fin-head>div,.fin-summary>div{border:1px solid var(--line);border-radius:10px;padding:7px 10px;display:flex;flex-direction:column;background:#FAFBFA}
.fin-head span,.fin-summary span{font-size:11.5px;color:var(--muted)}
.fin-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.fin-summary.warn>div:last-child{border-color:#E6B3B3;background:#FDF3F3;color:#B23A3A}
.fin-lines .wh-cell{width:90px}
.fin-lines .wh-cell.wide{width:130px}
.fin-mismatch td{background:#FDF6EC}
.fin-warn-li{color:#9A5B00}
.access-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:2px 14px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line)}
.access-item{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink);cursor:pointer;padding:2px 0}
.access-item.sub{color:var(--muted)}
.access-item input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.access-item input:disabled{cursor:not-allowed}
@media(max-width:700px){.fin-head,.fin-summary{grid-template-columns:1fr 1fr}}
.merge-notes{margin:0 0 12px;padding-right:18px;font-size:12.5px;color:var(--muted);line-height:1.9}
.fld input:disabled{color:var(--muted);background:#F3F6F5}
.wh-flag.haz{background:#FBEFF1;color:#B5560B}
.wh-qty{font-weight:700;font-variant-numeric:tabular-nums}
.wh-qty.low{color:#B5560B}
.wh-qty.total{background:var(--accent2);color:var(--accent)}
.wh-unit{font-size:10px;font-weight:400;color:var(--muted)}
/* «صفرِ شمرده‌نشده» نباید مثل عدد قطعی دیده شود */
.wh-unknown{font-size:11px;font-weight:500;color:#9A7B3F;background:#FBF3E2;
  border-radius:9px;padding:2px 8px;white-space:nowrap;cursor:help}
.wh-entered{font-size:10px;color:var(--muted);font-weight:400;margin-top:2px}
.unit-hint{background:var(--accent2);color:var(--accent);border-radius:8px;padding:7px 11px;
  font-size:12px;margin:-4px 0 10px}
tr.wh-low td{background:#FDF6F0}
.wh-cell{width:74px;font-family:inherit;font-size:12px;text-align:center;border:1px solid transparent;
  border-radius:6px;background:#FCFAF4;padding:4px}
.wh-cell:hover{border-color:var(--line)}
.wh-cell:focus{outline:2px solid var(--accent);border-color:transparent;background:#fff}
.wh-cell.narrow{width:54px}
.wh-actions{white-space:nowrap;display:flex;gap:6px;align-items:center;justify-content:center}
.wh-pager{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px;
  font-size:12.5px;color:var(--muted)}
.wh-pager .ghost{width:auto;margin:0;padding:6px 14px}
.wh-dialog{background:var(--card);border-radius:14px;padding:20px;max-width:520px;width:100%;
  margin:0 auto;box-shadow:0 10px 40px #0004}
.wh-dialog.wide{max-width:820px}
.wh-dialog-item{background:var(--accent2);border-radius:10px;padding:10px 12px;margin-bottom:12px}

/* ---- زیرتب‌ها و حواله ---- */
.sub-tabs{display:flex;gap:6px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;padding:5px;margin-bottom:16px;overflow-x:auto;box-shadow:var(--shadow)}
.sub-tab{flex:1;min-width:96px;background:none;border:none;border-radius:9px;padding:9px 12px;
  font-family:inherit;font-size:13px;color:var(--muted);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.sub-tab:hover:not(.on){background:var(--accent2);color:var(--accent)}
.sub-tab.on{background:var(--accent);color:#fff;font-weight:600;box-shadow:0 6px 14px rgba(20,125,112,.2)}
.sub-count{display:inline-grid;place-items:center;min-width:20px;height:18px;padding:0 6px;margin-inline-start:6px;
  border-radius:9px;background:#E8A33D;color:#1F2A2C;font-size:11px;font-weight:700;vertical-align:middle}
.sub-tab.on .sub-count{background:#fff;color:var(--accent)}
.filters input.filter-q{width:100%;font-family:inherit;font-size:13px;color:var(--ink);border:1px solid var(--line);
  border-radius:10px;padding:9px 10px;background:#FBFCFB;outline:none}
.filters input.filter-q:focus{border-color:var(--accent)}
.rep-sum{font-size:12.5px;color:var(--muted);margin:-4px 2px 10px}
/* علتِ خاموش بودنِ دکمهٔ ثبت، زیرِ همان دکمه */
.why-off{margin-top:8px;font-size:12.5px;line-height:1.9;color:#8A4B08;background:#FFF6E8;border:1px solid #F3D9AD;
  border-radius:9px;padding:5px 10px;text-align:right}
.why-off b{font-weight:700}
.area-gap{margin:10px 0 14px;padding:11px 13px;border:2px solid #C62828;border-radius:11px;background:#FDECEC;color:#8E1B1B;font-size:13px;line-height:2}
.area-gap-hd{font-weight:800;font-size:14px}
.area-gap ul{margin:4px 0 0;padding:0 18px 0 0}
.area-gap-days{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.area-gap-days button{border:1px solid #C62828;background:#fff;color:#8E1B1B;border-radius:8px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}
.vc-num{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.vc-dir{font-size:11px;font-weight:700;border-radius:6px;padding:1px 6px}
.vc-dir.in{background:#E4F1EF;color:#1E7D46}
.vc-dir.out{background:#FBEFF1;color:#B5560B}
.vc-posted{color:#1E7D46;background:#1E7D4616}
.vc-open{color:#B9812A;background:#B9812A16}
tr.vc-draft td{background:#FDFBF5}
.vc-line-name{font-size:12.5px;font-weight:600;margin-bottom:5px}
.pick-list{max-height:340px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;margin:10px 0}
.pick-row{display:block;width:100%;text-align:right;background:none;border:none;
  border-bottom:1px solid #F1F4F2;padding:9px 12px;cursor:pointer;font-family:inherit}
.pick-row:hover{background:var(--accent2)}
.pick-name{display:block;font-size:13px;font-weight:600}
.pick-sub{display:block;font-size:11px;color:var(--muted);margin-top:2px}
.wh-check{display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0;cursor:pointer}
.wh-check input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
.import-report{background:#F7F9F8;border:1px solid var(--line);border-radius:9px;padding:12px;
  margin-top:12px;font-size:12px;line-height:1.9;white-space:pre-wrap;direction:rtl;max-height:280px;overflow:auto}

/* ---- بازهٔ تاریخ گزارش مالی ---- */
.range-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.range-fld{display:flex;flex-direction:column;gap:4px;min-width:0}
.range-fld>span{font-size:12px;color:var(--muted)}
.range-note{font-size:12px;color:var(--accent);background:var(--accent2);border-radius:9px;
  padding:8px 11px;margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.link-btn{margin-inline-start:auto;background:none;border:none;font-family:inherit;font-size:12px;
  color:var(--muted);text-decoration:underline;cursor:pointer;padding:0}
.link-btn:hover{color:var(--ink)}
@media(max-width:520px){.range-row{grid-template-columns:1fr}}

/* ---- حقوق و دستمزد ---- */
.app{--pay-crimson:#A63149;--pay-teal:#146B66;--pay-amber:#B9812A;--pay-calc:#FBF6EB}
.pay-bar{display:flex;gap:18px;flex-wrap:wrap;align-items:center;background:var(--pay-calc);
  border:1px solid #EFE7D5;border-radius:12px;padding:12px 16px;margin-bottom:14px}
.pay-stat span{font-size:11.5px;color:var(--muted);display:block}
.pay-stat b{font-size:16px;color:var(--pay-amber);direction:ltr;display:block;font-variant-numeric:tabular-nums}
.pay-month{margin-inline-start:auto;display:flex;align-items:center;gap:8px}
.pay-month label{font-size:11.5px;color:var(--muted)}
.pay-month select{font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:6px 10px}
.pay-open{display:flex;gap:8px;margin-bottom:6px}
.pay-open input{flex:1;font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff}
.pay-open .submit{width:auto;padding:8px 16px;margin:0}
.pay-toggle{width:100%;text-align:right;background:none;border:none;font-family:inherit;font-size:13.5px;
  font-weight:600;color:var(--accent);cursor:pointer;padding:2px 0}
.pay-settings{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
.pay-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.pay-table{border-collapse:separate;border-spacing:0;min-width:1900px;width:100%;font-size:12px}
.pay-table thead th{position:sticky;top:0;background:#F0EADC;color:var(--ink);font-weight:600;font-size:10.5px;
  padding:7px 5px;border-bottom:2px solid var(--line);white-space:nowrap;text-align:center;z-index:2}
.pay-table thead th.g-r{background:#F4E4E7;color:var(--pay-crimson)}
.pay-table thead th.g-g{background:#E1EFEC;color:var(--pay-teal)}
.pay-table td{padding:3px 4px;border-bottom:1px solid #F1ECDE;text-align:center;white-space:nowrap;
  direction:ltr;font-variant-numeric:tabular-nums}
.pay-table td.stick,.pay-table th.stick{position:sticky;right:0;background:var(--card);z-index:1;
  direction:rtl;text-align:right;min-width:120px;box-shadow:-6px 0 6px -6px rgba(0,0,0,.12)}
.pay-table td.c-r{background:#FBEFF1;font-weight:600}
.pay-table td.c-g{background:#E9F3F1;font-weight:600}
.pay-table td.c-t{background:var(--ink);color:#fff;font-weight:700}
.pay-table input{font-family:inherit;font-size:12px;direction:ltr;text-align:left;border:1px solid transparent;
  border-radius:6px;background:#FCFAF4;padding:4px;width:74px;color:var(--ink)}
.pay-table input:hover{border-color:var(--line)}
.pay-table input:focus{outline:2px solid var(--pay-amber);border-color:transparent;background:#fff}
.pay-table input.w-name{width:104px;text-align:right;direction:rtl}
.pay-table input.w-dept{width:82px;text-align:right;direction:rtl}
.pay-table input.w-xs{width:48px}
.pay-table input[type=checkbox]{width:16px;height:16px;accent-color:var(--pay-crimson);cursor:pointer}
.pay-table tr.pay-grand td{background:var(--ink);color:#fff;font-weight:800;font-size:12.5px}
.pay-x,.pay-rm{border:none;background:none;cursor:pointer;padding:2px 6px;font-size:13px}
.pay-rm{color:var(--pay-crimson)}
.pay-x:hover,.pay-rm:hover{opacity:.6}
.pay-actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pay-actions select{font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px 10px}
.pay-actions .submit,.pay-actions .ghost{width:auto;padding:8px 16px;margin:0}
.pay-comp{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
.pay-comp th{text-align:center;color:var(--muted);font-weight:600;font-size:11px;padding:6px;border-bottom:1px solid var(--line);white-space:nowrap}
.pay-comp td{padding:6px;border-bottom:1px solid #F1ECDE;text-align:center;direction:ltr}
.pay-comp td.nm{direction:rtl;text-align:right;white-space:nowrap}
.pay-comp td.ref{color:var(--muted);font-size:11.5px}
.pay-comp input{font-family:inherit;font-size:12.5px;direction:ltr;text-align:left;border:1px solid var(--line);
  border-radius:7px;background:#FCFAF4;padding:5px 7px;width:120px}
.pay-comp input[type=checkbox]{width:16px;height:16px;accent-color:var(--pay-crimson);cursor:pointer}
.pay-bracket{display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:12.5px}
.pay-bracket span{color:var(--muted);white-space:nowrap}
.pay-bracket input{width:130px;font-family:inherit;font-size:12.5px;direction:ltr;border:1px solid var(--line);
  border-radius:7px;background:#FCFAF4;padding:5px 7px}

/* ---- برگه‌های چاپی (فیش حقوقی و لیست حقوق) ---- */
.doc-overlay{position:fixed;inset:0;z-index:40;background:#0006;overflow:auto;padding:16px}
.doc-toolbar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}
.doc-toolbar .ghost{background:#fff;width:auto;margin:0;padding:8px 16px}
.print-area{display:flex;justify-content:center;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.doc-sheet{background:#fff;width:100%;max-width:760px;border-radius:14px;padding:30px 34px;
  box-shadow:0 10px 40px #0003;color:#16211E}
.doc-sheet.wide{max-width:1040px}
.doc-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:18px}
.doc-brand{display:flex;align-items:center;gap:11px}
.doc-co{font-size:21px;font-weight:800;letter-spacing:-.3px;line-height:1.2}
.doc-co-sub{font-size:11.5px;color:var(--muted)}
.doc-title-box{text-align:left}
.doc-title{font-size:17px;font-weight:800;color:var(--accent)}
.doc-sub{font-size:12.5px;color:var(--muted);margin-top:2px}
.doc-info{display:grid;grid-template-columns:repeat(3,1fr);gap:9px 14px;background:var(--accent2);
  border-radius:10px;padding:13px 15px;margin-bottom:18px}
.doc-info div{display:flex;flex-direction:column;gap:1px}
.doc-info span{font-size:10.5px;color:var(--muted)}
.doc-info b{font-size:13px}
.doc-cols{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;align-items:start}
.doc-col{border:1px solid var(--line);border-radius:11px;overflow:hidden}
.doc-col h3{margin:0;font-size:12.5px;padding:9px 13px;color:#fff}
.doc-col.earn h3{background:#1E7D46}
.doc-col.deduct h3{background:#B5560B}
.doc-group{font-size:10.5px;color:var(--muted);background:#F7F9F8;padding:5px 13px;
  border-bottom:1px solid var(--line);border-top:1px solid var(--line)}
.doc-line{display:flex;justify-content:space-between;gap:10px;align-items:baseline;
  padding:7px 13px;border-bottom:1px solid #F1F4F2;font-size:12.5px}
.doc-line span{color:#3C4A45}
.doc-line b{direction:ltr;font-variant-numeric:tabular-nums;white-space:nowrap}
.doc-line.sub{background:#FAFBFA;font-weight:600}
.doc-line.total{background:#F2F5F3;font-weight:800;border-bottom:none}
.doc-net{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;
  background:var(--accent);color:#fff;border-radius:12px;padding:15px 20px}
.doc-net span{font-size:13.5px;font-weight:600}
.doc-net b{font-size:23px;direction:ltr;font-variant-numeric:tabular-nums}
.doc-net small{font-size:12px;font-weight:500;opacity:.85}
.doc-sign{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:30px;
  padding-top:16px;border-top:1px dashed var(--line);font-size:12px;color:#3C4A45}
.doc-foot{margin-top:16px;text-align:center;font-size:10.5px;color:var(--muted)}
/* برگه‌های سود مرکز پوشش (features/coatingProfitDocs.jsx) */
.doc-sec{font-size:13px;font-weight:800;color:var(--accent);margin:18px 0 8px}
.doc-none{font-size:12px;color:var(--muted);border:1px dashed var(--line);border-radius:9px;padding:9px 12px}
.doc-net.loss{background:#B02A2A}
.doc-net span small{display:block;margin-top:3px}
.cp-cols{grid-template-columns:1fr 1fr;margin-top:14px}
.doc-info.cp-four{grid-template-columns:repeat(8,1fr);gap:6px 10px}
.doc-info.cp-four b{font-size:12px}
@media screen and (max-width:900px){.doc-info.cp-four{grid-template-columns:repeat(2,1fr)}}
.doc-info.cp-four.dt-five{grid-template-columns:repeat(5,1fr);margin-bottom:8px}
@media screen and (max-width:900px){.doc-info.cp-four.dt-five{grid-template-columns:repeat(2,1fr)}}
.cp-neg{color:#B02A2A}
.doc-table tr.tot td.cp-neg,.doc-table td.net.cp-neg{color:#B02A2A}
.cp-code{color:var(--muted);font-size:9.5px;direction:ltr;text-align:right}
.cp-sheet .doc-table td.nm{white-space:normal}
.cp-sheet .doc-info{padding-top:10px;padding-bottom:10px}
.cp-sheet .doc-info{margin-bottom:12px}
.cp-sheet .doc-sign{margin-top:18px;padding-top:12px}
.cp-sheet .doc-foot{margin-top:10px;line-height:1.8}
.cp-sheet.wide .doc-head{padding-bottom:9px;margin-bottom:12px}
.cp-sheet .doc-amend{margin:0 0 12px}
.doc-table td.cp-miss{color:#B02A2A;font-size:10.5px}
.doc-table.cp-wide{font-size:9.5px}
.doc-table.cp-wide th{font-size:9px;padding:6px 3px;white-space:normal}
.doc-table.cp-wide td{padding:5px 3px;white-space:nowrap}
.doc-table.cp-wide td.nm{white-space:normal}
.doc-table.ls-matrix{font-size:9.5px}.doc-table.ls-matrix th{font-size:9px;padding:6px 3px;white-space:normal}.doc-table.ls-matrix td{padding:5px 3px}
/* فاکتور فروش (features/salesInvoice.jsx) */
.wh-dialog.inv-dialog{max-width:1180px}
.seg.linked{border-color:#3D6FB6;color:#2B5BA0;background:#EAF1FB;font-weight:700}
.seg.linked:hover{background:#DCE8F8}
.inv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 10px;align-items:end}
@media(max-width:800px){.inv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.inv-num{width:100%;font:inherit;font-size:13px;padding:6px 7px;border:1px solid var(--line);border-radius:8px;background:#FBFCFB;text-align:center;direction:ltr}
.tbl-scroll .print-table.inv-lines td{vertical-align:top;padding:5px 4px;height:auto;white-space:normal}
.inv-lines textarea,.inv-lines .inv-spec{display:block;box-sizing:border-box}
.inv-lines textarea{width:100%;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#FBFCFB;resize:vertical;min-height:32px;field-sizing:content}
.inv-spec{width:100%;font:inherit;font-size:11.5px;padding:4px 8px;border:1px dashed var(--line);border-radius:7px;background:#fff;color:var(--muted);margin-top:3px}
.inv-mode{width:auto;font:inherit;font-size:12.5px;padding:6px 4px;border:1px solid var(--line);border-radius:8px;background:#fff}
.inv-add{display:flex;gap:8px;flex-wrap:wrap}.inv-add .add-row{flex:1 1 160px}
.inv-x{width:24px;height:24px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff;font:inherit;font-size:11px;line-height:1;cursor:pointer;color:var(--ink);margin-inline-start:2px}
.inv-x:disabled{opacity:.3;cursor:default}.inv-x.del{color:#B02A2A;font-size:15px}
.inv-bottom{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:18px;margin-top:10px;align-items:start}
@media(max-width:900px){.inv-bottom{grid-template-columns:1fr}}
.inv-adj{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px}
.inv-adj>input:first-child{flex:1 1 150px;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#FBFCFB;min-width:0}
.inv-adj select{width:auto;font:inherit;font-size:12.5px;padding:5px 6px;border:1px solid var(--line);border-radius:8px;background:#fff}
.inv-adj .inv-num{width:auto}
.inv-note{display:flex;gap:6px;align-items:center;margin-bottom:5px}
.inv-note input{flex:1;font:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#FBFCFB;min-width:0}
.inv-common{margin-top:6px;font-size:12px}.inv-common summary{cursor:pointer;color:var(--accent);margin-bottom:6px}
.inv-pick{display:block;width:100%;text-align:right;border:0;border-bottom:1px solid #F1F5F4;background:none;font:inherit;font-size:12px;padding:5px 2px;cursor:pointer;color:var(--ink);line-height:1.8}
.inv-pick:hover{background:var(--accent2)}
.inv-totals,.inv-sum{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.inv-totals>div,.inv-sum>div{display:flex;justify-content:space-between;gap:12px;padding:8px 13px;border-bottom:1px solid #F1F4F2;font-size:13px;align-items:baseline}
.inv-totals b,.inv-sum b{direction:ltr;font-variant-numeric:tabular-nums;white-space:nowrap}
.inv-totals .main,.inv-sum .main{background:var(--accent);color:#fff;font-weight:800;border-bottom:0}
.inv-totals .main b,.inv-sum .main b{font-size:17px}
.inv-totals{position:sticky;top:8px}
/* برگهٔ چاپیِ فاکتور */
.inv-sheet{position:relative;font-size:12px}
.inv-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;border-bottom:2px solid var(--accent);padding-bottom:10px;margin-bottom:12px}
.inv-seller-name{font-size:18px;font-weight:800}
.inv-title{font-size:16px;font-weight:800;color:var(--accent);text-align:center}
.inv-meta{display:flex;flex-direction:column;gap:3px;align-items:flex-end;font-size:12px}
.inv-party{border:1px solid var(--line);border-radius:9px;margin-bottom:8px;overflow:hidden}
.inv-party h4{margin:0;font-size:11.5px;padding:5px 11px;background:var(--accent2);color:var(--accent)}
.inv-party>div{display:flex;flex-wrap:wrap;gap:4px 22px;padding:6px 11px;font-size:11.5px}
.inv-party i{font-style:normal;color:var(--muted)}
.inv-table{margin-top:10px}
.inv-sheet .doc-table td.nm{white-space:normal}
.inv-sheet .doc-table th{white-space:normal}
.inv-spec-p{color:#5B6A66;font-size:10.5px;margin-top:2px}
.inv-foot{display:flex;gap:16px;align-items:flex-start;margin-top:12px}
.inv-sum{min-width:290px;font-size:12px}.inv-sum>div{padding:6px 11px;font-size:12px}.inv-sum .main b{font-size:15px}
.inv-notes{font-size:11.5px;line-height:1.95}.inv-notes b{display:block;margin-bottom:2px}
.inv-sign{grid-template-columns:1fr 1fr;text-align:center;margin-top:12px;padding-top:0;padding-bottom:38px;border-top:0}
.inv-stamp{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:84px;font-weight:900;color:#B02A2A;opacity:.09;pointer-events:none;white-space:nowrap}
.cp-stack{display:flex;flex-direction:column;gap:18px;width:100%;max-width:760px}
/* ردِ ویرایش حوالهٔ ثبت‌شده: «با مجوز … تغییر کرد» */
.doc-amend{margin-top:12px;border:1px solid #F3D9AD;background:#FFF9EE;border-radius:10px;padding:8px 12px;
  font-size:12.5px;line-height:1.9;text-align:right}
.doc-amend ul{margin:2px 18px 6px 0;padding:0}
.vc-amended{font-size:11.5px;color:#8A4B08;margin-top:3px;white-space:normal;max-width:240px}
.doc-table{width:100%;border-collapse:collapse;font-size:11.5px}
.doc-table th{background:var(--accent2);color:var(--accent);font-weight:700;font-size:10.5px;
  padding:8px 6px;border:1px solid var(--line);white-space:nowrap}
.doc-table td{padding:6px;border:1px solid var(--line);text-align:center;direction:ltr;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.doc-table td.nm{direction:rtl;text-align:right}
.doc-table td.net{font-weight:700;background:#F2F5F3}
.doc-table tr.tot td{background:var(--accent);color:#fff;font-weight:800}
.doc-table tr.tot td.net{background:#0B4F48;color:#fff}
@media screen and (max-width:640px){
  .doc-sheet{padding:20px 16px}
  .doc-cols{grid-template-columns:1fr}
  .doc-info{grid-template-columns:repeat(2,1fr)}
  .doc-sign{grid-template-columns:1fr}
}
/* هنگام باز بودن برگه، کلاس printing-doc روی body می‌نشیند تا چاپ فقط همان برگه را
   بگیرد. بدون این کلاس، چاپِ بقیهٔ صفحه‌ها (قرارداد، گزارش مالی) دست‌نخورده می‌ماند. */
@media print{
  body.printing-doc *{visibility:hidden!important}
  /* بقیهٔ برنامه پشتِ برگه جا نگیرد (روی گوشی صفحه بلند است و چند صفحهٔ خالیِ خاکستری ته PDF می‌آمد) و زمینه سفید باشد */
  html.printing-doc-root,body.printing-doc{background:#fff!important}
  body.printing-doc #root{height:0!important;overflow:hidden!important}
  body.printing-doc .doc-overlay{position:static!important;background:#fff!important;
    padding:0!important;overflow:visible!important}
  body.printing-doc .print-area,body.printing-doc .print-area *{visibility:visible!important}
  body.printing-doc .print-area{position:absolute!important;top:0;right:0;left:0;width:100%}
  body.printing-doc .doc-sheet{max-width:100%!important;box-shadow:none!important;
    border-radius:0!important;padding:0!important}
  body.printing-doc .doc-col,body.printing-doc .doc-net,body.printing-doc .doc-info,
  body.printing-doc .doc-table th,body.printing-doc .doc-table tr.tot td,
  body.printing-doc .doc-table td.net,body.printing-doc .doc-line.total,
  body.printing-doc .doc-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.printing-doc .doc-col{break-inside:avoid}
  body.printing-doc .doc-table tr{break-inside:avoid}
  body.printing-doc .doc-table tr.tot{break-before:avoid}
  /* چند برگه پشت سر هم (همهٔ پروژه‌ها): هر برگه از سرِ یک صفحهٔ تازه */
  body.printing-doc .print-area{display:block!important}
  body.printing-doc .plan-grid.wk th,body.printing-doc .plan-grid.wk td,body.printing-doc .plan-grid.wk .plan-line{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.printing-doc .plan-grid.wk tr{break-inside:avoid}
  body.printing-doc .wk-sheet .doc-foot{break-before:avoid}
  body.printing-doc .cp-stack{display:block!important;max-width:100%!important}
  body.printing-doc .cp-page{break-after:page}
  body.printing-doc .cp-page:last-child{break-after:auto}
  body.printing-doc .doc-sec{break-after:avoid}
  body.printing-doc .inv-party h4,body.printing-doc .inv-sum .main{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.printing-doc .inv-foot,body.printing-doc .inv-sign,body.printing-doc .inv-party{break-inside:avoid}
  body.printing-doc .cp-sheet .doc-foot{break-before:avoid}
  body.printing-doc .doc-sign,body.printing-doc .doc-net,body.printing-doc .doc-amend{break-inside:avoid}
  body.printing-doc .doc-net.loss{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:14mm}
}
/* چاپ روی صفحهٔ باریک (گوشی، کاغذ کوچک‌تر): برگه به نسبتِ پهنای صفحه کوچک می‌شود تا همان چیدمانِ کاغذ A4 بماند.
   برگه‌های افقیِ خودمان (گزارش‌های مالی، برنامهٔ هفتگی، فاکتور رسمی) از ۱۰۰۰ پیکسل به پایین؛ بقیهٔ برگه‌های پهن (لیست حقوق،
   برگهٔ راننده) که روی کاغذِ عمودیِ رومیزی هم چاپ می‌شوند فقط در پهنای گوشی، تا چاپِ فعلی‌شان عوض نشود. */
@media print and (max-width:1000px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.849}}
@media print and (max-width:960px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.814}}
@media print and (max-width:920px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.778}}
@media print and (max-width:880px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.743}}
@media print and (max-width:840px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.708}}
@media print and (max-width:800px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.672}}
@media print and (max-width:760px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.637}}
@media print and (max-width:720px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.602}}
@media print and (max-width:680px){body.printing-doc .doc-sheet.wide:is(.cp-sheet,.wk-sheet,.inv-sheet){zoom:0.566}}
@media print and (max-width:640px){body.printing-doc .doc-sheet.wide{zoom:0.531}}
@media print and (max-width:600px){body.printing-doc .doc-sheet.wide{zoom:0.495}}
@media print and (max-width:560px){body.printing-doc .doc-sheet.wide{zoom:0.46}}
@media print and (max-width:520px){body.printing-doc .doc-sheet.wide{zoom:0.425}}
@media print and (max-width:480px){body.printing-doc .doc-sheet.wide{zoom:0.389}}
@media print and (max-width:440px){body.printing-doc .doc-sheet.wide{zoom:0.354}}
@media print and (max-width:400px){body.printing-doc .doc-sheet.wide{zoom:0.318}}
@media print and (max-width:360px){body.printing-doc .doc-sheet.wide{zoom:0.283}}
@media print and (max-width:320px){body.printing-doc .doc-sheet.wide{zoom:0.248}}
@media print and (max-width:680px){body.printing-doc .doc-sheet:not(.wide){zoom:0.867}}
@media print and (max-width:660px){body.printing-doc .doc-sheet:not(.wide){zoom:0.841}}
@media print and (max-width:640px){body.printing-doc .doc-sheet:not(.wide){zoom:0.815}}
@media print and (max-width:620px){body.printing-doc .doc-sheet:not(.wide){zoom:0.789}}
@media print and (max-width:600px){body.printing-doc .doc-sheet:not(.wide){zoom:0.762}}
@media print and (max-width:580px){body.printing-doc .doc-sheet:not(.wide){zoom:0.736}}
@media print and (max-width:560px){body.printing-doc .doc-sheet:not(.wide){zoom:0.71}}
@media print and (max-width:540px){body.printing-doc .doc-sheet:not(.wide){zoom:0.683}}
@media print and (max-width:520px){body.printing-doc .doc-sheet:not(.wide){zoom:0.657}}
@media print and (max-width:500px){body.printing-doc .doc-sheet:not(.wide){zoom:0.631}}
@media print and (max-width:480px){body.printing-doc .doc-sheet:not(.wide){zoom:0.605}}
@media print and (max-width:460px){body.printing-doc .doc-sheet:not(.wide){zoom:0.578}}
@media print and (max-width:440px){body.printing-doc .doc-sheet:not(.wide){zoom:0.552}}
@media print and (max-width:420px){body.printing-doc .doc-sheet:not(.wide){zoom:0.526}}
@media print and (max-width:400px){body.printing-doc .doc-sheet:not(.wide){zoom:0.499}}
@media print and (max-width:380px){body.printing-doc .doc-sheet:not(.wide){zoom:0.473}}
@media print and (max-width:360px){body.printing-doc .doc-sheet:not(.wide){zoom:0.447}}
@media print and (max-width:340px){body.printing-doc .doc-sheet:not(.wide){zoom:0.421}}
@media print and (max-width:320px){body.printing-doc .doc-sheet:not(.wide){zoom:0.394}}
@media print and (max-width:300px){body.printing-doc .doc-sheet:not(.wide){zoom:0.368}}
.approved-sep{font-size:13px;font-weight:700;color:var(--muted);margin:22px 0 10px;padding-top:16px;border-top:1px solid var(--line)}
.card.report.revision{background:#FBE2DD;border:1.5px solid #C1421F}
.card.report.corrected{background:#E4F5E9;border:1.5px solid #1E7D46}
.corrected-badge{display:inline-block;font-size:12px;font-weight:700;color:#1E7D46;background:#fff;border:1px solid #1E7D46;border-radius:14px;padding:3px 12px;margin-bottom:10px}
.items-table{display:flex;flex-direction:column;gap:6px}
.it-line{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px;padding:8px 10px;background:#F8FAF9;border-radius:9px;align-items:baseline}
.it-emp{font-weight:700}
.it-proj{color:var(--accent);font-weight:600}
.it-act{color:var(--muted)}
.it-h{color:var(--ink);font-size:12px;margin-inline-start:auto}
.it-desc{flex-basis:100%;color:var(--muted);font-size:12px}
.it-tag{font-size:11px;padding:1px 8px;border-radius:999px;background:#EEF1F5;color:#445;white-space:nowrap}
.it-tag.rework{background:#FDECEC;color:#8E1B1B}
.it-tag.overtime{background:#FFF4E5;color:#B5560B}
.it-tag.waste{background:#FDECEC;color:#8E1B1B}
.it-tag.return{background:#E7F5EC;color:#1E7D46}
.work-extras{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin:2px 0 10px;font-size:13px}
.work-extras label{display:flex;align-items:center;gap:6px;cursor:pointer}
.work-extras select{padding:5px 8px;border-radius:8px;border:1px solid var(--line);font:inherit;font-size:13px;background:#fff}
.rep-total{font-size:12px;color:var(--muted);margin-top:8px}
.rep-notes{margin:9px 0 0;font-size:13px;color:var(--muted);background:#F7F9F8;padding:8px 10px;border-radius:8px}
.comments{margin-top:11px;display:flex;flex-direction:column;gap:6px}
.cmt{background:var(--accent2);padding:8px 11px;border-radius:9px;font-size:13.5px}
.cmt-author{display:block;font-size:11px;color:var(--accent);font-weight:700;margin-bottom:1px}
.cmt-add{display:flex;gap:7px;margin-top:11px}
.cmt-add input{flex:1;font-family:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:#FBFCFB;outline:none}
.cmt-add input:focus{border-color:var(--accent)}
.cmt-add button{font-family:inherit;font-size:13px;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:9px;padding:0 14px;cursor:pointer}
.cmt-add button:disabled{opacity:.4}
.rep-actions{display:flex;gap:8px;align-items:center;margin-top:11px;border-top:1px solid var(--line);padding-top:11px;flex-wrap:wrap}
.act{font-family:inherit;font-size:13px;font-weight:600;border:none;border-radius:9px;padding:8px 16px;cursor:pointer;color:#fff}
.act.ok{background:#1E7D46}.act.warn{background:#B5560B}
.hint{font-size:12px;color:var(--muted);flex:1}
.del{background:none;border:none;color:#B23A3A;font-family:inherit;font-size:12px;cursor:pointer;opacity:.7;margin-inline-start:auto}
.del:hover{opacity:1}

/* stats + dashboard */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px;text-align:right;
  position:relative;overflow:hidden;box-shadow:var(--shadow)}
.stat::after{content:"";position:absolute;width:96px;height:96px;border-radius:50%;left:-38px;bottom:-58px;background:rgba(20,125,112,.05)}
.stat b{display:block;font-size:22px;font-weight:700;color:#183B43;line-height:1.5}.stat span{font-size:11.5px;color:var(--muted)}
.stat.warn b{color:#B5560B}
/* روی گوشی چهار ستون جا نمی‌شود و عدد بریده می‌شد */
.stats.six{grid-template-columns:repeat(6,minmax(0,1fr))}
@media(max-width:900px){.stats.six{grid-template-columns:repeat(3,minmax(0,1fr))}}
/* کارت آماری که فیلتر هم هست (مثلاً «موجودی منفی») */
.stat-btn{font-family:inherit;cursor:pointer;width:100%;transition:border-color .15s,box-shadow .15s}
.stat-btn:hover{border-color:var(--accent)}
.stat-btn[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px rgba(20,125,112,.2)}
@media(max-width:640px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat{padding:12px 13px}.stat b{font-size:19px}}
@media(max-width:640px){.stats.six{grid-template-columns:repeat(2,minmax(0,1fr))}}
.short-dialog{max-width:760px}
.short-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;line-height:1.9}
.short-icon{flex:none;width:34px;height:34px;border-radius:50%;background:#FDE8E8;color:#B42318;
  font-weight:800;font-size:18px;display:grid;place-items:center}
.short-title{font-weight:800;font-size:15px}
.short-hint{margin-bottom:10px;line-height:1.9}
.short-table td{vertical-align:top;line-height:1.8}
.short-icon.post{background:#E6F4EA;color:#1E7B34}
.post-facts{display:flex;flex-wrap:wrap;gap:8px 20px;margin:2px 0 12px;font-size:13px}
.post-facts span{color:var(--muted);margin-left:6px}
.post-wh b{background:#FFF4E5;color:#8A4B00;padding:2px 8px;border-radius:6px}
.post-lines{max-height:320px;overflow-y:auto}
.confirm-dialog{max-width:460px}
.confirm-msg{white-space:pre-line}
.short-icon.info{background:#E8F0FE;color:#1A4FA0}
.confirm-danger{background:#B42318;color:#fff;border:0;border-radius:10px;padding:10px 20px;
  font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}
.confirm-danger:hover{background:#912018}
.confirm-danger:focus-visible{outline:2px solid #B42318;outline-offset:2px}
.bar-row{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.bar-lbl{flex:0 0 34%;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{flex:1;height:9px;background:#EEF1F0;border-radius:6px;overflow:hidden}
.bar>div{height:100%;background:var(--accent);border-radius:6px}
.bar.emp>div{background:#4A7BA6}
.bar-v{flex:0 0 auto;font-size:12px;color:var(--muted);min-width:26px;text-align:left}
.day-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--line)}
.day-row:last-child{border-bottom:none}
.day-name{flex:1;font-size:13px;font-weight:600}
.day-h{font-size:12px;color:var(--muted)}
.day-idle{font-size:12px;font-weight:600;color:var(--accent);background:var(--accent2);padding:3px 9px;border-radius:12px}
.day-idle.over{color:#B5560B;background:#FFF4E5}

/* projects & users */
.proj{display:flex;justify-content:space-between;align-items:center;padding:13px 16px}
/* ---- اموال ---- */
.seg-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.seg{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 16px;font-family:inherit;
  font-size:13px;color:var(--muted);cursor:pointer}
.seg.on{background:var(--accent2);border-color:var(--accent);color:var(--accent);font-weight:600}
.seg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.as-chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;white-space:nowrap;vertical-align:middle}
.as-chip.ok{background:#E4F5E9;color:#1E7D46}
.as-chip.warn{background:#FFF4E5;color:#8A4B00}
.as-chip.info{background:#E8F0FE;color:#1A4FA0}
.as-chip.off{background:#EEF0EF;color:#5C6B66}
.as-chip.bad{background:#FDE8E8;color:#B42318}
.asset-flags{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted);margin:-4px 2px 12px}
.asset-flags b{color:var(--ink)}
.asset-open{font-weight:700;font-size:inherit;text-align:right;padding:0;color:var(--ink)}
.asset-open:hover{color:var(--accent)}
.asset-dialog{max-width:760px}
.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 16px;margin:4px 0 12px}
.asset-grid span{display:block;font-size:11.5px;color:var(--muted)}
.asset-grid b{font-weight:600;font-size:13.5px}
.asset-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px}
.asset-card{border:1px solid var(--line);border-radius:11px;padding:10px 12px;background:#FBFCFB}
.asset-card .items-hd{margin-top:0}
.asset-card dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 6px;font-size:13px}
.asset-card dt{color:var(--muted)}
.asset-card dd{margin:0;font-weight:600}
.event-form{margin-bottom:12px;background:#fff}
.dep-bar{height:6px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px}
.dep-bar i{display:block;height:100%;background:var(--accent)}
.event-list{list-style:none;margin:6px 0 0;padding:0}
.event-list li{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #EDF2F0;align-items:flex-start}
.event-list li:last-child{border-bottom:0}
/* کارتابل تعمیر و نگهداری */
.sb-badge{margin-inline-start:auto;min-width:22px;height:20px;padding:0 6px;border-radius:10px;background:#E8A33D;color:#1F2A2C;
  font-size:11px;font-weight:700;display:grid;place-items:center}
.sb-badge.hot{background:#E5484D;color:#fff}
.mt-banner{display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap;background:#FFF4E5;border:1px solid #F3D9AD;
  border-radius:12px;padding:10px 14px;margin-bottom:12px}
.mt-banner>div{flex:1;min-width:170px}
.mt-banner b{display:block;color:#8A4B00;font-size:13.5px}
.mt-banner small{color:#8A4B00;font-size:12px}
.mt-banner .submit{width:auto;margin:0;padding:8px 14px;flex:0 0 auto}
.mt-banner .ghost{flex:0 0 auto}
.mt-banner button{white-space:nowrap}
.mt-banner-ic{width:34px;height:34px;border-radius:10px;background:#fff;color:#B5560B;display:grid;place-items:center;flex:none}
.mt-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.mt-card{background:var(--card);border:1px solid var(--line);border-inline-start:4px solid #C9D3D0;border-radius:12px;padding:12px 14px}
.mt-card.high{border-inline-start-color:#D92D20}
.mt-card.medium{border-inline-start-color:#E8A33D}
.mt-card.low{border-inline-start-color:#5B8DEF}
.mt-hd{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap}
.mt-title{flex:1;min-width:150px}
.mt-title b{display:block;font-size:14.5px;line-height:1.5}
.mt-title small{color:var(--muted);font-size:12px}
.mt-text{margin:8px 0 4px;font-size:13px;line-height:1.9}
.mt-closed{margin:4px 0;font-size:12.5px;line-height:1.8;color:#1E7D46}
.mt-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.mt-actions .submit{width:auto;margin:0;padding:8px 16px;flex:0 0 auto}
.mt-actions .ghost{flex:0 0 auto}
.mt-meta{font-size:11.5px;color:var(--muted);margin-inline-start:auto}
.mt-card .event-form{margin-top:10px}
/* انبارگردانی، کاردکس و کالای دست اشخاص */
.wh-range{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:8px}
.diff-neg{color:#B42318}
.diff-pos{color:#1E7D46}
.cnt-dialog{max-width:1100px}
.cnt-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.cnt-tools .wh-search{flex:1;min-width:190px;margin:0}
.cnt-scroll{max-height:56vh;overflow:auto}
.cnt-scroll thead th{position:sticky;top:0;z-index:1}
.cnt-table td{vertical-align:middle}
.cnt-in{width:96px;font-family:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;text-align:center}
.cnt-in:focus{outline:2px solid var(--accent);outline-offset:1px}
.cnt-in.bad{border-color:#D92D20;background:#FFF5F4}
.cnt-note{width:100%;min-width:110px;font-family:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.main .cnt-table tr.cnt-short td{background:#FFF6F5}
.main .cnt-table tr.cnt-over td{background:#F2FAF4}
.cnt-foot{flex-wrap:wrap}
.cnt-foot .submit{width:auto;margin:0;flex:0 0 auto}
.cnt-blank{min-width:90px}
.kx-edge td{background:#F3F7F6;font-weight:600}
.vt-seed{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.vt-seed input{flex:1;min-width:170px;font-family:inherit;font-size:13.5px;padding:8px 10px;border:1px solid var(--line);border-radius:9px}
.vt-seed .ghost{flex:0 0 auto;padding:8px 14px}
.holder-list{display:flex;flex-direction:column;gap:10px}
.holder-card{margin-bottom:0}
.holder-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.holder-hd .ghost{flex:0 0 auto;padding:7px 14px}
@media (max-width:560px){.cnt-foot>button{flex:1 1 40%}.cnt-foot>.submit{flex-basis:100%;order:-1}}
.event-list .as-chip{margin-top:3px}
.event-body{flex:1;min-width:0;font-size:13px;line-height:1.8}
.event-body small{display:block;color:var(--muted);font-size:11.5px}
.doc-terms{font-size:13px;line-height:2.1;margin:14px 0;text-align:justify}
.insp-table td{vertical-align:middle}
@media (max-width:560px){.insp-foot{flex-wrap:wrap}.insp-foot>button{flex:1 1 40%}.insp-foot>.submit{flex-basis:100%;order:-1}}
.insp-table select,.insp-table input[type=text]{font-family:inherit;font-size:12.5px;border:1px solid var(--line);
  border-radius:8px;padding:5px 7px;background:#fff;max-width:180px}
.insp-table input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent)}
.main .insp-table tr.missing td{background:#FFF6F5}
.main .insp-table tr.action td{background:#FFFBF2}

/* ---- کاربران ---- */
.users-toolbar{display:flex;flex-direction:column;gap:10px}
.users-filters{display:flex;gap:8px;flex-wrap:wrap}
.users-filters select,.access-tools select{flex:1;min-width:150px;font-family:inherit;font-size:13.5px;color:var(--ink);
  border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:#FBFCFB}
.users-filters .users-new{flex:0 0 auto;padding:9px 18px}
.users-table td{vertical-align:middle}
.users-table tr.is-off td,.users-table tr.is-off .user-cell b{color:var(--muted)}
.user-cell{display:flex;align-items:center;gap:10px;min-width:170px}
.user-cell b{display:block;font-weight:600;line-height:1.4}
.user-cell small{display:block;color:var(--muted);font-size:11.5px;text-align:right}
.u-status{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;white-space:nowrap;margin-inline-end:4px}
.u-status.on{background:#E4F5E9;color:#1E7D46}
.u-status.off{background:#EEF0EF;color:#5C6B66}
.u-status.pw{background:#FFF4E5;color:#8A4B00}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.user-dialog{max-width:720px}
.user-dialog .sub-tab{min-width:0;padding:8px 6px}
.user-dialog-hd{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.ud-name{flex:1;min-width:0}
.ud-name b{display:block;font-size:16px;font-weight:700;line-height:1.4}
.ud-name small{display:block;color:var(--muted);font-size:12px}
.user-danger{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #F1D5D1;background:#FFF8F7;
  border-radius:11px;padding:12px 14px;margin-top:14px}
.user-danger b{display:block;font-size:13.5px}.user-danger small{display:block;color:var(--muted);font-size:12px}
.access-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.access-tools .ghost{flex:0 0 auto;padding:8px 14px}
.access-group{border:1px solid var(--line);border-radius:11px;padding:2px 12px 10px;margin:10px 0 0;min-width:0}
.access-group-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;float:none;padding:8px 0 0;
  font-size:12.5px;font-weight:700;color:var(--muted)}
.access-group-actions{display:flex;gap:12px}
.access-group .access-grid{border-top:0;margin-top:4px;padding-top:0}
.access-tabs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-top:6px}
.access-tab{border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:#FBFCFB}
.access-tab.on{background:#fff;border-color:#CFE3DF}
.access-tab .access-item{font-weight:600}
.access-tab.sub .access-item{font-weight:500}
.access-count{margin-inline-start:auto;font-size:11px;font-weight:500;color:var(--muted);white-space:nowrap}
.access-actions{margin:2px 0 2px;padding-inline-start:22px;border-inline-start:2px solid var(--line)}
.access-tab.on .access-actions{border-color:var(--accent2)}
.access-item.action{font-weight:400;font-size:12px;color:var(--muted);padding:1px 0}
.access-tab.on .access-item.action{color:var(--ink)}
.access-item svg{color:var(--muted);flex:none}
.audit-list{list-style:none;margin:0;padding:0}
.audit-list li{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #EDF2F0}
.audit-list li:last-child{border-bottom:0}
.audit-kind{flex:none;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--accent2);color:var(--accent);white-space:nowrap;margin-top:2px}
.audit-kind.k-deactivated,.audit-kind.k-password_reset{background:#FFF4E5;color:#8A4B00}
.audit-kind.k-created,.audit-kind.k-activated{background:#E4F5E9;color:#1E7D46}
.audit-body{min-width:0;font-size:13px;line-height:1.8}
.audit-body small{display:block;color:var(--muted);font-size:11.5px}
.wh-access{display:flex;align-items:center;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);cursor:pointer}
.wh-access input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.proj-code{margin-inline-start:8px;font-size:11px;color:var(--muted);background:#F1F3F1;padding:2px 7px;border-radius:6px}
.proj-actions{display:flex;gap:8px;align-items:center}
.toggle{font-family:inherit;font-size:12px;border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:8px;padding:4px 12px;cursor:pointer}
.toggle.on{border-color:#1E7D46;color:#1E7D46;background:#1E7D4610}

.notice{padding:10px 12px;border-radius:10px;font-size:12.5px;margin:12px 0}
.notice.warn{background:#FFF4E5;color:#8A4B00;border:1px solid #F3D9AD}
.empty{text-align:center;color:var(--muted);padding:40px 0;font-size:14px}
.export-btn{width:100%;background:#1E7D46;color:#fff;border:none;border-radius:11px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px}
.export-btn:active{opacity:.85}
.ft{text-align:center;font-size:11px;color:var(--muted);padding:16px}

/* گزارش پروژه (پرینت) */
.print-title{margin:0 0 4px;font-size:16px}
/* مراحل پروژه */
.stage-summary{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.stage-toggle{width:100%;margin-top:10px;background:var(--accent2);color:var(--accent);border:1px dashed var(--accent);border-radius:10px;padding:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}
.stage-box{margin-top:10px;border-top:1px solid var(--line);padding-top:10px}
.stage-row{padding:8px 10px;border:1px solid var(--line);border-radius:10px;margin-bottom:7px;background:#FBFCFB}
.stage-row.on{background:var(--accent2);border-color:var(--accent)}
.stage-pick{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;cursor:pointer}
.stage-pick input{width:17px;height:17px;accent-color:var(--accent);cursor:pointer}
.stage-fields{display:flex;gap:8px;align-items:flex-end;margin-top:8px}
.stage-fields .fld{flex:1;margin-bottom:0}
.stage-fields .toggle{white-space:nowrap;padding:9px 12px}
.stage-total{font-size:12.5px;color:var(--muted);margin:10px 0;font-weight:600}
/* position: عنصر absoluteِ درون جدول (مثل برچسب پنهان) باید همین‌جا بریده شود، نه کل صفحه را پهن کند */
.tbl-scroll{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch}
.stage-prog{margin-top:8px;max-height:200px;overflow-y:auto}
.bar-row.sm{font-size:12px;margin-bottom:3px}
.bar-row.sm .bar{height:6px}
.bar.over>div{background:#C2410C}
 .tbl-scroll.tall{max-height:360px;overflow-y:auto;border-radius:12px}
 .tbl-scroll.tall thead th{position:sticky;top:0;z-index:1}
 .scroll-box{max-height:260px;overflow-y:auto;margin:8px 0;padding-inline-end:4px}
 .mini-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 4px;border-bottom:1px solid var(--line)}
 .mini-row:last-child{border-bottom:0}
 .rate-in{width:120px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;text-align:left;direction:ltr}
.tbl-scroll .print-table{min-width:560px}
.tbl-scroll .print-table td,.tbl-scroll .print-table th{white-space:nowrap}
.print-table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}
.print-table th,.print-table td{border:1px solid var(--line);padding:7px 10px;text-align:right}
.print-table th{background:#F3F6F5;font-weight:700}
.print-table .total-row{font-weight:700;background:#F8FAF9}
/* روی صفحه جدول سبک‌تر (بی خط عمودی، ردیف روشن با ماوس)؛ برگه‌های چاپی همان خط‌کشی کامل را دارند. */
@media screen{
  .main .print-table{border:1px solid var(--line);border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;background:var(--card)}
  .main .print-table th,.main .print-table td{border:0;border-bottom:1px solid #EDF2F0}
  .main .print-table th{background:#FBFCFC;color:#5F7370;font-weight:600;font-size:12px}
  .main .print-table tbody tr:last-child td{border-bottom:0}
  .main .print-table tbody tr:hover td{background:#F7FBFA}
  .main .doc-sheet .print-table{border-radius:0;border-collapse:collapse;overflow:visible}
  .main .doc-sheet .print-table th,.main .doc-sheet .print-table td{border:1px solid var(--line)}
  .main .doc-sheet .print-table tbody tr:hover td{background:none}
}

@media print{
  .no-print{display:none!important}
  .app{background:#fff}
  .shell{display:block}
  .wrap{max-width:100%!important}
  .print-table th,.print-table td{border-color:#999}
}
/* ---- داشبورد: نوار بالا، کارت‌های خلاصه، شبکهٔ ویجت‌ها، نمودارها ---- */
.dash-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:4px 0 12px}
.dash-bar h2{margin:0;font-size:18px;color:var(--ink)}.dash-bar h2 span{font-size:12.5px;font-weight:400;color:var(--muted);margin-inline-start:8px}
.dash-export{flex:0 0 auto;padding:8px 14px;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.kpi{position:relative;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px 12px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:2px;overflow:hidden}
.kpi span{font-size:12px;color:var(--muted)}
.kpi b{font-size:26px;line-height:1.3;color:var(--ink);font-variant-numeric:tabular-nums}
.kpi small{font-size:11.5px;color:var(--muted);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.kpi em{font-style:normal;font-weight:700;font-size:11px;padding:0 6px;border-radius:999px}
.kpi em.up{color:#147D70;background:#E0F3EF}.kpi em.down{color:#B4452F;background:#FBE9E4}
.kpi.warn{border-color:#EAD2A6;background:#FFFBF2}.kpi.warn b{color:#A26A12}
.kpi::before{content:"";position:absolute;inset-inline-start:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:var(--accent);opacity:.8}
.kpi.warn::before{background:#C98A2B}
.spk{position:absolute;inset-inline-end:14px;top:16px;width:90px;height:26px}
.spk-a{fill:var(--accent);opacity:.12}.spk-l{fill:none;stroke:var(--accent);stroke-width:1.6}.spk-d{fill:var(--accent)}
@media(max-width:760px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.spk{display:none}}

.wg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
.wg{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);min-width:0;display:flex;flex-direction:column}
.wg-full{grid-column:1/-1}
@media(max-width:900px){.wg-grid{grid-template-columns:minmax(0,1fr)}}
.wg-h{display:flex;align-items:center;gap:10px;padding:12px 14px 10px 10px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.wg-col .wg-h{border-bottom:0}
.wg-t{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.wg-t h3{margin:0;font-size:14px;color:var(--ink)}.wg-t span{font-size:11.5px;color:var(--muted)}
.wg-ctl{display:flex;gap:2px;opacity:.55;transition:opacity .15s}
.wg:hover .wg-ctl,.wg-ctl:focus-within{opacity:1}
@media(hover:none){.wg-ctl{opacity:1}}
.wg-btn{width:26px;height:26px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);font-size:13px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
.wg-btn:hover:not(:disabled){background:var(--paper);border-color:var(--line);color:var(--ink)}
.wg-btn:disabled{opacity:.3;cursor:default}
.wg-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.wg-b{padding:14px;min-width:0}
.wg-b > .card,.wg-b > .pulse > .card{border:0;box-shadow:none;padding:0;margin:0}
.wg-b > .card > .board-h:first-child,.wg-b > .card > .no-print > .board-h:first-child{display:none}
.wg-b .pulse{margin:0}
.wg-dock{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:-4px 0 12px}
.wg-chip{border:1px dashed var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}
.wg-chip:hover{border-style:solid;border-color:var(--accent);color:var(--accent)}

.bl{display:flex;flex-direction:column;gap:7px}
.bl-row{display:grid;grid-template-columns:minmax(90px,34%) 1fr auto 38px;gap:10px;align-items:center;font-size:12.5px}
.bl-lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.bl-track{height:10px;background:var(--paper);border-radius:6px;overflow:hidden}
.bl-fill{height:100%;border-radius:6px;min-width:2px}
.bl-fill.accent{background:linear-gradient(to left,var(--accent),#2FA392)}
.bl-fill.alt{background:linear-gradient(to left,#2F6FA5,#5B94C4)}
.bl-row.other .bl-fill{background:#B9C6C2}.bl-row.other .bl-lbl{color:var(--muted)}
.bl-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink);min-width:44px;text-align:left}
.bl-p{font-size:11px;color:var(--muted);text-align:left;font-variant-numeric:tabular-nums}
.bl-more{align-self:flex-start;margin-top:2px}

.tc-sum{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:6px}.tc-sum b{color:var(--ink);font-variant-numeric:tabular-nums}
.tc-wrap{overflow-x:auto}.tc{width:100%;min-width:420px;height:auto;display:block}
.tc-grid{stroke:var(--line);stroke-width:1}
.tc-ax{fill:var(--muted);font-size:10px;font-family:inherit}
.tc-bar{fill:var(--accent);opacity:.75}.tc-bar:hover{opacity:1}.tc-bar.hot{fill:#C98A2B;opacity:1}

.dn{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.dn-svg{width:150px;height:150px;flex:none}
.dn-bg{fill:none;stroke:var(--paper);stroke-width:13}
.dn-c{font-size:20px;font-weight:700;fill:var(--ink);font-family:inherit}.dn-s{font-size:9px;fill:var(--muted);font-family:inherit}
.dn-leg{list-style:none;margin:0;padding:0;flex:1;min-width:170px;display:flex;flex-direction:column;gap:8px}
.dn-leg li{display:grid;grid-template-columns:10px 1fr auto 38px;gap:8px;align-items:center;font-size:12.5px}
.dn-leg i{width:10px;height:10px;border-radius:3px}.dn-leg b{font-variant-numeric:tabular-nums}.dn-leg em{font-style:normal;color:var(--muted);font-size:11px;text-align:left}

.ut{display:flex;flex-direction:column;gap:7px;margin-top:6px}
.ut-row{display:grid;grid-template-columns:minmax(80px,30%) 1fr auto;gap:10px;align-items:center;font-size:12.5px}
.ut-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ut-bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:transparent}
.ut-bar i{display:block;height:100%}
.ut-bar .w,.ut-leg .w{background:var(--accent)}.ut-bar .f,.ut-leg .f{background:#E3EBE8}.ut-bar .o,.ut-leg .o{background:#C98A2B}
.ut-v{font-size:11.5px;color:var(--ink);font-variant-numeric:tabular-nums;min-width:62px;text-align:left}
.ut-v.over{color:#A26A12;font-weight:700}.ut-v.idle{color:var(--muted)}
.ut-leg{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-top:4px}
.ut-leg span{display:flex;gap:5px;align-items:center}.ut-leg i{width:10px;height:8px;border-radius:2px;display:inline-block}

.staff-list{display:flex;flex-direction:column}
.staff-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.staff-row:last-child{border-bottom:0}
@media print{.wg-grid{display:block}.wg{border:0;box-shadow:none}.wg-h{display:none}}
.dash-acts{display:flex;gap:8px;flex-wrap:wrap}
.wg-b > .kpis{margin:0}
.wg-grid.editing .wg{border-style:dashed;border-color:#9CC8C0;cursor:grab}
.wg-grid.editing .wg-b{opacity:.72;pointer-events:none;max-height:220px;overflow:hidden}
.wg-over{outline:2px solid var(--accent);outline-offset:3px}
.wg-grip{color:var(--muted);font-size:15px;cursor:grab;user-select:none}
.wg-cat{background:var(--card);border:1px solid #9CC8C0;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:var(--shadow)}
.wg-cat-h{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}.wg-cat-h b{font-size:14.5px}
.wg-cat-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.wg-cat fieldset{border:1px solid var(--line);border-radius:11px;padding:8px 10px 10px;margin:0;display:flex;flex-direction:column;gap:4px;min-width:0}
.wg-cat legend{font-size:12px;font-weight:700;color:var(--accent);padding:0 6px}
.wg-cat label{display:flex;gap:8px;align-items:flex-start;padding:5px 6px;border-radius:8px;cursor:pointer}
.wg-cat label:hover{background:var(--paper)}.wg-cat label.on{background:var(--accent2)}
.wg-cat label input{margin-top:3px;accent-color:var(--accent)}
.wg-cat label span{display:flex;flex-direction:column;min-width:0}.wg-cat label b{font-size:12.5px;font-weight:600}
.wg-cat label small{font-size:11px;color:var(--muted)}
.wg-cat-a{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}

.aq{display:flex;flex-direction:column;gap:10px}
.aq-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.aq-c{border:1px solid var(--line);background:var(--paper);border-radius:11px;padding:8px 10px;text-align:right;font:inherit;cursor:pointer;display:flex;flex-direction:column}
.aq-c b{font-size:20px;font-variant-numeric:tabular-nums;color:var(--ink)}.aq-c span{font-size:11.5px;color:var(--muted)}
.aq-c.hot{background:#FFFBF2;border-color:#EAD2A6}.aq-c.hot b{color:#A26A12}
.aq-c.danger{background:#FDF0EE;border-color:#F0C4BC}.aq-c.danger b{color:#B4452F}
.aq-c:hover{border-color:var(--accent)}
.aq-ok{color:#147D70;font-size:12.5px;background:var(--accent2);border-radius:9px;padding:8px 10px}
.aq-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.aq-list li{border-bottom:1px solid var(--line)}.aq-list li:last-child{border-bottom:0}
.aq-list button{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:7px 4px;font-size:12.5px}
.aq-list button:hover{background:var(--paper)}.aq-list button:focus-visible{outline:2px solid var(--accent)}
.aq-k{font-size:11px;font-weight:700;color:var(--accent);background:var(--accent2);border-radius:6px;padding:1px 7px;white-space:nowrap}
.aq-k.danger{color:#B4452F;background:#FDF0EE}
.aq-w{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.aq-d{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.aq-age{font-size:11px;color:var(--muted);min-width:44px;text-align:left}.aq-age.late{color:#B4452F;font-weight:700}

.pp{display:flex;flex-direction:column;gap:6px}
.pp-row{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:minmax(100px,36%) 1fr 38px 64px;gap:10px;align-items:center;font-size:12.5px;padding:4px 2px;border-radius:7px}
.pp-row:hover{background:var(--paper)}.pp-row:focus-visible{outline:2px solid var(--accent)}
.pp-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pp-n small{color:var(--muted);margin-inline-start:6px;font-size:10.5px}
.pp-p{font-weight:700;font-variant-numeric:tabular-nums;text-align:left}
.pp-d{font-size:11px;text-align:center;border-radius:999px;padding:1px 6px;background:var(--paper);color:var(--ink)}
.pp-d.soon{background:#FFF3DC;color:#A26A12}.pp-d.late{background:#FDF0EE;color:#B4452F;font-weight:700}.pp-d.none{color:var(--muted)}

.big-num{display:flex;align-items:baseline;gap:6px;margin-bottom:2px}.big-num b{font-size:26px;color:var(--ink);font-variant-numeric:tabular-nums}.big-num span{color:var(--muted);font-size:12px}
/* ---- مشخصات پروژه ---- */
.seg-pick{display:flex;flex-wrap:wrap;gap:6px}
.seg-pick button{border:1px solid var(--line);background:#FBFCFB;color:var(--ink);border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;cursor:pointer}
.seg-pick button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.seg-pick button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.map-links{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px}
.map-btn{display:inline-block;border:1px solid var(--accent);color:var(--accent);background:var(--accent2);border-radius:999px;padding:3px 11px;font-size:12px;text-decoration:none}
.map-btn:hover{background:var(--accent);color:#fff}.map-btn.ghost{background:transparent;border-color:var(--line);color:var(--muted)}
.pinfo{display:flex;flex-direction:column;gap:6px;margin:10px 0 4px;padding:10px 12px;background:var(--paper);border:1px solid var(--line);border-radius:11px}
.pinfo-chips{display:flex;flex-wrap:wrap;gap:6px}
.pchip{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 10px;background:#E8EEF6;color:#2F5F8F}
.pchip.site-workshop{background:var(--accent2);color:var(--accent)}.pchip.site-mixed{background:#FFF3DC;color:#A26A12}.pchip.site-onsite{background:#F3E8F6;color:#7A3F8F}
.pinfo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 14px}
.pinfo-grid div{display:flex;flex-direction:column;min-width:0}.pinfo-grid span{font-size:11px;color:var(--muted)}
.pinfo-grid b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pinfo-addr{line-height:1.8}.pinfo-desc{white-space:pre-wrap;line-height:1.8;border-top:1px dashed var(--line);padding-top:6px}
`;
