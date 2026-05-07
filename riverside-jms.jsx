import { useState, useEffect, useMemo } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inject print CSS to hide back button
const printStyle = document.createElement("style");
printStyle.innerHTML = "@media print { .no-print { display: none !important; } }";
document.head.appendChild(printStyle);

const SUPABASE_URL = "https://hzxfskdcluuluzpzevnz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6eGZza2RjbHV1bHV6cHpldm56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODM0NTQsImV4cCI6MjA5MzU1OTQ1NH0.D2mXA0yDZQFYBrh09kjlzV4W49f792XBqsP5TCpOo3s";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const COMPANY = "Riverside Sheetmetal Fabrications Ltd";
const COMPANY_SHORT = "RIVERSIDE";
const COMPANY_ADDR = "L2 Riverside Industrial Estate, Littlehampton, West Sussex, BN17 5DF";
const COMPANY_TEL = "01903 732486";
const COMPANY_EMAIL = "info@riversidesheetmetal.co.uk";
const NOTIFY_EMAIL = "danny.stephb@gmail.com";
const VERSION = "v5.0";

const STATUS_FLOW = ["Quote", "In Production", "Part Despatched", "Ready to Despatch", "Invoiced"];
const PRESET_STAGES = ["Cutting", "Laser Cutting", "Welding", "Bending / Forming", "Punching", "Rolling", "Grinding", "Powder Coat", "Painting", "Assembly", "QC Check"];
const PRIORITIES = ["Normal", "High", "Urgent", "Low"];
const QUOTE_STATUSES = ["Pending", "Approved", "Rejected", "N/A"];
const LASER_CUSTOMERS = ["tara signs"];

const C = {
  navy:"#0f2a4a", navyMid:"#1a3f6f", navyLight:"#234e86",
  silver:"#c8d0dc", silverLight:"#e8ecf1", silverPale:"#f4f6f9",
  white:"#ffffff", accent:"#1e5faa", gold:"#c9a84c",
  success:"#1a7a4a", successBg:"#e8f5ee",
  danger:"#b83030", dangerBg:"#fceaea",
  warn:"#b86a10", warnBg:"#fef3e2",
  purple:"#6b3fa0", purpleBg:"#f0ebfa",
  text:"#0f1e30", textMid:"#3a4f66", textLight:"#6a7f99",
  border:"#d0d8e4", borderLight:"#e8ecf2",
};

const SC = {
  "Quote":              {bg:"#e8ecf8", color:"#1a3a8a", border:"#b0bce8"},
  "In Production":      {bg:"#fef3e2", color:"#7a4500", border:"#f5c060"},
  "Part Despatched":    {bg:"#f0ebfa", color:"#6b3fa0", border:"#c9a8e8"},
  "Ready to Despatch":  {bg:"#e8f5ee", color:"#0f5a30", border:"#6ecf9a"},
  "Invoiced":           {bg:"#f0f0f0", color:"#555",    border:"#ccc"},
};

function todayStr(){return new Date().toISOString().split("T")[0];}
function tomorrowStr(){const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().split("T")[0];}
function fmt(d){if(!d)return"—";const[y,m,day]=d.split("-");return`${day}/${m}/${y}`;}
function isOverdue(j){if(!j.due_date||j.status==="Invoiced")return false;return new Date(j.due_date)<new Date(todayStr());}
function isDueTomorrow(j){if(!j.due_date||["Invoiced","Ready to Despatch"].includes(j.status))return false;return j.due_date===tomorrowStr();}
function lineTotal(lines){return(lines||[]).reduce((a,l)=>a+(parseFloat(l.qty||1)*parseFloat(l.price||0)),0);}
function fmtGBP(n){return"£"+parseFloat(n||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});}
function newLine(){return{id:"l"+Date.now()+Math.random().toString(36).slice(2),desc:"",qty:"1",price:"",delivered:false,deliveredDate:"",deliveredNote:""};}
function newJob(){return{id:"",job_ref:"",customer_id:"",customer_name:"",contact_id:"",contact_name:"",description:"",po_number:"",status:"In Production",priority:"Normal",quote_ref:"",quote_status:"N/A",lines:[newLine()],stages:[],stages_complete:{},drawing_number:"",drawing_attached:false,date_received:todayStr(),due_date:"",invoice_ref:"",notes:""};}
function newCust(){return{id:"",name:"",contacts:[{id:"ct"+Date.now(),name:"",email:"",phone:""}],notes:""};}

async function sendEmail(to,subject,html){
  try{await supabase.functions.invoke("send-email",{body:{to,subject,html}});}catch(e){console.warn("Email:",e);}
}

function buildMondayHTML(jobs){
  const rows=jobs.map(j=>`<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${j.job_ref}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${j.customer_name||""}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${j.po_number||"—"}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${j.description||""}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${isOverdue(j)?"#b83030":"#333"}">${fmt(j.due_date)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${fmtGBP(lineTotal(j.lines))}</td></tr>`).join("");
  return`<div style="font-family:Arial,sans-serif;max-width:700px"><div style="background:#0f2a4a;padding:20px 24px;border-bottom:3px solid #c9a84c"><h2 style="color:#fff;margin:0;font-size:18px">${COMPANY}</h2><p style="color:#c8d0dc;margin:4px 0 0;font-size:13px">Monday Morning Production Report — ${fmt(todayStr())}</p></div><div style="padding:20px 24px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0f2a4a"><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">Job Ref</th><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">Customer</th><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">PO</th><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">Description</th><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">Due</th><th style="padding:8px 12px;text-align:left;color:#c8d0dc;font-size:11px;text-transform:uppercase">Value</th></tr></thead><tbody>${rows}</tbody></table><p style="color:#6a7f99;font-size:12px;margin-top:20px">${jobs.length} job${jobs.length!==1?"s":""} · Total: ${fmtGBP(jobs.reduce((a,j)=>a+lineTotal(j.lines),0))}</p></div><div style="background:#f4f6f9;padding:12px 24px;border-top:1px solid #d0d8e4"><p style="color:#6a7f99;font-size:11px;margin:0">${COMPANY} · ${COMPANY_ADDR}</p></div></div>`;
}

function useMondayReport(jobs){
  useEffect(()=>{
    const check=async()=>{
      const now=new Date();
      if(now.getDay()===1&&now.getHours()===9&&now.getMinutes()<5){
        const key=todayStr();
        if(localStorage.getItem("rsm_monday")!==key){
          const inProd=jobs.filter(j=>j.status==="In Production");
          if(inProd.length>0){
            await sendEmail(NOTIFY_EMAIL,`Monday Production Report — ${fmt(key)}`,buildMondayHTML(inProd));
            localStorage.setItem("rsm_monday",key);
            window.__mondayJobs=inProd;
            window.dispatchEvent(new Event("mondayprint"));
          }
        }
      }
    };
    check();
    const t=setInterval(check,60000);
    return()=>clearInterval(t);
  },[jobs]);
}

export default function App(){
  const[jobs,setJobs]=useState([]);
  const[customers,setCustomers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[view,setView]=useState("dashboard");
  const[jobModal,setJobModal]=useState(null);
  const[editJob,setEditJob]=useState(null);
  const[editCust,setEditCust]=useState(null);
  const[filterStatus,setFilterStatus]=useState("All");
  const[search,setSearch]=useState("");
  const[priceSearch,setPriceSearch]=useState("");
  const[toast,setToast]=useState(null);
  const[printJob,setPrintJob]=useState(null);
  const[deliveryJob,setDeliveryJob]=useState(null);
  const[mondayPrint,setMondayPrint]=useState(null);
  const[stageInput,setStageInput]=useState("");
  const[confirmDel,setConfirmDel]=useState(null);
  const[laserPrompt,setLaserPrompt]=useState(null);
  const[custHistory,setCustHistory]=useState(null);
  const[invoicePrompt,setInvoicePrompt]=useState(null);
  const[partDelivery,setPartDelivery]=useState(null);

  useEffect(()=>{
    loadAll();
    const js=supabase.channel("jch").on("postgres_changes",{event:"*",schema:"public",table:"jobs"},()=>loadJobs()).subscribe();
    const cs=supabase.channel("cch").on("postgres_changes",{event:"*",schema:"public",table:"customers"},()=>loadCustomers()).subscribe();
    const om=()=>{if(window.__mondayJobs)setMondayPrint(window.__mondayJobs);};
    window.addEventListener("mondayprint",om);
    return()=>{js.unsubscribe();cs.unsubscribe();window.removeEventListener("mondayprint",om);};
  },[]);

  async function loadAll(){setLoading(true);await Promise.all([loadJobs(),loadCustomers()]);setLoading(false);}
  async function loadJobs(){const{data}=await supabase.from("jobs").select("*").order("created_at",{ascending:false});if(data)setJobs(data);}
  async function loadCustomers(){const{data}=await supabase.from("customers").select("*").order("name");if(data)setCustomers(data);}
  useMondayReport(jobs);

  function toast_(msg,type="ok"){setToast({msg,type});setTimeout(()=>setToast(null),4000);}

  async function getNextRef(){
    const{data}=await supabase.rpc("increment_job_counter").single();
    if(data)return"R"+String(data).padStart(6,"0");
    const nums=jobs.map(j=>{const m=j.job_ref?.match(/R0*(\d+)/);return m?parseInt(m[1]):0;});
    return"R"+String((nums.length>0?Math.max(...nums):0)+1).padStart(6,"0");
  }

  async function saveJob(j){
    const isNew=!j.id;
    let ref=j.job_ref;
    if(isNew)ref=await getNextRef();
    const payload={job_ref:ref,customer_id:j.customer_id||null,customer_name:j.customer_name,contact_id:j.contact_id,contact_name:j.contact_name,description:j.description,po_number:j.po_number,status:j.status,priority:j.priority,quote_ref:j.quote_ref,quote_status:j.quote_status,lines:j.lines||[],stages:j.stages||[],stages_complete:j.stages_complete||{},drawing_number:j.drawing_number,drawing_attached:j.drawing_attached||false,date_received:j.date_received||todayStr(),due_date:j.due_date||null,invoice_ref:j.invoice_ref,notes:j.notes};
    if(isNew){
      const{error}=await supabase.from("jobs").insert([payload]);
      if(error){toast_("Error: "+error.message,"warn");return;}
      exportJobCSV({...payload,job_ref:ref});
    }else{
      const{error}=await supabase.from("jobs").update(payload).eq("id",j.id);
      if(error){toast_("Error: "+error.message,"warn");return;}
    }
    await loadJobs();
    toast_(isNew?`Job ${ref} created`:`Job ${j.job_ref} saved`);
    setEditJob(null);
  }

  async function deleteJob(id){
    await supabase.from("jobs").delete().eq("id",id);
    await loadJobs();
    setJobModal(null);setConfirmDel(null);
    toast_("Job deleted","warn");
  }

  async function advanceJob(job){
    const idx=STATUS_FLOW.indexOf(job.status);
    if(idx>=STATUS_FLOW.length-1)return;
    const next=STATUS_FLOW[idx+1];
    // If moving to Invoiced, prompt for invoice ref
    if(next==="Invoiced"){setInvoicePrompt(job);return;}
    const updated={...job,status:next};
    await supabase.from("jobs").update({status:next}).eq("id",job.id);
    await loadJobs();
    setJobModal(updated);
    toast_(`Moved to: ${next}`);
    if(next==="Ready to Despatch")setTimeout(()=>setDeliveryJob(updated),300);
  }

  async function markInvoiced(job,invoiceRef){
    await supabase.from("jobs").update({status:"Invoiced",invoice_ref:invoiceRef}).eq("id",job.id);
    await loadJobs();
    setJobModal(null);setInvoicePrompt(null);
    toast_(`Job ${job.job_ref} invoiced — Ref: ${invoiceRef}`);
  }

  async function toggleStage(job,stage){
    const sc={...job.stages_complete,[stage]:!job.stages_complete?.[stage]};
    await supabase.from("jobs").update({stages_complete:sc}).eq("id",job.id);
    const u={...job,stages_complete:sc};
    setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);
  }
  async function addStage(job,s){
    const stage=(s||stageInput).trim();
    if(!stage||job.stages?.includes(stage))return;
    const stages=[...(job.stages||[]),stage];
    await supabase.from("jobs").update({stages}).eq("id",job.id);
    const u={...job,stages};setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);setStageInput("");
  }
  async function removeStage(job,stage){
    const sc={...job.stages_complete};delete sc[stage];
    const stages=job.stages.filter(s=>s!==stage);
    await supabase.from("jobs").update({stages,stages_complete:sc}).eq("id",job.id);
    const u={...job,stages,stages_complete:sc};setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);
  }

  async function savePartDelivery(job,selectedLineIds,note){
    const now=todayStr();
    const updatedLines=job.lines.map(l=>selectedLineIds.includes(l.id)?{...l,delivered:true,deliveredDate:now,deliveredNote:note}:l);
    const allDelivered=updatedLines.every(l=>l.delivered);
    const newStatus=allDelivered?"Ready to Despatch":"Part Despatched";
    await supabase.from("jobs").update({lines:updatedLines,status:newStatus}).eq("id",job.id);
    await loadJobs();
    const updated={...job,lines:updatedLines,status:newStatus};
    setPartDelivery(null);
    setJobModal(updated);
    toast_(`Delivery recorded — job now: ${newStatus}`);
    // Auto print delivery note for selected lines
    setTimeout(()=>setDeliveryJob({...updated,lines:updatedLines.filter(l=>selectedLineIds.includes(l.id))}),300);
  }

  async function saveCust(c){
    const isNew=!c.id;
    const payload={name:c.name,contacts:c.contacts||[],notes:c.notes||""};
    if(isNew)await supabase.from("customers").insert([payload]);
    else await supabase.from("customers").update(payload).eq("id",c.id);
    await loadCustomers();
    toast_(isNew?`${c.name} added`:`${c.name} updated`);
    setEditCust(null);
  }

  function exportJobCSV(job){
    const hdr=["Job Ref","Customer","Contact","PO Number","Description","Status","Priority","Received","Due","Total Value","Drawing No","Invoice Ref","Notes"];
    const row=[job.job_ref,job.customer_name,job.contact_name,job.po_number,job.description,job.status,job.priority,fmt(job.date_received),fmt(job.due_date),fmtGBP(lineTotal(job.lines)),job.drawing_number,job.invoice_ref,job.notes];
    const csv=[hdr,row].map(r=>r.map(c=>`"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${job.job_ref}_${todayStr()}.csv`;a.click();
  }
  function exportAllCSV(jobList){
    const hdr=["Job Ref","Customer","Contact","PO Number","Description","Status","Priority","Received","Due","Total Value","Drawing No","Invoice Ref","Notes"];
    const rows=jobList.map(j=>[j.job_ref,j.customer_name,j.contact_name,j.po_number,j.description,j.status,j.priority,fmt(j.date_received),fmt(j.due_date),fmtGBP(lineTotal(j.lines)),j.drawing_number,j.invoice_ref,j.notes]);
    const csv=[hdr,...rows].map(r=>r.map(c=>`"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`riverside_jobs_${todayStr()}.csv`;a.click();
    toast_("CSV exported");
  }

  async function sendMondayReport(){
    const inProd=jobs.filter(j=>j.status==="In Production");
    if(inProd.length===0){toast_("No jobs in production","warn");return;}
    await sendEmail(NOTIFY_EMAIL,`Production Report — ${fmt(todayStr())}`,buildMondayHTML(inProd));
    setMondayPrint(inProd);
    toast_("Report sent to Danny & printing");
  }

  const dueTomorrow=jobs.filter(j=>isDueTomorrow(j));
  const overdue=jobs.filter(j=>isOverdue(j));
  const uninvoiced=jobs.filter(j=>j.status==="Ready to Despatch");
  const counts=STATUS_FLOW.reduce((a,s)=>({...a,[s]:jobs.filter(j=>j.status===s).length}),{});
  const pipeline=jobs.filter(j=>j.status!=="Invoiced").reduce((a,j)=>a+lineTotal(j.lines),0);

  const filtered=useMemo(()=>jobs.filter(j=>{
    const ms=filterStatus==="All"||j.status===filterStatus;
    const q=search.toLowerCase();
    const mq=!q||[j.job_ref,j.customer_name,j.description,j.po_number].some(f=>f?.toLowerCase().includes(q));
    return ms&&mq;
  }),[jobs,filterStatus,search]);

  const priceResults=useMemo(()=>{
    if(!priceSearch.trim())return[];
    const q=priceSearch.toLowerCase();
    const out=[];
    jobs.forEach(j=>(j.lines||[]).forEach(l=>{
      if(l.desc?.toLowerCase().includes(q))
        out.push({job_ref:j.job_ref,customer:j.customer_name,date:j.date_received,desc:l.desc,qty:l.qty,price:l.price,total:fmtGBP(parseFloat(l.qty||1)*parseFloat(l.price||0))});
    }));
    return out;
  },[priceSearch,jobs]);

  if(printJob)return<PrintSheet job={printJob} onClose={()=>setPrintJob(null)}/>;
  if(deliveryJob)return<DeliveryNote job={deliveryJob} onClose={()=>setDeliveryJob(null)}/>;
  if(mondayPrint)return<MondayReport jobs={mondayPrint} onClose={()=>setMondayPrint(null)}/>;

  return(
    <div style={{minHeight:"100vh",background:C.silverPale,fontFamily:"'Trebuchet MS','Segoe UI',sans-serif",color:C.text}}>
      {toast&&<div style={{position:"fixed",bottom:24,right:24,color:"#fff",fontWeight:700,fontSize:13,padding:"10px 20px",borderRadius:6,zIndex:9999,background:toast.type==="warn"?C.danger:C.success,boxShadow:"0 4px 20px #0004"}}>{toast.msg}</div>}

      {dueTomorrow.length>0&&<div style={{background:C.warnBg,borderBottom:`2px solid ${C.gold}`,padding:"8px 24px",display:"flex",alignItems:"center",gap:12}}><span style={{fontWeight:700,fontSize:13,color:C.warn}}>⏰ Reminder:</span><span style={{fontSize:13,color:C.warn}}>{dueTomorrow.length} job{dueTomorrow.length>1?"s":""} due tomorrow not yet ready: {dueTomorrow.map(j=>j.job_ref).join(", ")}</span></div>}

      {/* INVOICE PROMPT */}
      {invoicePrompt&&(
        <Overlay onClose={()=>setInvoicePrompt(null)}>
          <InvoicePrompt job={invoicePrompt} onConfirm={markInvoiced} onCancel={()=>setInvoicePrompt(null)}/>
        </Overlay>
      )}

      {/* CONFIRM DELETE */}
      {confirmDel&&(
        <Overlay onClose={()=>setConfirmDel(null)}>
          <div style={{maxWidth:360}}>
            <div style={{fontSize:17,fontWeight:700,color:C.navy,marginBottom:10}}>Delete Job?</div>
            <div style={{fontSize:14,color:C.textMid,lineHeight:1.6}}>Permanently delete <strong>{confirmDel.job_ref}</strong>?</div>
            <div style={{display:"flex",gap:10,marginTop:20}}><Btn danger onClick={()=>deleteJob(confirmDel.id)}>Delete</Btn><Btn ghost onClick={()=>setConfirmDel(null)}>Cancel</Btn></div>
          </div>
        </Overlay>
      )}

      {/* LASER PROMPT */}
      {laserPrompt&&(
        <Overlay onClose={()=>{saveJob(laserPrompt.job);setLaserPrompt(null);}}>
          <div style={{maxWidth:380,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:12}}>✂️</div>
            <div style={{fontSize:17,fontWeight:700,color:C.navy,marginBottom:10}}>Laser Cutting Required?</div>
            <div style={{fontSize:14,color:C.textMid,marginBottom:20}}>This job is for <strong>{laserPrompt.job.customer_name}</strong> — add Laser Cutting to production stages?</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn primary onClick={()=>{const j={...laserPrompt.job,stages:["Laser Cutting",...(laserPrompt.job.stages||[]).filter(s=>s!=="Laser Cutting")]};saveJob(j);setLaserPrompt(null);}}>Yes — Add Laser Cutting</Btn>
              <Btn ghost onClick={()=>{saveJob(laserPrompt.job);setLaserPrompt(null);}}>No Thanks</Btn>
            </div>
          </div>
        </Overlay>
      )}

      {/* PART DELIVERY */}
      {partDelivery&&(
        <Overlay onClose={()=>setPartDelivery(null)}>
          <PartDeliveryForm job={partDelivery} onConfirm={savePartDelivery} onCancel={()=>setPartDelivery(null)}/>
        </Overlay>
      )}

      <header style={{background:C.navy,borderBottom:`3px solid ${C.gold}`,padding:"0 24px",display:"flex",alignItems:"center",gap:20,height:62,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Logo/>
          <div>
            <div style={{fontWeight:800,fontSize:15,letterSpacing:2,color:C.white}}>RIVERSIDE</div>
            <div style={{fontSize:9,letterSpacing:1,color:C.silver,marginTop:1}}>Sheetmetal Fabrications Ltd · Job Management {VERSION}</div>
          </div>
        </div>
        <nav style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
          {[{k:"dashboard",l:"Dashboard"},{k:"jobs",l:"Jobs"},{k:"quotes",l:"Quotes"},{k:"customers",l:"Customers"},{k:"pricing",l:"Price Search"},{k:"alerts",l:"Alerts"}].map(({k,l})=>(
            <button key={k} style={{background:"none",border:"none",color:view===k?C.white:C.silver,fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"4px 14px",cursor:"pointer",borderBottom:view===k?`3px solid ${C.gold}`:"3px solid transparent",whiteSpace:"nowrap",height:62,letterSpacing:0.3,position:"relative"}} onClick={()=>setView(k)}>
              {l}{k==="alerts"&&(uninvoiced.length+overdue.length+dueTomorrow.length>0)&&<span style={{position:"absolute",top:14,right:6,width:7,height:7,borderRadius:"50%",background:"#e84040"}}/>}
            </button>
          ))}
        </nav>
        <button style={{background:"none",border:`1px solid ${C.silver}44`,color:C.silver,fontFamily:"inherit",fontWeight:600,fontSize:12,padding:"6px 12px",cursor:"pointer",borderRadius:5,whiteSpace:"nowrap",marginRight:6}} onClick={sendMondayReport}>📋 Send Report</button>
        <button style={{background:C.gold,color:C.navy,border:"none",fontFamily:"inherit",fontWeight:800,fontSize:13,padding:"8px 18px",cursor:"pointer",borderRadius:5,whiteSpace:"nowrap"}} onClick={()=>setEditJob(newJob())}>+ New Job</button>
      </header>

      <main style={{padding:"24px 24px 48px"}}>
        <div style={{maxWidth:1280,margin:"0 auto"}}>
          {loading&&<div style={{textAlign:"center",padding:"60px 0",color:C.textLight,fontSize:14}}>Loading…</div>}
          {!loading&&<>

            {/* DASHBOARD */}
            {view==="dashboard"&&<>
              <h1 style={S.pageH}>Dashboard</h1>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:24}}>
                {STATUS_FLOW.map(s=>(
                  <div key={s} style={{background:C.white,border:`1px solid ${C.border}`,borderTop:`3px solid ${SC[s].border}`,borderRadius:8,padding:"14px 16px",cursor:"pointer"}} onClick={()=>{setView("jobs");setFilterStatus(s);}}>
                    <div style={{fontSize:28,fontWeight:800,color:SC[s].color,lineHeight:1}}>{counts[s]}</div>
                    <div style={{fontSize:10,color:C.textLight,marginTop:4,fontWeight:600,letterSpacing:0.3}}>{s}</div>
                  </div>
                ))}
                <div style={{background:C.white,border:`1px solid ${C.border}`,borderTop:`3px solid ${C.gold}`,borderRadius:8,padding:"14px 16px"}}>
                  <div style={{fontSize:22,fontWeight:800,color:C.gold,lineHeight:1}}>{fmtGBP(pipeline)}</div>
                  <div style={{fontSize:10,color:C.textLight,marginTop:4,fontWeight:600,letterSpacing:0.3}}>Pipeline</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:24}}>
                <ACard title="Overdue Jobs" count={overdue.length} color={C.danger}>{overdue.length===0?<Em>All on schedule ✓</Em>:overdue.map(j=><ARow key={j.id} job={j} onClick={()=>setJobModal(j)}><span style={{color:C.danger,fontSize:12}}>Due {fmt(j.due_date)}</span></ARow>)}</ACard>
                <ACard title="Ready to Despatch — Awaiting Invoice" count={uninvoiced.length} color={C.accent}>{uninvoiced.length===0?<Em>No outstanding invoices ✓</Em>:uninvoiced.map(j=><ARow key={j.id} job={j} onClick={()=>setJobModal(j)}><span style={{color:C.accent,fontSize:12}}>{fmtGBP(lineTotal(j.lines))}</span></ARow>)}</ACard>
                {dueTomorrow.length>0&&<ACard title="Due Tomorrow — Not Ready" count={dueTomorrow.length} color={C.warn}>{dueTomorrow.map(j=><ARow key={j.id} job={j} onClick={()=>setJobModal(j)}><span style={{color:C.warn,fontSize:12}}>{j.status}</span></ARow>)}</ACard>}
              </div>
              <h2 style={S.subH}>Recent Jobs</h2>
              <JobTable jobs={jobs.slice(0,10)} onOpen={setJobModal}/>
            </>}

            {/* JOBS */}
            {view==="jobs"&&<>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                <h1 style={{...S.pageH,margin:0}}>All Jobs</h1>
                <input style={S.inp2} placeholder="Search ref, customer, PO…" value={search} onChange={e=>setSearch(e.target.value)}/>
                <Btn onClick={()=>exportAllCSV(filtered)}>↓ Export CSV</Btn>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {["All",...STATUS_FLOW].map(s=><button key={s} style={{background:filterStatus===s?C.navy:C.white,color:filterStatus===s?C.white:C.textMid,border:`1px solid ${filterStatus===s?C.navy:C.border}`,borderRadius:20,padding:"4px 14px",fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={()=>setFilterStatus(s)}>{s}</button>)}
              </div>
              <JobTable jobs={filtered} onOpen={setJobModal}/>
              {filtered.length===0&&<Em center>No jobs match your search.</Em>}
            </>}

            {/* QUOTES */}
            {view==="quotes"&&<>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <h1 style={{...S.pageH,margin:0}}>Quotes</h1>
                <Btn onClick={()=>setEditJob({...newJob(),status:"Quote",quote_status:"Pending"})}>+ New Quote</Btn>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
                {["Pending","Approved","Rejected"].map(qs=>{
                  const qj=jobs.filter(j=>j.status==="Quote"&&j.quote_status===qs);
                  const tot=qj.reduce((a,j)=>a+lineTotal(j.lines),0);
                  const hc=qs==="Approved"?C.successBg:qs==="Rejected"?C.dangerBg:C.warnBg;
                  const tc=qs==="Approved"?C.success:qs==="Rejected"?C.danger:C.warn;
                  return<div key={qs} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                    <div style={{padding:"10px 16px",background:hc,color:tc,fontWeight:700,fontSize:13,display:"flex",justifyContent:"space-between"}}><span>{qs}</span><span style={{fontWeight:400,fontSize:12}}>{qj.length} · {fmtGBP(tot)}</span></div>
                    {qj.length===0&&<Em>None</Em>}
                    {qj.map(j=><div key={j.id} style={{padding:"12px 16px",borderTop:`1px solid ${C.borderLight}`,cursor:"pointer"}} onClick={()=>setJobModal(j)}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Ref>{j.job_ref}</Ref><span style={{fontWeight:700,color:C.navy,fontSize:13}}>{fmtGBP(lineTotal(j.lines))}</span></div>
                      <div style={{fontSize:13,color:C.textMid,marginBottom:2}}>{j.customer_name}</div>
                      {j.po_number&&<div style={{fontSize:11,color:C.textLight}}>PO: {j.po_number}</div>}
                      <div style={{fontSize:11,color:C.textLight,marginTop:4}}>Due {fmt(j.due_date)}</div>
                    </div>)}
                  </div>;
                })}
              </div>
            </>}

            {/* CUSTOMERS */}
            {view==="customers"&&<>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <h1 style={{...S.pageH,margin:0}}>Customers</h1>
                <Btn onClick={()=>setEditCust(newCust())}>+ Add Customer</Btn>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {customers.map(c=>{
                  const cj=jobs.filter(j=>j.customer_id===c.id);
                  const active=cj.filter(j=>j.status!=="Invoiced").length;
                  const uninv=cj.filter(j=>j.status==="Ready to Despatch").length;
                  const total=cj.reduce((a,j)=>a+lineTotal(j.lines),0);
                  return<div key={c.id} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:16,display:"flex",gap:14,alignItems:"flex-start"}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:C.navyLight,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0}}>{c.name.split(" ").slice(0,2).map(w=>w[0]).join("")}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:15,color:C.navy,marginBottom:6}}>{c.name}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:8}}>{(c.contacts||[]).map(ct=><div key={ct.id} style={{fontSize:12,color:C.textMid}}>👤 {ct.name}{ct.phone?` · ${ct.phone}`:""}{ct.email?` · ${ct.email}`:""}</div>)}</div>
                      {c.notes&&<div style={{fontSize:12,color:C.textLight,fontStyle:"italic",marginBottom:8}}>{c.notes}</div>}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        <Tag>{cj.length} total jobs</Tag>
                        {active>0&&<Tag color={C.accent}>{active} active</Tag>}
                        {uninv>0&&<Tag color={C.danger}>{uninv} awaiting invoice</Tag>}
                        <Tag color={C.gold}>Lifetime: {fmtGBP(total)}</Tag>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button style={S.iconBtn} onClick={()=>setCustHistory(c)}>📋 History</button>
                      <button style={S.iconBtn} onClick={()=>setEditCust(c)}>✎ Edit</button>
                    </div>
                  </div>;
                })}
              </div>
            </>}

            {/* PRICE SEARCH */}
            {view==="pricing"&&<>
              <h1 style={S.pageH}>Price Search</h1>
              <input style={{...S.inp2,maxWidth:480,marginBottom:20}} placeholder="Search by keyword e.g. 'bracket', 'laser', 'panel'…" value={priceSearch} onChange={e=>setPriceSearch(e.target.value)} autoFocus/>
              {priceSearch&&priceResults.length===0&&<Em center>No matching line items found.</Em>}
              {priceResults.length>0&&<div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",background:C.white,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",fontSize:13}}>
                  <thead><tr style={{background:C.navy}}>{["Job Ref","Customer","Date","Description","Qty","Unit Price","Line Total"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",color:C.silver,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>{priceResults.map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`}}><td style={S.td}><Ref>{r.job_ref}</Ref></td><td style={S.td}>{r.customer}</td><td style={S.td}>{fmt(r.date)}</td><td style={S.td}>{r.desc}</td><td style={S.td}>{r.qty}</td><td style={S.td}>{fmtGBP(r.price)}</td><td style={{...S.td,fontWeight:700,color:C.navy}}>{r.total}</td></tr>)}</tbody>
                </table>
              </div>}
              {!priceSearch&&<Em center>Type a keyword to search pricing history across all jobs.</Em>}
            </>}

            {/* ALERTS */}
            {view==="alerts"&&<>
              <h1 style={S.pageH}>Alerts & Actions Required</h1>
              {dueTomorrow.length>0&&<><ACard title="Due Tomorrow — Not Yet Ready" count={dueTomorrow.length} color={C.warn}>{dueTomorrow.map(j=><ALarge key={j.id} job={j} onClick={()=>setJobModal(j)}/>)}</ACard><div style={{height:16}}/></>}
              <ACard title="Overdue Jobs" count={overdue.length} color={C.danger}>{overdue.length===0?<Em>No overdue jobs ✓</Em>:overdue.map(j=><ALarge key={j.id} job={j} onClick={()=>setJobModal(j)}/>)}</ACard>
              <div style={{height:16}}/>
              <ACard title="Ready to Despatch — Awaiting Invoice" count={uninvoiced.length} color={C.accent}>{uninvoiced.length===0?<Em>All invoiced ✓</Em>:uninvoiced.map(j=><ALarge key={j.id} job={j} onClick={()=>setJobModal(j)} extra={fmtGBP(lineTotal(j.lines))}/>)}</ACard>
            </>}

          </>}
        </div>
      </main>

      {/* CUSTOMER HISTORY */}
      {custHistory&&<Overlay onClose={()=>setCustHistory(null)}>
        <div style={{minWidth:300,maxWidth:700}}>
          <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:4}}>{custHistory.name}</div>
          <div style={{fontSize:13,color:C.textLight,marginBottom:16}}>Order & pricing history</div>
          {jobs.filter(j=>j.customer_id===custHistory.id).length===0?<Em>No jobs found.</Em>:jobs.filter(j=>j.customer_id===custHistory.id).map(j=>(
            <div key={j.id} style={{border:`1px solid ${C.border}`,borderRadius:8,marginBottom:12,overflow:"hidden"}}>
              <div style={{background:C.silverPale,padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}><Ref>{j.job_ref}</Ref>{j.po_number&&<span style={{fontSize:12,color:C.textLight}}>PO: {j.po_number}</span>}<SPill s={j.status}/></div>
                <div style={{fontSize:12,color:C.textLight}}>Due {fmt(j.due_date)} · {j.contact_name}</div>
              </div>
              <div style={{padding:"8px 14px"}}>
                {(j.lines||[]).map(l=><div key={l.id} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",borderBottom:`1px solid ${C.borderLight}`}}>
                  <span style={{flex:1}}>{l.desc}</span>
                  <span style={{color:C.textLight,marginLeft:12}}>x{l.qty}</span>
                  <span style={{color:C.textLight,marginLeft:12,minWidth:60,textAlign:"right"}}>{fmtGBP(l.price)} ea</span>
                  <span style={{color:C.navy,fontWeight:700,marginLeft:12,minWidth:70,textAlign:"right"}}>{fmtGBP(parseFloat(l.qty||1)*parseFloat(l.price||0))}</span>
                </div>)}
                <div style={{display:"flex",justifyContent:"flex-end",fontWeight:700,fontSize:14,color:C.navy,paddingTop:6}}>Total: {fmtGBP(lineTotal(j.lines))}</div>
              </div>
            </div>
          ))}
          <div style={{marginTop:8,fontWeight:700,fontSize:14,color:C.navy,textAlign:"right"}}>Lifetime Value: {fmtGBP(jobs.filter(j=>j.customer_id===custHistory.id).reduce((a,j)=>a+lineTotal(j.lines),0))}</div>
        </div>
      </Overlay>}

      {/* JOB DETAIL */}
      {jobModal&&!editJob&&<Overlay onClose={()=>setJobModal(null)}>
        <JobDetail job={jobModal}
          onEdit={()=>{setEditJob(jobModal);setJobModal(null);}}
          onAdvance={()=>advanceJob(jobModal)}
          onDelete={()=>{setConfirmDel(jobModal);setJobModal(null);}}
          onToggleStage={toggleStage} onAddStage={addStage} onRemoveStage={removeStage}
          onPrint={()=>{setPrintJob(jobModal);setJobModal(null);}}
          onDelivery={()=>{setDeliveryJob(jobModal);setJobModal(null);}}
          onPartDelivery={()=>{setPartDelivery(jobModal);setJobModal(null);}}
          stageInput={stageInput} setStageInput={setStageInput}
          allJobs={jobs}
        />
      </Overlay>}

      {/* JOB FORM */}
      {editJob&&<Overlay onClose={()=>setEditJob(null)}>
        <JobForm job={editJob} customers={customers} allJobs={jobs}
          onSave={(j)=>{
            const cust=customers.find(c=>c.id===j.customer_id);
            const custName=cust?.name||j.customer_name||"";
            const isNew=!j.id;
            const isLaser=isNew&&LASER_CUSTOMERS.some(n=>custName.toLowerCase().includes(n));
            const jobWithName={...j,customer_name:custName};
            if(isLaser&&!laserPrompt){setLaserPrompt({job:jobWithName});setEditJob(null);}
            else saveJob(jobWithName);
          }}
          onCancel={()=>setEditJob(null)}
        />
      </Overlay>}

      {/* CUSTOMER FORM */}
      {editCust&&<Overlay onClose={()=>setEditCust(null)}>
        <CustForm cust={editCust} onSave={saveCust} onCancel={()=>setEditCust(null)}/>
      </Overlay>}
    </div>
  );
}

// ── INVOICE PROMPT ────────────────────────────────────────────────────────────
function InvoicePrompt({job,onConfirm,onCancel}){
  const[ref,setRef]=useState(job.invoice_ref||"");
  return(
    <div style={{maxWidth:400}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:8}}>Mark as Invoiced</div>
      <div style={{fontSize:14,color:C.textMid,marginBottom:16}}>Job <strong>{job.job_ref}</strong> · {job.customer_name}</div>
      <FF label="QuickBooks Invoice Reference">
        <input style={S.inp} value={ref} onChange={e=>setRef(e.target.value)} placeholder="e.g. INV-001" autoFocus/>
      </FF>
      <div style={{fontSize:12,color:C.textLight,marginBottom:16}}>Enter your QB invoice number to cross-reference. You can leave blank and add later.</div>
      <div style={{display:"flex",gap:10}}>
        <Btn primary onClick={()=>onConfirm(job,ref)}>Mark Invoiced</Btn>
        <Btn ghost onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── PART DELIVERY FORM ────────────────────────────────────────────────────────
function PartDeliveryForm({job,onConfirm,onCancel}){
  const available=(job.lines||[]).filter(l=>!l.delivered);
  const[selected,setSelected]=useState(available.map(l=>l.id));
  const[note,setNote]=useState("");
  function toggle(id){setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);}
  return(
    <div style={{maxWidth:540}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:4}}>Record Part Delivery</div>
      <div style={{fontSize:13,color:C.textLight,marginBottom:16}}>Select the items being despatched today</div>
      {available.length===0&&<Em>All lines already delivered.</Em>}
      {available.map(l=>(
        <div key={l.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:selected.includes(l.id)?C.successBg:C.white,border:`1px solid ${selected.includes(l.id)?"#90d0a0":C.border}`,borderRadius:8,marginBottom:8,cursor:"pointer"}} onClick={()=>toggle(l.id)}>
          <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${selected.includes(l.id)?C.success:C.border}`,background:selected.includes(l.id)?C.success:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {selected.includes(l.id)&&<span style={{color:"#fff",fontSize:12}}>✓</span>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>{l.desc||"—"}</div>
            <div style={{fontSize:12,color:C.textLight}}>Qty: {l.qty} · {fmtGBP(parseFloat(l.qty||1)*parseFloat(l.price||0))}</div>
          </div>
        </div>
      ))}
      <FF label="Delivery Note / Reference">
        <input style={S.inp} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note e.g. driver name, vehicle"/>
      </FF>
      <div style={{fontSize:12,color:C.textLight,marginBottom:16}}>A delivery note will print automatically for the selected items.</div>
      <div style={{display:"flex",gap:10}}>
        <Btn primary onClick={()=>onConfirm(job,selected,note)} disabled={selected.length===0}>Confirm Despatch</Btn>
        <Btn ghost onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── JOB TABLE ─────────────────────────────────────────────────────────────────
function JobTable({jobs,onOpen}){
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",background:C.white,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",fontSize:13}}>
        <thead><tr style={{background:C.navy}}>{["Job Ref","Customer","PO Number","Description","Due Date","Status","Priority","Value"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",color:C.silver,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{jobs.map(j=>(
          <tr key={j.id} style={{borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",...(isOverdue(j)?{background:"#fff5f5"}:{})}} onClick={()=>onOpen(j)}>
            <td style={S.td}><Ref>{j.job_ref}</Ref></td>
            <td style={S.td}>{j.customer_name||"—"}</td>
            <td style={{...S.td,color:C.textLight,fontSize:12}}>{j.po_number||"—"}</td>
            <td style={{...S.td,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.description}</td>
            <td style={{...S.td,color:isOverdue(j)?C.danger:C.textMid}}>{fmt(j.due_date)}</td>
            <td style={S.td}><SPill s={j.status}/></td>
            <td style={S.td}><PPill p={j.priority}/></td>
            <td style={{...S.td,fontWeight:700,color:C.navy}}>{fmtGBP(lineTotal(j.lines))}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── JOB DETAIL ────────────────────────────────────────────────────────────────
function JobDetail({job,onEdit,onAdvance,onDelete,onToggleStage,onAddStage,onRemoveStage,onPrint,onDelivery,onPartDelivery,stageInput,setStageInput,allJobs}){
  const allS=job.stages||[];
  const done=allS.filter(s=>job.stages_complete?.[s]).length;
  const next=STATUS_FLOW[STATUS_FLOW.indexOf(job.status)+1];
  const pct=allS.length>0?Math.round((done/allS.length)*100):null;
  const delivered=(job.lines||[]).filter(l=>l.delivered);
  const pending=(job.lines||[]).filter(l=>!l.delivered);
  return(
    <div style={{minWidth:300,maxWidth:640}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div><div style={{fontSize:22,fontWeight:800,color:C.navy,letterSpacing:1,fontFamily:"monospace"}}>{job.job_ref}</div><div style={{color:C.textLight,fontSize:13,marginTop:2}}>Received {fmt(job.date_received)}</div></div>
        <SPill s={job.status} large/>
      </div>
      {isOverdue(job)&&<div style={{background:C.dangerBg,color:C.danger,border:`1px solid ${C.danger}44`,borderRadius:6,padding:"8px 14px",fontSize:13,fontWeight:600,marginBottom:14}}>⚠ Overdue — due {fmt(job.due_date)}</div>}
      {isDueTomorrow(job)&&<div style={{background:C.warnBg,color:C.warn,border:`1px solid ${C.gold}`,borderRadius:6,padding:"8px 14px",fontSize:13,fontWeight:600,marginBottom:14}}>⏰ Due tomorrow</div>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px",marginBottom:12}}>
        {[["Customer",job.customer_name],["Contact",job.contact_name],["PO Number",job.po_number],["Due Date",fmt(job.due_date)],["Priority",<PPill p={job.priority}/>],["Quote Ref",job.quote_ref],["Drawing No",job.drawing_number],["Invoice Ref",job.invoice_ref],["Notes",job.notes]].filter(([,v])=>v).map(([l,v])=>(
          <div key={l} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`}}>
            <span style={{color:C.textLight,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",minWidth:90}}>{l}</span>
            <span style={{color:C.text,fontSize:13,flex:1}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ORDER LINES with delivery status */}
      <div style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:13,color:C.navy,marginBottom:10}}>Order Lines</div>
        {pending.length>0&&<>
          <div style={{fontSize:11,color:C.textLight,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",marginBottom:6}}>Pending</div>
          {pending.map(l=><div key={l.id} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`,fontSize:13,alignItems:"center"}}>
            <span style={{width:14,height:14,border:`2px solid ${C.border}`,borderRadius:3,flexShrink:0,display:"inline-block"}}/>
            <span style={{flex:1}}>{l.desc||"—"}</span>
            <span style={{color:C.textLight,whiteSpace:"nowrap"}}>x{l.qty}</span>
            <span style={{color:C.navy,fontWeight:700,whiteSpace:"nowrap",minWidth:70,textAlign:"right"}}>{fmtGBP(parseFloat(l.qty||1)*parseFloat(l.price||0))}</span>
          </div>)}
        </>}
        {delivered.length>0&&<>
          <div style={{fontSize:11,color:C.success,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",margin:"10px 0 6px"}}>Delivered</div>
          {delivered.map(l=><div key={l.id} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`,fontSize:13,alignItems:"center",opacity:0.7}}>
            <span style={{color:C.success,fontSize:14,flexShrink:0}}>✓</span>
            <span style={{flex:1,textDecoration:"line-through",color:C.textMid}}>{l.desc||"—"}</span>
            <span style={{color:C.textLight,whiteSpace:"nowrap"}}>x{l.qty}</span>
            <span style={{color:C.success,fontSize:11,whiteSpace:"nowrap"}}>Sent {fmt(l.deliveredDate)}</span>
          </div>)}
        </>}
        <div style={{display:"flex",justifyContent:"flex-end",fontWeight:700,fontSize:15,color:C.navy,paddingTop:8}}>Total: {fmtGBP(lineTotal(job.lines))}</div>
      </div>

      {/* STAGES */}
      <div style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:13,color:C.navy,marginBottom:8}}><span>Production Stages</span>{pct!==null&&<span style={{fontSize:12,color:C.textLight}}>{done}/{allS.length}</span>}</div>
        {pct!==null&&<div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden",marginBottom:10}}><div style={{height:"100%",background:C.success,width:`${pct}%`,borderRadius:3,transition:"width .3s"}}/></div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
          {allS.length===0&&<span style={{color:C.textLight,fontSize:13}}>No stages added yet.</span>}
          {allS.map(s=><div key={s} style={{display:"flex",alignItems:"center",gap:6,background:job.stages_complete?.[s]?C.successBg:C.white,border:`1px solid ${job.stages_complete?.[s]?"#90d0a0":C.border}`,borderRadius:20,padding:"4px 11px",cursor:"pointer",fontSize:12,color:job.stages_complete?.[s]?C.success:C.textMid,userSelect:"none"}} onClick={()=>onToggleStage(job,s)}>
            <span>{job.stages_complete?.[s]?"✓":"○"}</span><span>{s}</span>
            <span style={{color:C.border,fontSize:10,cursor:"pointer"}} onClick={e=>{e.stopPropagation();onRemoveStage(job,s);}}>✕</span>
          </div>)}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
          {PRESET_STAGES.filter(s=>!allS.includes(s)).map(s=><button key={s} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontFamily:"inherit",cursor:"pointer",color:C.textMid}} onClick={()=>onAddStage(job,s)}>+ {s}</button>)}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input style={{...S.inp2,flex:1}} placeholder="Custom stage…" value={stageInput} onChange={e=>setStageInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onAddStage(job)}/>
          <Btn small onClick={()=>onAddStage(job)}>Add</Btn>
        </div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {next&&<Btn primary onClick={onAdvance}>→ Move to: {next}</Btn>}
        {pending.length>0&&job.status!=="Quote"&&<Btn onClick={onPartDelivery}>📦 Part Despatch</Btn>}
        <Btn onClick={onEdit}>Edit</Btn>
        <Btn onClick={onPrint}>Print Job Sheet</Btn>
        <Btn onClick={onDelivery}>Delivery Note</Btn>
        <Btn danger onClick={onDelete}>Delete</Btn>
      </div>
      <FileAttachments job={job}/>
    </div>
  );
}

// ── JOB FORM ──────────────────────────────────────────────────────────────────
function JobForm({job,customers,onSave,onCancel,allJobs}){
  const[f,setF]=useState({...job,lines:job.lines&&job.lines.length>0?job.lines:[newLine()]});
  const[lineSearch,setLineSearch]=useState("");
  const[lineSearchResults,setLineSearchResults]=useState([]);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const selCust=customers.find(c=>c.id===f.customer_id);
  const contacts=selCust?.contacts||[];
  function setLine(id,k,v){setF(p=>({...p,lines:p.lines.map(l=>l.id===id?{...l,[k]:v}:l)}));}
  function addLine(){setF(p=>({...p,lines:[...p.lines,newLine()]}));}
  function removeLine(id){setF(p=>({...p,lines:p.lines.filter(l=>l.id!==id)}));}
  const total=lineTotal(f.lines);

  // Line search from previous jobs
  function searchLines(q){
    if(!q.trim()){setLineSearchResults([]);return;}
    const results=[];
    allJobs.forEach(j=>(j.lines||[]).forEach(l=>{
      if(l.desc?.toLowerCase().includes(q.toLowerCase())&&!results.find(r=>r.desc===l.desc))
        results.push({desc:l.desc,price:l.price,jobRef:j.job_ref,customer:j.customer_name});
    }));
    setLineSearchResults(results.slice(0,8));
  }

  function addFromHistory(item){
    setF(p=>({...p,lines:[...p.lines,{...newLine(),desc:item.desc,price:item.price}]}));
    setLineSearch("");setLineSearchResults([]);
  }

  return(
    <div style={{minWidth:300,maxWidth:660}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:16}}>{f.id?"Edit Job":"New Job"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <FF label="Customer" full>
          <select style={S.inp} value={f.customer_id} onChange={e=>{s("customer_id",e.target.value);s("contact_id","");s("contact_name","");}}>
            <option value="">— Select customer —</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FF>
        <FF label="Contact">
          <select style={S.inp} value={f.contact_id} onChange={e=>{const ct=contacts.find(c=>c.id===e.target.value);s("contact_id",e.target.value);s("contact_name",ct?.name||"");}} disabled={!f.customer_id}>
            <option value="">— Select contact —</option>
            {contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FF>
        <FF label="PO Number"><input style={S.inp} value={f.po_number} onChange={e=>s("po_number",e.target.value)} placeholder="e.g. PO-1234"/></FF>
        <FF label="Status"><select style={S.inp} value={f.status} onChange={e=>s("status",e.target.value)}>{STATUS_FLOW.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Priority"><select style={S.inp} value={f.priority} onChange={e=>s("priority",e.target.value)}>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Date Received"><input type="date" style={S.inp} value={f.date_received} onChange={e=>s("date_received",e.target.value)}/></FF>
        <FF label="Due Date"><input type="date" style={S.inp} value={f.due_date} onChange={e=>s("due_date",e.target.value)}/></FF>
        <FF label="Quote Reference"><input style={S.inp} value={f.quote_ref} onChange={e=>s("quote_ref",e.target.value)}/></FF>
        <FF label="Quote Status"><select style={S.inp} value={f.quote_status} onChange={e=>s("quote_status",e.target.value)}>{QUOTE_STATUSES.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Drawing Number"><input style={S.inp} value={f.drawing_number} onChange={e=>s("drawing_number",e.target.value)} placeholder="e.g. DWG-001"/></FF>
        <FF label="Drawing Attached?">
          <select style={S.inp} value={f.drawing_attached?"yes":"no"} onChange={e=>s("drawing_attached",e.target.value==="yes")}>
            <option value="no">No</option><option value="yes">Yes</option>
          </select>
        </FF>
        <FF label="Invoice Reference"><input style={S.inp} value={f.invoice_ref} onChange={e=>s("invoice_ref",e.target.value)}/></FF>
        <FF label="Description" full><input style={S.inp} value={f.description} onChange={e=>s("description",e.target.value)} placeholder="Brief job description"/></FF>
        <FF label="Notes" full><textarea style={{...S.inp,minHeight:56}} value={f.notes} onChange={e=>s("notes",e.target.value)}/></FF>
      </div>

      {/* ORDER LINES */}
      <div style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:13,color:C.navy,marginBottom:10}}>Order Lines</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 60px 80px 24px",gap:6,marginBottom:6}}>
          {["Description","Qty","Unit £",""].map(h=><div key={h} style={{fontSize:11,color:C.textLight,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>{h}</div>)}
        </div>
        {f.lines.map(l=>(
          <div key={l.id} style={{marginBottom:6}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 60px 80px 24px",gap:6,alignItems:"center"}}>
              <input style={S.inp} value={l.desc} onChange={e=>{setLine(l.id,"desc",e.target.value);searchLines(e.target.value);}} placeholder="Item description" onFocus={()=>searchLines(l.desc)}/>
              <input style={{...S.inp,textAlign:"center"}} type="number" value={l.qty} onChange={e=>setLine(l.id,"qty",e.target.value)} min="1"/>
              <input style={{...S.inp,textAlign:"right"}} type="number" value={l.price} onChange={e=>setLine(l.id,"price",e.target.value)} placeholder="0.00"/>
              <button style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,cursor:"pointer",color:C.danger,fontSize:14,lineHeight:1,padding:"4px 6px"}} onClick={()=>removeLine(l.id)}>✕</button>
            </div>
            {/* Price history hint */}
            {lineSearchResults.length>0&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:6,marginTop:4,overflow:"hidden",boxShadow:"0 4px 12px #0002"}}>
                <div style={{fontSize:11,color:C.textLight,padding:"4px 10px",borderBottom:`1px solid ${C.borderLight}`,fontWeight:700,letterSpacing:0.4}}>PREVIOUS PRICES — click to use</div>
                {lineSearchResults.map((r,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",fontSize:12}} onClick={()=>{setLine(l.id,"desc",r.desc);setLine(l.id,"price",r.price);setLineSearchResults([]);}}>
                    <span style={{flex:1,color:C.text}}>{r.desc}</span>
                    <span style={{color:C.navy,fontWeight:700}}>{fmtGBP(r.price)}</span>
                    <span style={{color:C.textLight,fontSize:11}}>{r.jobRef} · {r.customer}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Search previous products */}
        <div style={{marginTop:10,marginBottom:10}}>
          <div style={{fontSize:11,color:C.textLight,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",marginBottom:6}}>Add from previous orders</div>
          <div style={{position:"relative"}}>
            <input style={{...S.inp,paddingRight:32}} value={lineSearch} onChange={e=>{setLineSearch(e.target.value);searchLines(e.target.value);}} placeholder="Search previous line items to add…"/>
            {lineSearch&&<button style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.textLight,fontSize:16}} onClick={()=>{setLineSearch("");setLineSearchResults([]);}}>✕</button>}
          </div>
          {lineSearchResults.length>0&&lineSearch&&(
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:6,marginTop:4,overflow:"hidden"}}>
              {lineSearchResults.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",fontSize:13}} onClick={()=>addFromHistory(r)}>
                  <span style={{flex:1}}>{r.desc}</span>
                  <span style={{color:C.navy,fontWeight:700}}>{fmtGBP(r.price)}</span>
                  <span style={{color:C.textLight,fontSize:11}}>{r.jobRef}</span>
                  <span style={{color:C.accent,fontSize:11,fontWeight:600}}>+ Add</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
          <button style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 12px",fontFamily:"inherit",fontSize:12,cursor:"pointer",color:C.accent}} onClick={addLine}>+ Add Blank Line</button>
          <div style={{fontWeight:700,fontSize:15,color:C.navy}}>Total: {fmtGBP(total)}</div>
        </div>
      </div>

      <div style={{display:"flex",gap:10}}>
        <Btn primary onClick={()=>onSave(f)}>Save Job</Btn>
        <Btn ghost onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── CUSTOMER FORM ─────────────────────────────────────────────────────────────
function CustForm({cust,onSave,onCancel}){
  const[f,setF]=useState({...cust,contacts:cust.contacts&&cust.contacts.length>0?cust.contacts:[{id:"ct"+Date.now(),name:"",email:"",phone:""}]});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  function setCt(id,k,v){setF(p=>({...p,contacts:p.contacts.map(c=>c.id===id?{...c,[k]:v}:c)}));}
  function addCt(){setF(p=>({...p,contacts:[...p.contacts,{id:"ct"+Date.now(),name:"",email:"",phone:""}]}));}
  function removeCt(id){setF(p=>({...p,contacts:p.contacts.filter(c=>c.id!==id)}));}
  return(
    <div style={{minWidth:300,maxWidth:500}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:16}}>{f.id?"Edit Customer":"New Customer"}</div>
      <FF label="Company Name"><input style={S.inp} value={f.name} onChange={e=>s("name",e.target.value)}/></FF>
      <FF label="Notes"><input style={S.inp} value={f.notes} onChange={e=>s("notes",e.target.value)}/></FF>
      <div style={{fontWeight:700,fontSize:13,color:C.navy,margin:"14px 0 8px"}}>Contacts</div>
      {f.contacts.map((ct,i)=>(
        <div key={ct.id} style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:C.textMid}}>Contact {i+1}</span>
            {f.contacts.length>1&&<button style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:12}} onClick={()=>removeCt(ct.id)}>Remove</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <FF label="Name"><input style={S.inp} value={ct.name} onChange={e=>setCt(ct.id,"name",e.target.value)}/></FF>
            <FF label="Email"><input style={S.inp} value={ct.email} onChange={e=>setCt(ct.id,"email",e.target.value)}/></FF>
            <FF label="Phone"><input style={S.inp} value={ct.phone} onChange={e=>setCt(ct.id,"phone",e.target.value)}/></FF>
          </div>
        </div>
      ))}
      <button style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 12px",fontFamily:"inherit",fontSize:12,cursor:"pointer",color:C.accent,marginBottom:16}} onClick={addCt}>+ Add Another Contact</button>
      <div style={{display:"flex",gap:10}}><Btn primary onClick={()=>onSave(f)}>Save</Btn><Btn ghost onClick={onCancel}>Cancel</Btn></div>
    </div>
  );
}

// ── MONDAY REPORT ─────────────────────────────────────────────────────────────
function MondayReport({jobs,onClose}){
  useEffect(()=>{const t=setTimeout(()=>window.print(),400);return()=>clearTimeout(t);},[]);
  return(
    <div style={{background:"#fff",minHeight:"100vh",padding:32,fontFamily:"Arial,sans-serif",color:"#000"}}>
      <button onClick={onClose} style={{marginBottom:20,background:"#0f2a4a",color:"#fff",border:"none",padding:"8px 18px",cursor:"pointer",borderRadius:4}} className="no-print">← Back</button>
      <div style={{borderBottom:"3px solid #c9a84c",paddingBottom:16,marginBottom:20,display:"flex",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:"#0f2a4a"}}>{COMPANY}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>{COMPANY_ADDR} · {COMPANY_TEL}</div>
          <div style={{fontSize:13,fontWeight:600,color:"#666",marginTop:4}}>Monday Morning Production Report</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:13,color:"#666"}}>{fmt(todayStr())}</div>
          <div style={{fontSize:13,color:"#666",marginTop:2}}>{jobs.length} jobs in production</div>
        </div>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#0f2a4a",color:"#fff"}}>{["Job Ref","Customer","PO Number","Description","Due Date","Value","Priority"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left"}}>{h}</th>)}</tr></thead>
        <tbody>{jobs.map(j=><tr key={j.id} style={{borderBottom:"1px solid #eee",...(isOverdue(j)?{background:"#fff5f5"}:{})}}><td style={{padding:"8px 12px",fontWeight:600}}>{j.job_ref}</td><td style={{padding:"8px 12px"}}>{j.customer_name}</td><td style={{padding:"8px 12px",color:"#666"}}>{j.po_number||"—"}</td><td style={{padding:"8px 12px"}}>{j.description}</td><td style={{padding:"8px 12px",color:isOverdue(j)?"#b83030":"#333",fontWeight:isOverdue(j)?700:400}}>{fmt(j.due_date)}</td><td style={{padding:"8px 12px",fontWeight:600}}>{fmtGBP(lineTotal(j.lines))}</td><td style={{padding:"8px 12px"}}>{j.priority}</td></tr>)}</tbody>
      </table>
      <div style={{marginTop:16,fontWeight:700,textAlign:"right",fontSize:13}}>Total: {fmtGBP(jobs.reduce((a,j)=>a+lineTotal(j.lines),0))}</div>
      <div style={{marginTop:40,fontSize:10,color:"#bbb",borderTop:"1px solid #eee",paddingTop:10}}>{COMPANY} · {COMPANY_ADDR} · {COMPANY_TEL} · {VERSION}</div>
    </div>
  );
}

// ── PRINT JOB SHEET ───────────────────────────────────────────────────────────
function PrintSheet({job,onClose}){
  useEffect(()=>{const t=setTimeout(()=>window.print(),400);return()=>clearTimeout(t);},[]);
  return(
    <div style={{background:"#fff",minHeight:"100vh",padding:32,fontFamily:"Arial,sans-serif",color:"#000"}}>
      <button onClick={onClose} style={{marginBottom:20,background:"#0f2a4a",color:"#fff",border:"none",padding:"8px 18px",cursor:"pointer",borderRadius:4}} className="no-print">← Back</button>
      <div style={{borderBottom:"3px solid #0f2a4a",paddingBottom:16,marginBottom:20,display:"flex",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:"#0f2a4a"}}>{COMPANY}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>{COMPANY_ADDR}</div>
          <div style={{fontSize:11,color:"#666"}}>{COMPANY_TEL} · {COMPANY_EMAIL}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>Job Sheet</div>
        </div>
        <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:700}}>{job.job_ref}</div><div style={{fontSize:11,color:"#666"}}>Printed {fmt(todayStr())}</div></div>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20,fontSize:12}}>
        <tbody>{[["Customer",job.customer_name],["Contact",job.contact_name],["PO Number",job.po_number],["Due Date",fmt(job.due_date)],["Drawing No",job.drawing_number],["Drawing Attached",job.drawing_attached?"Yes":"No"],["Status",job.status],["Notes",job.notes]].filter(([,v])=>v).map(([l,v])=><tr key={l}><td style={{padding:"6px 10px",border:"1px solid #ddd",background:"#f7f7f7",fontWeight:600,width:130}}>{l}</td><td style={{padding:"6px 10px",border:"1px solid #ddd"}}>{v}</td></tr>)}</tbody>
      </table>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#0f2a4a"}}>Order Lines</div>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20,fontSize:12}}>
        <thead><tr style={{background:"#0f2a4a",color:"#fff"}}><th style={{padding:"6px 10px",textAlign:"left"}}>Description</th><th style={{padding:"6px 10px",textAlign:"center"}}>Qty</th><th style={{padding:"6px 10px",textAlign:"right"}}>Unit Price</th><th style={{padding:"6px 10px",textAlign:"right"}}>Total</th></tr></thead>
        <tbody>
          {(job.lines||[]).map(l=><tr key={l.id} style={{borderBottom:"1px solid #eee",...(l.delivered?{opacity:0.5}:{})}}><td style={{padding:"6px 10px"}}>{l.desc}{l.delivered?` ✓ Delivered ${fmt(l.deliveredDate)}`:""}</td><td style={{padding:"6px 10px",textAlign:"center"}}>{l.qty}</td><td style={{padding:"6px 10px",textAlign:"right"}}>{fmtGBP(l.price)}</td><td style={{padding:"6px 10px",textAlign:"right",fontWeight:600}}>{fmtGBP(parseFloat(l.qty||1)*parseFloat(l.price||0))}</td></tr>)}
          <tr><td colSpan="3" style={{padding:"8px 10px",textAlign:"right",fontWeight:700}}>TOTAL</td><td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,fontSize:14}}>{fmtGBP(lineTotal(job.lines))}</td></tr>
        </tbody>
      </table>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#0f2a4a"}}>Production Stages</div>
      {(job.stages||[]).map(s=><div key={s} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid #eee"}}><div style={{width:20,height:20,border:"2px solid #0f2a4a",borderRadius:3,background:job.stages_complete?.[s]?"#0f2a4a":"#fff",flexShrink:0}}/><span style={{fontSize:13}}>{s}</span><span style={{marginLeft:"auto",fontSize:11,color:"#999"}}>By: ________________ Date: ___________</span></div>)}
      <div style={{marginTop:36,fontSize:11,color:"#999",borderTop:"1px solid #ddd",paddingTop:10}}>{COMPANY} · {COMPANY_ADDR} · Job Sheet {job.job_ref} · {VERSION}</div>
    </div>
  );
}

// ── DELIVERY NOTE ─────────────────────────────────────────────────────────────
function DeliveryNote({job,onClose}){
  useEffect(()=>{const t=setTimeout(()=>window.print(),400);return()=>clearTimeout(t);},[]);
  const linesToShow=(job.lines||[]).filter(l=>!l.delivered||(job._partLines&&job._partLines.includes(l.id)));
  return(
    <div style={{background:"#fff",minHeight:"100vh",padding:32,fontFamily:"Arial,sans-serif",color:"#000"}}>
      <button onClick={onClose} style={{marginBottom:20,background:"#0f2a4a",color:"#fff",border:"none",padding:"8px 18px",cursor:"pointer",borderRadius:4}} className="no-print">← Back</button>
      <div style={{borderBottom:"3px solid #c9a84c",paddingBottom:16,marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:"#0f2a4a"}}>{COMPANY}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>{COMPANY_ADDR}</div>
          <div style={{fontSize:11,color:"#666"}}>{COMPANY_TEL} · {COMPANY_EMAIL}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:11,color:"#888",letterSpacing:1,textTransform:"uppercase"}}>Delivery Note</div>
          <div style={{fontSize:22,fontWeight:700,color:"#0f2a4a"}}>{job.job_ref}</div>
          <div style={{fontSize:11,color:"#666"}}>Date: {fmt(todayStr())}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginBottom:24}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Deliver To</div>
          <div style={{fontSize:14,fontWeight:700}}>{job.customer_name}</div>
          <div style={{fontSize:13,color:"#444",marginTop:2}}>{job.contact_name}</div>
        </div>
        <div>
          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
            <tbody>{[["Job Ref",job.job_ref],["PO Number",job.po_number||"—"],["Drawing No",job.drawing_number||"—"],["Drawing Attached",job.drawing_attached?"Yes":"No"]].map(([l,v])=><tr key={l}><td style={{padding:"3px 8px",background:"#f5f5f5",fontWeight:600,width:110}}>{l}</td><td style={{padding:"3px 8px",borderBottom:"1px solid #eee"}}>{v}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#0f2a4a"}}>Items Supplied</div>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:24,fontSize:12}}>
        <thead><tr style={{background:"#0f2a4a",color:"#fff"}}><th style={{padding:"7px 10px",textAlign:"left"}}>Description</th><th style={{padding:"7px 10px",textAlign:"center",width:60}}>Qty</th><th style={{padding:"7px 10px",textAlign:"center",width:80}}>Received OK</th></tr></thead>
        <tbody>{(job.lines||[]).map(l=><tr key={l.id} style={{borderBottom:"1px solid #eee"}}><td style={{padding:"8px 10px"}}>{l.desc}</td><td style={{padding:"8px 10px",textAlign:"center"}}>{l.qty}</td><td style={{padding:"8px 10px",textAlign:"center"}}>☐</td></tr>)}</tbody>
      </table>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:32,marginTop:40}}>
        <div><div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:20}}>Received by (Customer)</div><div style={{borderBottom:"1px solid #000",marginBottom:6,height:32}}/><div style={{fontSize:11,color:"#888"}}>Name: ________________________________</div><div style={{fontSize:11,color:"#888",marginTop:6}}>Date: ________________________________</div></div>
        <div><div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:20}}>Despatched by (Riverside)</div><div style={{borderBottom:"1px solid #000",marginBottom:6,height:32}}/><div style={{fontSize:11,color:"#888"}}>Name: ________________________________</div><div style={{fontSize:11,color:"#888",marginTop:6}}>Date: ________________________________</div></div>
      </div>
      <div style={{marginTop:40,fontSize:10,color:"#bbb",borderTop:"1px solid #eee",paddingTop:10,textAlign:"center"}}>{COMPANY} · {COMPANY_ADDR} · {COMPANY_TEL} · Delivery Note {job.job_ref} · {VERSION}</div>
    </div>
  );
}


// ── FILE ATTACHMENTS ──────────────────────────────────────────────────────────
function FileAttachments({job}){
  const[files,setFiles]=useState([]);
  const[uploading,setUploading]=useState(false);
  const[dragOver,setDragOver]=useState(false);
  const[category,setCategory]=useState("Other");
  const cats=["Drawing","Purchase Order","Email / Correspondence","Other"];

  useEffect(()=>{if(job.id)loadFiles();},[job.id]);

  async function loadFiles(){
    const{data}=await supabase.from("job_files").select("*").eq("job_id",job.id).order("uploaded_at",{ascending:false});
    if(data)setFiles(data);
  }

  async function uploadFile(file){
    if(!file)return;
    setUploading(true);
    const path=`${job.id}/${Date.now()}_${file.name}`;
    const{error:upErr}=await supabase.storage.from("job-files").upload(path,file);
    if(upErr){alert("Upload failed: "+upErr.message);setUploading(false);return;}
    await supabase.from("job_files").insert([{job_id:job.id,job_ref:job.job_ref,file_name:file.name,file_path:path,file_type:file.type,category}]);
    await loadFiles();
    setUploading(false);
  }

  async function deleteFile(f){
    await supabase.storage.from("job-files").remove([f.file_path]);
    await supabase.from("job_files").delete().eq("id",f.id);
    await loadFiles();
  }

  async function openFile(f){
    const{data}=await supabase.storage.from("job-files").createSignedUrl(f.file_path,3600);
    if(data?.signedUrl)window.open(data.signedUrl,"_blank");
  }

  function onDrop(e){
    e.preventDefault();setDragOver(false);
    const file=e.dataTransfer.files[0];
    if(file)uploadFile(file);
  }

  function catIcon(cat){
    if(cat==="Drawing")return"📐";
    if(cat==="Purchase Order")return"📄";
    if(cat==="Email / Correspondence")return"✉️";
    return"📎";
  }

  return(
    <div style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:14}}>
      <div style={{fontWeight:700,fontSize:13,color:C.navy,marginBottom:10}}>Attached Files</div>
      {/* Category selector */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {cats.map(c=><button key={c} style={{background:category===c?C.navy:C.white,color:category===c?C.white:C.textMid,border:`1px solid ${category===c?C.navy:C.border}`,borderRadius:20,padding:"3px 10px",fontFamily:"inherit",fontSize:11,cursor:"pointer",fontWeight:600}} onClick={()=>setCategory(c)}>{c}</button>)}
      </div>
      {/* Drop zone */}
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={onDrop}
        style={{border:`2px dashed ${dragOver?C.accent:C.border}`,borderRadius:8,padding:"16px 12px",textAlign:"center",background:dragOver?"#e8f0fb":C.white,marginBottom:10,cursor:"pointer",transition:"all .2s"}}
        onClick={()=>document.getElementById("file-upload-"+job.id).click()}
      >
        <input id={"file-upload-"+job.id} type="file" style={{display:"none"}} onChange={e=>uploadFile(e.target.files[0])} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.eml,.msg"/>
        {uploading
          ?<div style={{color:C.textLight,fontSize:13}}>Uploading…</div>
          :<div style={{color:C.textLight,fontSize:13}}>📎 Drag a file here or click to browse<br/><span style={{fontSize:11,marginTop:4,display:"block"}}>PDF, image, Word, Excel, email — will be saved as: {category}</span></div>
        }
      </div>
      {/* File list */}
      {files.length===0&&<div style={{color:C.textLight,fontSize:13}}>No files attached yet.</div>}
      {files.map(f=>(
        <div key={f.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.borderLight}`}}>
          <span style={{fontSize:18,flexShrink:0}}>{catIcon(f.category)}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}} onClick={()=>openFile(f)}>{f.file_name}</div>
            <div style={{fontSize:11,color:C.textLight}}>{f.category} · {f.uploaded_at?new Date(f.uploaded_at).toLocaleDateString("en-GB"):""}</div>
          </div>
          <button style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 8px",cursor:"pointer",color:C.accent,fontSize:11,fontFamily:"inherit"}} onClick={()=>openFile(f)}>Open</button>
          <button style={{background:"none",border:`1px solid ${C.danger}44`,borderRadius:4,padding:"3px 8px",cursor:"pointer",color:C.danger,fontSize:11,fontFamily:"inherit"}} onClick={()=>deleteFile(f)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

// ── SMALL COMPONENTS ──────────────────────────────────────────────────────────
function SPill({s,large}){const sc=SC[s]||SC["Invoiced"];return<span style={{background:sc.bg,color:sc.color,border:`1px solid ${sc.border}`,borderRadius:20,padding:large?"5px 14px":"3px 10px",fontSize:large?13:11,fontWeight:600,whiteSpace:"nowrap"}}>{s}</span>;}
function PPill({p}){const cols={Urgent:{bg:"#fce8e8",color:"#8b0000",border:"#f5b0b0"},High:{bg:C.warnBg,color:C.warn,border:"#f5c060"},Normal:{bg:C.silverPale,color:C.textMid,border:C.border},Low:{bg:C.successBg,color:C.success,border:"#90d0a0"}};const c=cols[p]||cols.Normal;return<span style={{background:c.bg,color:c.color,border:`1px solid ${c.border}`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>{p||"Normal"}</span>;}
function Ref({children}){return<span style={{background:"#e8f0fb",color:C.navy,border:`1px solid #b0c8e8`,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:0.5,fontFamily:"monospace",whiteSpace:"nowrap"}}>{children}</span>;}
function Tag({children,color}){return<span style={{background:color?`${color}18`:C.silverLight,color:color||C.textMid,border:`1px solid ${color?`${color}44`:C.border}`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:500}}>{children}</span>;}
function Em({children,center}){return<div style={{color:C.textLight,fontSize:13,padding:center?"30px 0":"8px 0",textAlign:center?"center":undefined}}>{children}</div>;}
function ACard({title,count,color,children}){return<div style={{background:C.white,border:`1px solid ${C.border}`,borderLeft:`4px solid ${color}`,borderRadius:8,padding:16}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><span style={{fontWeight:700,fontSize:13,color:C.text}}>{title}</span><span style={{background:count>0?`${color}18`:C.silverPale,color:count>0?color:C.textLight,border:`1px solid ${count>0?`${color}44`:C.border}`,borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:700}}>{count}</span></div>{children}</div>;}
function ARow({job,onClick,children}){return<div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer"}} onClick={onClick}><Ref>{job.job_ref}</Ref><span style={{fontSize:13,color:C.textMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.customer_name}</span>{children}</div>;}
function ALarge({job,onClick,extra}){return<div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",flexWrap:"wrap"}} onClick={onClick}><Ref>{job.job_ref}</Ref><span style={{fontSize:13,color:C.text,flex:1,minWidth:100}}>{job.description}</span><span style={{fontSize:12,color:C.textLight}}>{job.customer_name}</span><SPill s={job.status}/><span style={{fontSize:12,color:C.textMid}}>Due {fmt(job.due_date)}</span>{extra&&<span style={{fontSize:13,fontWeight:700,color:C.navy}}>{extra}</span>}</div>;}
function Btn({children,onClick,primary,ghost,danger,small,disabled}){const base={border:"none",borderRadius:5,fontFamily:"inherit",fontWeight:600,cursor:disabled?"not-allowed":"pointer",padding:small?"5px 12px":"8px 16px",fontSize:small?12:13,letterSpacing:0.2,opacity:disabled?0.5:1};const v=primary?{background:C.navy,color:"#fff"}:danger?{background:C.dangerBg,color:C.danger,border:`1px solid ${C.danger}40`}:ghost?{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`}:{background:C.silverLight,color:C.navy,border:`1px solid ${C.border}`};return<button style={{...base,...v}} onClick={disabled?undefined:onClick}>{children}</button>;}
function Overlay({children,onClose}){return<div style={{position:"fixed",inset:0,background:"#00000066",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}} onClick={onClose}><div style={{background:C.white,border:`1px solid ${C.border}`,borderTop:`4px solid ${C.navy}`,borderRadius:10,padding:28,maxWidth:700,width:"100%",position:"relative",boxShadow:"0 8px 40px #0003",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}><button style={{position:"absolute",top:12,right:14,background:"none",border:"none",color:C.textLight,fontSize:17,cursor:"pointer"}} onClick={onClose}>✕</button>{children}</div></div>;}
function FF({label,children,full}){return<div style={{marginBottom:12,gridColumn:full?"1 / -1":undefined}}><label style={{display:"block",color:C.textLight,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:4}}>{label}</label>{children}</div>;}
function Logo(){return<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect width="36" height="36" rx="6" fill={C.navyMid}/><path d="M7 22 L18 10 L29 22" stroke={C.silver} strokeWidth="2.5" fill="none" strokeLinejoin="round"/><rect x="14" y="22" width="8" height="7" fill={C.gold} rx="1"/><line x1="18" y1="22" x2="18" y2="29" stroke={C.navyMid} strokeWidth="1.5"/></svg>;}

const S={
  pageH:{fontSize:20,fontWeight:700,color:C.navy,margin:"0 0 20px",letterSpacing:0.3},
  subH:{fontSize:14,fontWeight:700,color:C.textMid,margin:"24px 0 12px",letterSpacing:0.5,textTransform:"uppercase",borderTop:`1px solid ${C.border}`,paddingTop:20},
  inp:{width:"100%",background:C.white,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:13,color:C.text,outline:"none",boxSizing:"border-box"},
  inp2:{background:C.white,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 12px",fontFamily:"inherit",fontSize:13,color:C.text,outline:"none",flex:1,minWidth:200},
  td:{padding:"10px 14px",color:C.text},
  iconBtn:{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 10px",cursor:"pointer",color:C.textMid,fontSize:12,fontFamily:"inherit",whiteSpace:"nowrap"},
};
