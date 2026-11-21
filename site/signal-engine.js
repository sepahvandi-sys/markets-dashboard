function createSignalEngine(S) {
const sma = (a,n) => { let s=0; return a.map((v,i)=>{ s+=v; if(i>=n) s-=a[i-n]; return i<n-1?null:s/n; }); };
function ema(a,n){const k=2/(n+1);let p=null;return a.map((v,i)=>{p = p==null? v : v*k+p*(1-k); return i<n-1?null:p;});}
const COST=0.001;
const RULES={short:[[5,20],[10,30],[10,50]], medium:[[20,100],[50,150],[50,200]], long:[[1,8],[1,10],[1,12]]};
const FRESH={short:5, medium:15, long:1}, NEAR={short:0.004, medium:0.01, long:0.025};
const ruleName=(h,[f,s])=> h==="short"? `EMA ${f}/${s} روزه` : h==="medium"? `میانگین ${f}/${s} روزه` : `قیمت و میانگین ${s} ماهه`;
function seriesFor(id,h){ const f=S.full[id]; if(!f||!S.hist[id]) return null;
  if(h!=="long") return f; const m=new Map(); f.forEach(x=>m.set(x.d.slice(0,7),x)); const arr=[...m.values()]; arr.pop(); return arr; }
function maPair(c,h,[f,s]){ const fn = h==="short"? ema : sma; return [f===1? c : fn(c,f), fn(c,s)]; }
// Evaluate on daily closes, including signals formed on monthly closes.
function bt(daily, series, states, start, end) {
  let cursor = Math.max(0, start - 1);
  const first = daily.findIndex(bar => bar.d >= series[start].d);
  let equity = 1, peak = 1, drawdown = 0, holdPeak = 1, holdDrawdown = 0;
  let position = 0, entry = 0, trades = 0, wins = 0;
  const finish = series[end - 1].d;
  for (let i = first; i < daily.length && daily[i].d <= finish; i++) {
    const bar = daily[i];
    if (i > first && position) equity *= bar.c / daily[i - 1].c;
    while (cursor + 1 < end && series[cursor + 1].d < bar.d) cursor++;
    const target = bar.d === finish ? 0 :
      Number(series[cursor].d < bar.d && states[cursor] === 1);
    if (target !== position) {
      equity *= 1 - COST;
      if (target) entry = bar.c;
      else {
        trades++;
        if (bar.c / entry * (1 - COST) ** 2 > 1) wins++;
      }
      position = target;
    }
    const hold = bar.c / daily[first].c;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
    holdPeak = Math.max(holdPeak, hold);
    holdDrawdown = Math.min(holdDrawdown, hold / holdPeak - 1);
  }
  const yrs = (Date.parse(finish) - Date.parse(series[start].d)) / (365.25 * 864e5);
  const annual = value => 100 * (value ** (1 / yrs) - 1);
  const result = {yrs, cagr: annual(equity), bh: annual(series[end-1].c / series[start].c),
    dd: drawdown * 100, ddb: holdDrawdown * 100, n: trades, win: trades ? 100*wins/trades : 0};
  result.mar = result.cagr / Math.max(1, -result.dd);
  result.marb = result.bh / Math.max(1, -result.ddb);
  return result;
}
const memo=new Map();
function signal(id,h){
  const ser=seriesFor(id,h); if(!ser) return null; const n=ser.length; const key=id+h+n+ser[n-1].c; if(memo.has(key)) return memo.get(key);
  const c=ser.map(x=>x.c); let best=null;
  for(const rule of RULES[h]){ const [fa,sl]=maPair(c,h,rule); const st=c.map((_,i)=> sl[i]==null||fa[i]==null? null : (fa[i]>sl[i]?1:0));
    const a=Math.max(...RULES[h].map(pair=>pair[1]))-1; if(a<0 || n-a < (h==="long"?36:500)) continue; const split=a+Math.floor((n-a)*0.7);
    const IS=bt(S.full[id],ser,st,a,split); if(!best || IS.mar>best.IS.mar) best={rule,st,a,split,IS,fa,sl}; }
  let out=null;
  if(best){ const {st,a,split}=best; const OOS=bt(S.full[id],ser,st,split,n), ALL=bt(S.full[id],ser,st,a,n);
    let j=n-1; while(j>a && st[j-1]===st[n-1]) j--;
    const now=S.full[id][S.full[id].length-1].c;
    const verdict = OOS.n >= 3 && OOS.cagr > 0 && OOS.mar > OOS.marb ? (OOS.cagr > OOS.bh ? 2 : 1) : 0;
    out={id,h,rule:best.rule,state:st[n-1],since:ser[j].d,at:ser[j].c,chg:(now/ser[j].c-1)*100,age:n-1-j,fresh:n-1-j<=FRESH[h],
      gap: h==="long"? now/best.sl[n-1]-1 : best.fa[n-1]/best.sl[n-1]-1, IS:best.IS,OOS,ALL,verdict,from:ser[a].d,st,line:best.sl[n-1]};
    out.near=Math.abs(out.gap)<NEAR[h]; }
  memo.set(key,out); return out;
}


return {signal, memo};
}
if(typeof module !== "undefined") module.exports=createSignalEngine;
