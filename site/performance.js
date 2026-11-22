const marketNames={gold:"طلا",silver:"نقره",dxy:"شاخص دلار",oil:"برنت",btc:"بیت‌کوین",eth:"اتریوم",spx:"S&P 500",ndx:"نزدک"};
const horizonNames={short:"کوتاه‌مدت",medium:"میان‌مدت",long:"بلندمدت"};
const sideNames={buy:"خرید",sell:"خروج",neutral:"نقد / بدون سیگنال معتبر"};
function renderLedger(ledger){
  const num=v=>Number(v).toLocaleString("fa-IR",{maximumFractionDigits:3});
  const table=(headers,rows)=>"<table><thead><tr>"+headers.map(h=>"<th>"+h+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(c=>"<td>"+c+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
  const rows=[],history=[];
  for(const [id,market] of Object.entries(marketNames))for(const [h,horizon] of Object.entries(horizonNames)){
    const b=ledger?.books?.[id+"/"+h], last=b?.signals.at(-1);
    if(!last){rows.push([market,horizon,"در انتظار اولین ثبت","—","—","—","—","—","—"]);continue}
    const pending=b.holdUnits===0;
    rows.push([market,horizon,b.warning||sideNames[last.side],num(b.mark.c)+" · "+b.mark.d,b.fills.length,num(b.fees),
      pending?"در انتظار اولین بسته‌شدن":num(b.net)+"٪",pending?"—":num(b.hold)+"٪",pending?"—":num(b.net-b.hold)]);
    for(const e of b.signals)history.push([e.time,market,horizon,"ثبت سیگنال",sideNames[e.side],e.date,num(e.price),"—",e.rule]);
    for(const e of b.fills)history.push([e.date+" (پایانی)",market,horizon,"اجرای شبیه‌سازی",sideNames[e.side],e.date,num(e.price),num(e.fee),e.signal]);
  }
  document.getElementById("performance").innerHTML=table(["بازار","افق","آخرین سیگنال","آخرین قیمت و تاریخ","تعداد اجرا","کارمزد (واحد)","سود/زیان خالص","نگهداری","اختلاف (واحد درصد)"],rows);
  document.getElementById("journal").innerHTML=table(["زمان ثبت (UTC) / روز اجرا","بازار","افق","رویداد","جهت","تاریخ قیمت","قیمت","کارمزد","قاعده / زمان سیگنال"],history.sort((a,b)=>b[0].localeCompare(a[0])));
}
const liveQuotes=new Map();
const quoteErrors=new Set();
const quoteSymbols={gold:"COMEX:GC1!",silver:"COMEX:SI1!",dxy:"TVC:DXY",oil:"ICEEUR:BRN1!",spx:"SP:SPX",ndx:"NASDAQ:IXIC",tnx:"TVC:US10Y",btc:"COINBASE:BTCUSD",eth:"COINBASE:ETHUSD"};
const quoteNumber=new Intl.NumberFormat("en-US",{maximumSignificantDigits:7});
const quoteTime=new Intl.DateTimeFormat("fa-IR",{timeZone:"Asia/Tehran",dateStyle:"short",timeStyle:"short"});
async function quoteJSON(url){
  const response=await fetch(url,{cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error("HTTP "+response.status);
  return response.json();
}
function checkedQuote(price,time,source){
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(time)||time<=0)throw Error("Incomplete quote");
  return {price,time,source};
}
async function marketQuote(id){
  if(id==="btc"||id==="eth"){
    try{
      const pair=id==="btc"?"BTC-USD":"ETH-USD";
      const q=await quoteJSON("https://api.exchange.coinbase.com/products/"+pair+"/ticker");
      return checkedQuote(Number(q.price),Date.parse(q.time),"Coinbase · زمان معامله");
    }catch{/* Try the same Coinbase instrument through the scanner. */}
  }
  const params=new URLSearchParams({symbol:quoteSymbols[id],fields:"close,time,update_mode",_t:String(Date.now())});
  const q=await quoteJSON("https://scanner.tradingview.com/symbol?"+params);
  const delay=/delayed_streaming_(\d+)/.exec(q.update_mode||"");
  const label="TradingView"+(delay?" · تأخیر "+Number(delay[1])/60+" دقیقه":"")+" · تاریخ کندل";
  return checkedQuote(q.close,q.time*1000,label);
}
function quoteDisplay(id,previous,date){
  const live=liveQuotes.get(id);
  const value=live?.price??previous;
  const price=value==null?"—":quoteNumber.format(value);
  const label=live?live.source+" "+(live.source.includes("کندل")?new Date(live.time).toLocaleDateString("fa-IR",{timeZone:"UTC"}):quoteTime.format(live.time)):"پایانی ثبت‌شده "+(date||"");
  return '<span class="num">'+price+'</span><div class="sub">'+label+(quoteErrors.has(id)?" · دریافت تازه ناموفق":"")+'</div>';
}
function wireRefresh(assets,redraw){
  const button=document.getElementById("refresh"),status=document.getElementById("refresh-status");
  button.onclick=async()=>{
    if(button.disabled)return;
    button.disabled=true;
    status.textContent="در حال دریافت مستقیم قیمت‌ها…";
    const failed=[];
    try{
      await Promise.all(assets.map(async asset=>{
        try{liveQuotes.set(asset.id,await marketQuote(asset.id));quoteErrors.delete(asset.id)}
        catch{quoteErrors.add(asset.id);failed.push(asset.fa)}
        redraw();
      }));
      const time=new Date().toLocaleTimeString("fa-IR",{timeZone:"Asia/Tehran"});
      status.textContent="دریافت مستقیم "+(assets.length-failed.length)+" از "+assets.length+" بازار · "+time+" تهران"+(failed.length?" · ناموفق: "+failed.join("، "):"");
    }finally{button.disabled=false}
  };
}
