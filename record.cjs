const fs = require("node:fs");
const createSignalEngine = require("./site/signal-engine.js");
const data = JSON.parse(fs.readFileSync("site/data.json", "utf8"));
const ledger = JSON.parse(fs.readFileSync("ledger.json", "utf8"));
const recorded = new Date().toISOString();
const today = recorded.slice(0, 10);
const state = {hist:{}, full:{}};
const engine = createSignalEngine(state);
const fee = 0.001;
for (const [id, asset] of Object.entries(data.assets)) {
  if (id === "tnx") continue;
  const stale=data.errors.some(error=>error.startsWith(id+":"));
  if(stale || !asset.source){
    for(const book of Object.values(ledger.books).filter(book=>book.id===id))book.warning="قیمت تازه از منبع دریافت نشد";
    continue;
  }
  const prices = new Map();
  for (let i=0; i<asset.hist.length; i+=2) {
    prices.set(new Date(asset.hist[i]*86400000).toISOString().slice(0,10),asset.hist[i+1]);
  }
  for (const [day,,,close] of asset.daily) prices.set(day,close);
  const bars = [...prices].sort(([a],[b])=>a.localeCompare(b)).map(([d,c])=>({d,c}));
  const mark = bars.at(-1);
  if (!mark || !(mark.c>0)) continue;
  state.hist[id]=true;
  state.full[id]=bars;
  for (const horizon of ["short","medium","long"]) {
    const key=id+"/"+horizon;
    const book=ledger.books[key] ??= {id,horizon,source:asset.source,cash:100,units:0,
      holdUnits:0,fees:0,signals:[],fills:[],lastDay:null};
    if (book.source !== asset.source) { book.warning="تغییر منبع قیمت؛ ثبت متوقف است"; continue; }
    delete book.warning;
    // Only finalized bars may fill a previously observed order.
    for (const bar of bars) {
      if (!book.signals.length || bar.d>=today || bar.d<=(book.lastDay||book.signals[0].time.slice(0,10))) continue;
      const decision=book.signals.findLast(e=>e.time.slice(0,10)<bar.d);
      if (!decision || !(bar.c>0)) continue;
      if (!book.holdUnits) book.holdUnits=100*(1-fee)/bar.c;
      const buy=decision.side==="buy";
      if (buy !== (book.units>0)) {
        const value=buy?book.cash:book.units*bar.c;
        book.fees+=value*fee;
        book.units=buy?value*(1-fee)/bar.c:0;
        book.cash=buy?0:value*(1-fee);
        book.fills.push({date:bar.d,price:bar.c,side:buy?"buy":"sell",fee:value*fee,signal:decision.time});
      }
      book.lastDay=bar.d;
    }
    const g=engine.signal(id,horizon);
    if (!g) continue;
    const side=g.verdict ? (g.state?"buy":"sell") : "neutral";
    const rule=g.rule.join("/");
    const last=book.signals.at(-1);
    if (!last || last.side!==side || last.rule!==rule || last.grade!==g.verdict) {
      book.signals.push({time:recorded,date:mark.d,price:mark.c,side,grade:g.verdict,rule});
    }
    book.mark=mark;
    book.net=book.cash+book.units*mark.c-100;
    book.hold=book.holdUnits?book.holdUnits*mark.c-100:0;
  }
}
data.ledger=ledger;
fs.writeFileSync("ledger.json",JSON.stringify(ledger,null,2)+"\n");
fs.writeFileSync("site/data.json",JSON.stringify(data));
