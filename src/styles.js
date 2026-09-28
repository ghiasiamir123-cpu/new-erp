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
.prod-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
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
.jp-pop{position:absolute;top:calc(100% + 6px);right:0;left:0;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px #0002;padding:12px;z-index:20}
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
.jp-input.empty{color:var(--muted)}

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
.print-area{display:flex;justify-content:center}
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
.doc-table{width:100%;border-collapse:collapse;font-size:11.5px}
.doc-table th{background:var(--accent2);color:var(--accent);font-weight:700;font-size:10.5px;
  padding:8px 6px;border:1px solid var(--line);white-space:nowrap}
.doc-table td{padding:6px;border:1px solid var(--line);text-align:center;direction:ltr;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.doc-table td.nm{direction:rtl;text-align:right}
.doc-table td.net{font-weight:700;background:#F2F5F3}
.doc-table tr.tot td{background:var(--accent);color:#fff;font-weight:800}
.doc-table tr.tot td.net{background:#0B4F48;color:#fff}
@media(max-width:640px){
  .doc-sheet{padding:20px 16px}
  .doc-cols{grid-template-columns:1fr}
  .doc-info{grid-template-columns:repeat(2,1fr)}
  .doc-sign{grid-template-columns:1fr}
}
/* هنگام باز بودن برگه، کلاس printing-doc روی body می‌نشیند تا چاپ فقط همان برگه را
   بگیرد. بدون این کلاس، چاپِ بقیهٔ صفحه‌ها (قرارداد، گزارش مالی) دست‌نخورده می‌ماند. */
@media print{
  body.printing-doc *{visibility:hidden!important}
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
  @page{margin:14mm}
}
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
@media(max-width:640px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat{padding:12px 13px}.stat b{font-size:19px}}
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
`;
