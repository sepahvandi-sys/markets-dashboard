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
function wireRefresh(load){
  const button=document.getElementById("refresh"), status=document.getElementById("refresh-status");
  let token="";
  button.onclick=async()=>{
    button.disabled=true;
    try{
      await load();
      button.disabled=true;
      if(!token){
        const dialog=document.getElementById("refresh-auth"), field=document.getElementById("refresh-token");
        dialog.returnValue="";
        const closed=new Promise(resolve=>dialog.addEventListener("close",resolve,{once:true}));
        dialog.showModal(); await closed;
        if(dialog.returnValue==="start")token=field.value.trim();
        field.value="";
      }
      if(!token){status.textContent="آخرین نسخهٔ منتشرشده درخواست شد؛ اجرای جدید شروع نشد.";return}
      const api="https://api.github.com/repos/sepahvandi-sys/markets-dashboard/actions/workflows/update.yml";
      const before=(await (await fetch("data.json?t="+Date.now(),{cache:"no-store"})).json()).stamp;
      const r=await fetch(api+"/dispatches",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({ref:"main"})});
      if(!r.ok){token="";throw Error("GitHub "+r.status)}
      status.textContent="درخواست دریافت از منابع ثبت شد؛ در انتظار انتشار GitHub…";
      for(let i=0;i<90;i++){
        await new Promise(resolve=>setTimeout(resolve,8000));
        const snapshot=await (await fetch("data.json?t="+Date.now(),{cache:"no-store"})).json();
        if(snapshot.stamp>before){await load();status.textContent="دادهٔ تازه دریافت شد"+(snapshot.errors?.length?"؛ خطای منبع برای "+snapshot.errors.length+" سری":"");return}
      }
      status.textContent="انتشار هنوز تأیید نشده است؛ وضعیت را در GitHub Actions ببینید.";
    }catch(e){status.textContent="تازه‌سازی کامل نشد · "+e.message}
    finally{button.disabled=false}
  };
}
