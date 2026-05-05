import { useState, useEffect, useMemo } from "react";

const COMPANY = "Riverside Sheet Metal & Fabrication";
const COMPANY_SHORT = "RIVERSIDE";
const VERSION = "v1.0";
const STATUS_FLOW = ["Quote", "In Production", "Ready to Despatch", "Despatched", "Invoiced"];
const PRESET_STAGES = ["Cutting", "Welding", "Bending / Forming", "Punching", "Rolling", "Grinding", "Powder Coat", "Painting", "Assembly", "QC Check"];
const PRIORITIES = ["Normal", "High", "Urgent", "Low"];
const QUOTE_STATUSES = ["Pending", "Approved", "Rejected", "N/A"];

const C = {
  navy:"#0f2a4a",navyMid:"#1a3f6f",navyLight:"#234e86",
  silver:"#c8d0dc",silverLight:"#e8ecf1",silverPale:"#f4f6f9",
  white:"#ffffff",accent:"#1e5faa",gold:"#c9a84c",
  success:"#1a7a4a",successBg:"#e8f5ee",
  danger:"#b83030",dangerBg:"#fceaea",
  warn:"#b86a10",warnBg:"#fef3e2",
  text:"#0f1e30",textMid:"#3a4f66",textLight:"#6a7f99",
  border:"#d0d8e4",borderLight:"#e8ecf2",
};

const SC = {
  "Quote":             {bg:"#e8ecf8",color:"#1a3a8a",border:"#b0bce8"},
  "In Production":     {bg:"#fef3e2",color:"#7a4500",border:"#f5c060"},
  "Ready to Despatch": {bg:"#e8f5ee",color:"#0f5a30",border:"#6ecf9a"},
  "Despatched":        {bg:"#e6f0fb",color:"#0c3870",border:"#70a8e0"},
  "Invoiced":          {bg:"#f0f0f0",color:"#555",border:"#ccc"},
};

function genRef(p="JOB"){return `${p}-${String(Date.now()).slice(-6)}`;}
function todayStr(){return new Date().toISOString().split("T")[0];}
function fmt(d){if(!d)return"—";const[y,m,day]=d.split("-");return`${day}/${m}/${y}`;}
function isOverdue(j){if(!j.dueDate||j.status==="Invoiced")return false;return new Date(j.dueDate)<new Date(todayStr());}
function sg(k,def){try{return JSON.parse(localStorage.getItem(k))??def;}catch{return def;}}
function ss(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

const DC=[
  {id:"C001",name:"Acme Engineering Ltd",contact:"John Smith",email:"j.smith@acme.co.uk",phone:"01234 567890",notes:""},
  {id:"C002",name:"Riverside Construction",contact:"Sarah Jones",email:"sarah@riverside.co.uk",phone:"07712 345678",notes:""},
  {id:"C003",name:"Midland Steelworks",contact:"Dave Patel",email:"d.patel@midsteel.com",phone:"01782 334455",notes:"Net 30 terms"},
];
const DJ=[
  {id:"J001",jobRef:"JOB-001",customerId:"C001",customerName:"Acme Engineering Ltd",description:"Fabricate 4x mild steel brackets, 5mm plate, drilled and tapped M10",status:"In Production",priority:"High",quoteRef:"QTE-001",quoteValue:"480",quoteStatus:"Approved",stages:["Cutting","Welding","QC Check"],stagesComplete:{Cutting:true},dateReceived:"2026-04-28",dueDate:"2026-05-08",despatchDate:"",invoiceRef:"",notes:"Drawing ref: AE-4421"},
  {id:"J002",jobRef:"JOB-002",customerId:"C002",customerName:"Riverside Construction",description:"3x 2400x1200 perforated panels, 2mm stainless, 6mm holes",status:"Ready to Despatch",priority:"Normal",quoteRef:"QTE-002",quoteValue:"1240",quoteStatus:"Approved",stages:["Cutting","Punching","Grinding","QC Check"],stagesComplete:{Cutting:true,Punching:true,Grinding:true,"QC Check":true},dateReceived:"2026-04-20",dueDate:"2026-05-05",despatchDate:"",invoiceRef:"",notes:""},
  {id:"J003",jobRef:"JOB-003",customerId:"C003",customerName:"Midland Steelworks",description:"Repair and re-weld 6x hopper brackets, site delivery required",status:"Despatched",priority:"Normal",quoteRef:"QTE-003",quoteValue:"320",quoteStatus:"Approved",stages:["Welding","Grinding","QC Check"],stagesComplete:{Welding:true,Grinding:true,"QC Check":true},dateReceived:"2026-04-15",dueDate:"2026-04-30",despatchDate:"2026-05-01",invoiceRef:"",notes:""},
  {id:"J004",jobRef:"JOB-004",customerId:"C001",customerName:"Acme Engineering Ltd",description:"Quote for full enclosure fabrication, 3mm mild steel, powder coated RAL 7016",status:"Quote",priority:"Normal",quoteRef:"QTE-004",quoteValue:"2800",quoteStatus:"Pending",stages:[],stagesComplete:{},dateReceived:"2026-05-01",dueDate:"2026-05-12",despatchDate:"",invoiceRef:"",notes:"Awaiting customer approval"},
];

const EMPTY_JOB={id:"",jobRef:"",customerId:"",customerName:"",description:"",quoteRef:"",quoteValue:"",quoteStatus:"N/A",status:"In Production",priority:"Normal",stages:[],stagesComplete:{},dateReceived:todayStr(),dueDate:"",despatchDate:"",invoiceRef:"",notes:""};
const EMPTY_CUST={id:"",name:"",contact:"",email:"",phone:"",notes:""};

export default function App(){
  const[jobs,setJobs]=useState(()=>sg("rsm_jobs",DJ));
  const[customers,setCustomers]=useState(()=>sg("rsm_custs",DC));
  const[view,setView]=useState("dashboard");
  const[jobModal,setJobModal]=useState(null);
  const[editJob,setEditJob]=useState(null);
  const[editCust,setEditCust]=useState(null);
  const[filterStatus,setFilterStatus]=useState("All");
  const[search,setSearch]=useState("");
  const[toast,setToast]=useState(null);
  const[printJob,setPrintJob]=useState(null);
  const[stageInput,setStageInput]=useState("");
  const[confirmDel,setConfirmDel]=useState(null);

  useEffect(()=>ss("rsm_jobs",jobs),[jobs]);
  useEffect(()=>ss("rsm_custs",customers),[customers]);

  function toast_(msg,type="ok"){setToast({msg,type});setTimeout(()=>setToast(null),3000);}

  function saveJob(j){
    const isNew=!j.id;
    const saved=isNew?{...j,id:genRef("J"),jobRef:j.jobRef||genRef("JOB")}:j;
    setJobs(p=>isNew?[saved,...p]:p.map(x=>x.id===saved.id?saved:x));
    toast_(isNew?`Job ${saved.jobRef} created`:`Job ${saved.jobRef} saved`);
    setEditJob(null);
  }

  function deleteJob(id){
    setJobs(p=>p.filter(j=>j.id!==id));
    setJobModal(null);setConfirmDel(null);
    toast_("Job deleted","warn");
  }

  function advanceJob(job){
    const idx=STATUS_FLOW.indexOf(job.status);
    if(idx>=STATUS_FLOW.length-1)return;
    const next=STATUS_FLOW[idx+1];
    const updated={...job,status:next,...(next==="Despatched"?{despatchDate:todayStr()}:{})};
    setJobs(p=>p.map(j=>j.id===job.id?updated:j));
    setJobModal(updated);
    toast_(`Moved to: ${next}`);
  }

  function toggleStage(job,stage){
    const u={...job,stagesComplete:{...job.stagesComplete,[stage]:!job.stagesComplete[stage]}};
    setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);
  }

  function addStage(job,s){
    const stage=(s||stageInput).trim();
    if(!stage||job.stages.includes(stage))return;
    const u={...job,stages:[...job.stages,stage]};
    setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);setStageInput("");
  }

  function removeStage(job,stage){
    const sc={...job.stagesComplete};delete sc[stage];
    const u={...job,stages:job.stages.filter(s=>s!==stage),stagesComplete:sc};
    setJobs(p=>p.map(j=>j.id===job.id?u:j));setJobModal(u);
  }

  function saveCust(c){
    const isNew=!c.id;
    const saved=isNew?{...c,id:genRef("C")}:c;
    setCustomers(p=>isNew?[...p,saved]:p.map(x=>x.id===saved.id?saved:x));
    toast_(isNew?`${saved.name} added`:`${saved.name} updated`);
    setEditCust(null);
  }

  function exportCSV(jobList){
    const hdr=["Job Ref","Customer","Description","Status","Priority","Received","Due","Despatched","Quote Ref","Quote Value","Invoice Ref","Notes"];
    const rows=jobList.map(j=>[j.jobRef,j.customerName,j.description,j.status,j.priority,fmt(j.dateReceived),fmt(j.dueDate),fmt(j.despatchDate),j.quoteRef,j.quoteValue?`£${j.quoteValue}`:"",j.invoiceRef,j.notes]);
    const csv=[hdr,...rows].map(r=>r.map(c=>`"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download=`riverside_jobs_${todayStr()}.csv`;a.click();
    toast_("CSV exported — import into QuickBooks");
  }

  const uninvoiced=jobs.filter(j=>j.status==="Despatched");
  const overdue=jobs.filter(j=>isOverdue(j));
  const counts=STATUS_FLOW.reduce((a,s)=>({...a,[s]:jobs.filter(j=>j.status===s).length}),{});
  const pipeline=jobs.filter(j=>j.quoteValue&&j.status!=="Invoiced").reduce((a,j)=>a+parseFloat(j.quoteValue||0),0);

  const filtered=useMemo(()=>jobs.filter(j=>{
    const ms=filterStatus==="All"||j.status===filterStatus;
    const q=search.toLowerCase();
    const mq=!q||[j.jobRef,j.customerName,j.description,j.quoteRef].some(f=>f?.toLowerCase().includes(q));
    return ms&&mq;
  }),[jobs,filterStatus,search]);

  if(printJob)return<PrintSheet job={printJob} onClose={()=>setPrintJob(null)}/>;

  return(
    <div style={S.app}>
      {toast&&<div style={{...S.toast,background:toast.type==="warn"?C.danger:C.success}}>{toast.msg}</div>}

      {confirmDel&&(
        <Overlay onClose={()=>setConfirmDel(null)}>
          <div style={{maxWidth:360}}>
            <div style={{fontSize:17,fontWeight:700,color:C.navy,marginBottom:10}}>Delete Job?</div>
            <div style={{fontSize:14,color:C.textMid,lineHeight:1.6}}>This will permanently delete <strong>{confirmDel.jobRef}</strong>. This cannot be undone.</div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <Btn danger onClick={()=>deleteJob(confirmDel.id)}>Delete</Btn>
              <Btn ghost onClick={()=>setConfirmDel(null)}>Cancel</Btn>
            </div>
          </div>
        </Overlay>
      )}

      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Logo/>
          <div>
            <div style={{fontWeight:800,fontSize:15,letterSpacing:2,color:C.white}}>{COMPANY_SHORT}</div>
            <div style={{fontSize:9,letterSpacing:1,color:C.silver,marginTop:1}}>Sheet Metal & Fabrication · Job Management</div>
          </div>
        </div>
        <nav style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
          {[{k:"dashboard",l:"Dashboard"},{k:"jobs",l:"Jobs"},{k:"quotes",l:"Quotes"},{k:"customers",l:"Customers"},{k:"alerts",l:"Alerts"}].map(({k,l})=>(
            <button key={k} style={{...S.navBtn,...(view===k?S.navBtnOn:{})}} onClick={()=>setView(k)}>
              {l}{k==="alerts"&&uninvoiced.length+overdue.length>0&&<span style={S.dot}/>}
            </button>
          ))}
        </nav>
        <button style={S.newBtn} onClick={()=>setEditJob({...EMPTY_JOB})}>+ New Job</button>
      </header>

      <main style={{padding:"24px 24px 48px",minHeight:"calc(100vh - 65px)"}}>
        <div style={{maxWidth:1240,margin:"0 auto"}}>

          {view==="dashboard"&&(
            <>
              <h1 style={S.pageH}>Dashboard</h1>
              <div style={S.statGrid}>
                {STATUS_FLOW.map(s=>(
                  <div key={s} style={{...S.statCard,borderTop:`3px solid ${SC[s].border}`}} onClick={()=>{setView("jobs");setFilterStatus(s);}}>
                    <div style={{fontSize:30,fontWeight:800,color:SC[s].color==="555"?C.textMid:SC[s].color,lineHeight:1}}>{counts[s]}</div>
                    <div style={{fontSize:11,color:C.textLight,marginTop:4,fontWeight:600,letterSpacing:0.3}}>{s}</div>
                  </div>
                ))}
                <div style={{...S.statCard,borderTop:`3px solid ${C.gold}`}}>
                  <div style={{fontSize:30,fontWeight:800,color:C.gold,lineHeight:1}}>£{pipeline.toLocaleString("en-GB",{maximumFractionDigits:0})}</div>
                  <div style={{fontSize:11,color:C.textLight,marginTop:4,fontWeight:600,letterSpacing:0.3}}>Pipeline Value</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:24}}>
                <ACard title="Overdue Jobs" count={overdue.length} color={C.danger}>
                  {overdue.length===0?<Em>All jobs on schedule ✓</Em>:overdue.map(j=>(
                    <ARow key={j.id} job={j} onClick={()=>setJobModal(j)}><span style={{color:C.danger,fontSize:12}}>Due {fmt(j.dueDate)}</span></ARow>
                  ))}
                </ACard>
                <ACard title="Awaiting Invoice" count={uninvoiced.length} color={C.accent}>
                  {uninvoiced.length===0?<Em>No outstanding invoices ✓</Em>:uninvoiced.map(j=>(
                    <ARow key={j.id} job={j} onClick={()=>setJobModal(j)}><span style={{color:C.accent,fontSize:12}}>Desp. {fmt(j.despatchDate)}{j.quoteValue?` · £${j.quoteValue}`:""}</span></ARow>
                  ))}
                </ACard>
              </div>
              <h2 style={S.subH}>Recent Jobs</h2>
              <JobTable jobs={jobs.slice(0,10)} onOpen={setJobModal}/>
            </>
          )}

          {view==="jobs"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                <h1 style={{...S.pageH,margin:0}}>All Jobs</h1>
                <input style={S.search} placeholder="Search by ref, customer or description…" value={search} onChange={e=>setSearch(e.target.value)}/>
                <Btn onClick={()=>exportCSV(filtered)}>↓ Export CSV</Btn>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {["All",...STATUS_FLOW].map(s=>(
                  <button key={s} style={{...S.fBtn,...(filterStatus===s?S.fBtnOn:{})}} onClick={()=>setFilterStatus(s)}>{s}</button>
                ))}
              </div>
              <JobTable jobs={filtered} onOpen={setJobModal}/>
              {filtered.length===0&&<Em center>No jobs match your search.</Em>}
            </>
          )}

          {view==="quotes"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <h1 style={{...S.pageH,margin:0}}>Quotes</h1>
                <Btn onClick={()=>setEditJob({...EMPTY_JOB,status:"Quote",quoteRef:genRef("QTE"),quoteStatus:"Pending"})}>+ New Quote</Btn>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
                {["Pending","Approved","Rejected"].map(qs=>{
                  const qj=jobs.filter(j=>j.status==="Quote"&&j.quoteStatus===qs);
                  const tot=qj.reduce((a,j)=>a+parseFloat(j.quoteValue||0),0);
                  const hc=qs==="Approved"?C.successBg:qs==="Rejected"?C.dangerBg:C.warnBg;
                  const tc=qs==="Approved"?C.success:qs==="Rejected"?C.danger:C.warn;
                  return(
                    <div key={qs} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"10px 16px",background:hc,color:tc,fontWeight:700,fontSize:13,display:"flex",justifyContent:"space-between"}}>
                        <span>{qs}</span><span style={{fontWeight:400,fontSize:12}}>{qj.length} · £{tot.toLocaleString()}</span>
                      </div>
                      {qj.length===0&&<Em>None</Em>}
                      {qj.map(j=>(
                        <div key={j.id} style={{padding:"12px 16px",borderTop:`1px solid ${C.borderLight}`,cursor:"pointer"}} onClick={()=>setJobModal(j)}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                            <Ref>{j.quoteRef||j.jobRef}</Ref>
                            {j.quoteValue&&<span style={{fontWeight:700,color:C.navy,fontSize:13}}>£{parseFloat(j.quoteValue).toLocaleString()}</span>}
                          </div>
                          <div style={{fontSize:13,color:C.textMid,marginBottom:3}}>{j.customerName}</div>
                          <div style={{fontSize:12,color:C.textLight,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{j.description}</div>
                          <div style={{fontSize:11,color:C.textLight,marginTop:6}}>Due {fmt(j.dueDate)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view==="customers"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <h1 style={{...S.pageH,margin:0}}>Customers</h1>
                <Btn onClick={()=>setEditCust({...EMPTY_CUST})}>+ Add Customer</Btn>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {customers.map(c=>{
                  const cj=jobs.filter(j=>j.customerId===c.id);
                  const uninv=cj.filter(j=>j.status==="Despatched").length;
                  const active=cj.filter(j=>j.status!=="Invoiced").length;
                  return(
                    <div key={c.id} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:16,display:"flex",gap:14,alignItems:"flex-start"}}>
                      <div style={{width:44,height:44,borderRadius:"50%",background:C.navyLight,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0}}>
                        {c.name.split(" ").slice(0,2).map(w=>w[0]).join("")}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:15,color:C.navy,marginBottom:6}}>{c.name}</div>
                        {c.contact&&<div style={{fontSize:12,color:C.textMid,marginBottom:3}}>👤 {c.contact}</div>}
                        {c.email&&<div style={{fontSize:12,color:C.textMid,marginBottom:3}}>✉ {c.email}</div>}
                        {c.phone&&<div style={{fontSize:12,color:C.textMid,marginBottom:3}}>📞 {c.phone}</div>}
                        {c.notes&&<div style={{fontSize:12,color:C.textLight,fontStyle:"italic",marginTop:4}}>{c.notes}</div>}
                        <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                          <Tag>{cj.length} total jobs</Tag>
                          {active>0&&<Tag color={C.accent}>{active} active</Tag>}
                          {uninv>0&&<Tag color={C.danger}>{uninv} awaiting invoice</Tag>}
                        </div>
                      </div>
                      <button style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",cursor:"pointer",color:C.textLight,fontSize:15}} onClick={()=>setEditCust(c)}>✎</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view==="alerts"&&(
            <>
              <h1 style={S.pageH}>Alerts & Actions Required</h1>
              <ACard title="Overdue Jobs" count={overdue.length} color={C.danger} large>
                {overdue.length===0?<Em>No overdue jobs ✓</Em>:overdue.map(j=><ALarge key={j.id} job={j} onClick={()=>setJobModal(j)}/>)}
              </ACard>
              <div style={{height:16}}/>
              <ACard title="Despatched — Not Yet Invoiced" count={uninvoiced.length} color={C.accent} large>
                {uninvoiced.length===0?<Em>All despatched jobs invoiced ✓</Em>:uninvoiced.map(j=><ALarge key={j.id} job={j} onClick={()=>setJobModal(j)} extra={j.quoteValue?`£${parseFloat(j.quoteValue).toLocaleString()}`:null}/>)}
              </ACard>
            </>
          )}

        </div>
      </main>

      {jobModal&&!editJob&&(
        <Overlay onClose={()=>setJobModal(null)}>
          <JobDetail job={jobModal}
            onEdit={()=>{setEditJob(jobModal);setJobModal(null);}}
            onAdvance={()=>advanceJob(jobModal)}
            onDelete={()=>{setConfirmDel(jobModal);setJobModal(null);}}
            onToggleStage={toggleStage}
            onAddStage={addStage}
            onRemoveStage={removeStage}
            onPrint={()=>{setPrintJob(jobModal);setJobModal(null);}}
            stageInput={stageInput} setStageInput={setStageInput}
          />
        </Overlay>
      )}

      {editJob&&(
        <Overlay onClose={()=>setEditJob(null)}>
          <JobForm job={editJob} customers={customers} onSave={saveJob} onCancel={()=>setEditJob(null)}/>
        </Overlay>
      )}

      {editCust&&(
        <Overlay onClose={()=>setEditCust(null)}>
          <CustForm cust={editCust} onSave={saveCust} onCancel={()=>setEditCust(null)}/>
        </Overlay>
      )}
    </div>
  );
}

function JobTable({jobs,onOpen}){
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",background:C.white,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",fontSize:13}}>
        <thead>
          <tr style={{background:C.navy}}>
            {["Job Ref","Customer","Description","Due Date","Status","Priority","Value"].map(h=>(
              <th key={h} style={{padding:"10px 14px",textAlign:"left",color:C.silver,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map(j=>(
            <tr key={j.id} style={{borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",...(isOverdue(j)?{background:"#fff5f5"}:{})}} onClick={()=>onOpen(j)}>
              <td style={{padding:"10px 14px"}}><Ref>{j.jobRef}</Ref></td>
              <td style={{padding:"10px 14px",color:C.text}}>{j.customerName||"—"}</td>
              <td style={{padding:"10px 14px",color:C.text,maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.description}</td>
              <td style={{padding:"10px 14px",color:isOverdue(j)?C.danger:C.textMid}}>{fmt(j.dueDate)}</td>
              <td style={{padding:"10px 14px"}}><SPill s={j.status}/></td>
              <td style={{padding:"10px 14px"}}><PPill p={j.priority}/></td>
              <td style={{padding:"10px 14px",fontWeight:700,color:C.navy}}>{j.quoteValue?`£${parseFloat(j.quoteValue).toLocaleString()}`:"—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobDetail({job,onEdit,onAdvance,onDelete,onToggleStage,onAddStage,onRemoveStage,onPrint,stageInput,setStageInput}){
  const allS=job.stages||[];
  const done=allS.filter(s=>job.stagesComplete?.[s]).length;
  const next=STATUS_FLOW[STATUS_FLOW.indexOf(job.status)+1];
  const pct=allS.length>0?Math.round((done/allS.length)*100):null;
  return(
    <div style={{minWidth:300}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div>
          <div style={{fontSize:22,fontWeight:800,color:C.navy,letterSpacing:1,fontFamily:"monospace"}}>{job.jobRef}</div>
          <div style={{color:C.textLight,fontSize:13,marginTop:2}}>Received {fmt(job.dateReceived)}</div>
        </div>
        <SPill s={job.status} large/>
      </div>
      {isOverdue(job)&&<div style={{background:C.dangerBg,color:C.danger,border:`1px solid ${C.danger}44`,borderRadius:6,padding:"8px 14px",fontSize:13,fontWeight:600,marginBottom:14}}>⚠ This job is overdue — due {fmt(job.dueDate)}</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        {[["Customer",job.customerName],["Description",job.description],["Priority",<PPill p={job.priority}/>],["Due Date",<span style={{color:isOverdue(job)?C.danger:C.text}}>{fmt(job.dueDate)}</span>],["Quote Ref",job.quoteRef],["Quote Value",job.quoteValue?`£${parseFloat(job.quoteValue).toLocaleString()}`:null],["Quote Status",job.quoteStatus!=="N/A"?job.quoteStatus:null],["Despatched",job.despatchDate?fmt(job.despatchDate):null],["Invoice Ref",job.invoiceRef],["Notes",job.notes]].filter(([,v])=>v).map(([l,v])=>(
          <div key={l} style={{display:"flex",gap:12,padding:"7px 0",borderBottom:`1px solid ${C.borderLight}`}}>
            <span style={{color:C.textLight,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",minWidth:100}}>{l}</span>
            <span style={{color:C.text,fontSize:13,flex:1}}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{background:C.silverPale,border:`1px solid ${C.border}`,borderRadius:8,padding:16,marginTop:18}}>
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:13,color:C.navy,marginBottom:8}}>
          <span>Production Stages</span>
          {pct!==null&&<span style={{fontSize:12,color:C.textLight}}>{done}/{allS.length} complete</span>}
        </div>
        {pct!==null&&<div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden",marginBottom:12}}><div style={{height:"100%",background:C.success,width:`${pct}%`,borderRadius:3,transition:"width .3s"}}/></div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          {allS.length===0&&<span style={{color:C.textLight,fontSize:13}}>No stages added yet.</span>}
          {allS.map(s=>(
            <div key={s} style={{display:"flex",alignItems:"center",gap:7,background:job.stagesComplete?.[s]?C.successBg:C.white,border:`1px solid ${job.stagesComplete?.[s]?"#90d0a0":C.border}`,borderRadius:20,padding:"5px 12px",cursor:"pointer",fontSize:13,color:job.stagesComplete?.[s]?C.success:C.textMid,userSelect:"none"}} onClick={()=>onToggleStage(job,s)}>
              <span style={{fontSize:13}}>{job.stagesComplete?.[s]?"✓":"○"}</span>
              <span>{s}</span>
              <span style={{color:C.border,fontSize:10,marginLeft:2,cursor:"pointer"}} onClick={e=>{e.stopPropagation();onRemoveStage(job,s);}}>✕</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {PRESET_STAGES.filter(s=>!allS.includes(s)).map(s=>(
            <button key={s} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:20,padding:"3px 11px",fontSize:11,fontFamily:"inherit",cursor:"pointer",color:C.textMid}} onClick={()=>onAddStage(job,s)}>+ {s}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input style={{...S.search,flex:1}} placeholder="Custom stage name…" value={stageInput} onChange={e=>setStageInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onAddStage(job)}/>
          <Btn small onClick={()=>onAddStage(job)}>Add</Btn>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap"}}>
        {next&&<Btn primary onClick={onAdvance}>→ Move to: {next}</Btn>}
        <Btn onClick={onEdit}>Edit</Btn>
        <Btn onClick={onPrint}>Print Job Sheet</Btn>
        <Btn danger onClick={onDelete}>Delete</Btn>
      </div>
    </div>
  );
}

function JobForm({job,customers,onSave,onCancel}){
  const[f,setF]=useState({...job});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  return(
    <div style={{minWidth:300,maxWidth:580}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:18}}>{f.id?"Edit Job":"New Job"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <FF label="Job Reference"><input style={S.inp} value={f.jobRef} onChange={e=>s("jobRef",e.target.value)} placeholder="Auto-generated if blank"/></FF>
        <FF label="Customer">
          <select style={S.inp} value={f.customerId} onChange={e=>{const c=customers.find(x=>x.id===e.target.value);s("customerId",e.target.value);if(c)s("customerName",c.name);}}>
            <option value="">— Select —</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FF>
        <FF label="Customer Name (if not listed)"><input style={S.inp} value={f.customerName} onChange={e=>s("customerName",e.target.value)}/></FF>
        <FF label="Status"><select style={S.inp} value={f.status} onChange={e=>s("status",e.target.value)}>{STATUS_FLOW.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Priority"><select style={S.inp} value={f.priority} onChange={e=>s("priority",e.target.value)}>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Date Received"><input type="date" style={S.inp} value={f.dateReceived} onChange={e=>s("dateReceived",e.target.value)}/></FF>
        <FF label="Due Date"><input type="date" style={S.inp} value={f.dueDate} onChange={e=>s("dueDate",e.target.value)}/></FF>
        <FF label="Quote Reference"><input style={S.inp} value={f.quoteRef} onChange={e=>s("quoteRef",e.target.value)}/></FF>
        <FF label="Quote Value (£)"><input type="number" style={S.inp} value={f.quoteValue} onChange={e=>s("quoteValue",e.target.value)}/></FF>
        <FF label="Quote Status"><select style={S.inp} value={f.quoteStatus} onChange={e=>s("quoteStatus",e.target.value)}>{QUOTE_STATUSES.map(x=><option key={x}>{x}</option>)}</select></FF>
        <FF label="Despatch Date"><input type="date" style={S.inp} value={f.despatchDate} onChange={e=>s("despatchDate",e.target.value)}/></FF>
        <FF label="Invoice Reference"><input style={S.inp} value={f.invoiceRef} onChange={e=>s("invoiceRef",e.target.value)}/></FF>
        <FF label="Description" full><textarea style={{...S.inp,minHeight:64}} value={f.description} onChange={e=>s("description",e.target.value)}/></FF>
        <FF label="Notes" full><textarea style={{...S.inp,minHeight:64}} value={f.notes} onChange={e=>s("notes",e.target.value)}/></FF>
      </div>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn primary onClick={()=>onSave(f)}>Save Job</Btn>
        <Btn ghost onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function CustForm({cust,onSave,onCancel}){
  const[f,setF]=useState({...cust});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  return(
    <div style={{minWidth:300,maxWidth:420}}>
      <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:18}}>{f.id?"Edit Customer":"New Customer"}</div>
      {[["name","Company Name"],["contact","Contact Name"],["email","Email"],["phone","Phone"],["notes","Notes"]].map(([k,l])=>(
        <FF key={k} label={l}><input style={S.inp} value={f[k]} onChange={e=>s(k,e.target.value)}/></FF>
      ))}
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn primary onClick={()=>onSave(f)}>Save</Btn>
        <Btn ghost onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function PrintSheet({job,onClose}){
  const allS=job.stages||[];
  useEffect(()=>{const t=setTimeout(()=>window.print(),400);return()=>clearTimeout(t);},[]);
  return(
    <div style={{background:"#fff",minHeight:"100vh",padding:32,fontFamily:"Georgia,serif",color:"#000"}}>
      <button onClick={onClose} style={{marginBottom:20,background:C.navy,color:"#fff",border:"none",padding:"8px 18px",cursor:"pointer",borderRadius:4,fontFamily:"sans-serif"}}>← Back</button>
      <div style={{borderBottom:"3px solid #0f2a4a",paddingBottom:16,marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,color:"#0f2a4a",letterSpacing:1}}>{COMPANY}</div>
            <div style={{fontSize:12,color:"#666",marginTop:2}}>Job Sheet</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:20,fontWeight:700}}>{job.jobRef}</div>
            <div style={{fontSize:12,color:"#666"}}>Printed {fmt(todayStr())}</div>
          </div>
        </div>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:24,fontSize:13}}>
        <tbody>
          {[["Customer",job.customerName],["Description",job.description],["Due Date",fmt(job.dueDate)],["Priority",job.priority],["Quote Ref",job.quoteRef],["Quote Value",job.quoteValue?`£${job.quoteValue}`:null],["Status",job.status],["Notes",job.notes]].filter(([,v])=>v).map(([l,v])=>(
            <tr key={l}>
              <td style={{padding:"7px 12px",border:"1px solid #ddd",background:"#f7f7f7",fontWeight:600,width:140}}>{l}</td>
              <td style={{padding:"7px 12px",border:"1px solid #ddd"}}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:"#0f2a4a"}}>Production Stages</div>
      {allS.length===0
        ?<div style={{color:"#999",fontSize:13}}>No stages defined.</div>
        :allS.map(s=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #eee"}}>
            <div style={{width:22,height:22,border:"2px solid #0f2a4a",borderRadius:4,background:job.stagesComplete?.[s]?"#0f2a4a":"#fff",flexShrink:0}}/>
            <span style={{fontSize:14}}>{s}</span>
            <span style={{marginLeft:"auto",fontSize:12,color:"#999"}}>Completed by: ________________ Date: ___________</span>
          </div>
        ))}
      <div style={{marginTop:40,fontSize:12,color:"#999",borderTop:"1px solid #ddd",paddingTop:12}}>{COMPANY} · Job Sheet {job.jobRef} · {VERSION}</div>
    </div>
  );
}

function SPill({s,large}){
  const sc=SC[s]||SC["Invoiced"];
  return<span style={{background:sc.bg,color:sc.color,border:`1px solid ${sc.border}`,borderRadius:20,padding:large?"5px 14px":"3px 10px",fontSize:large?13:11,fontWeight:600,whiteSpace:"nowrap",letterSpacing:0.3}}>{s}</span>;
}
function PPill({p}){
  const cols={Urgent:{bg:"#fce8e8",color:"#8b0000",border:"#f5b0b0"},High:{bg:C.warnBg,color:C.warn,border:"#f5c060"},Normal:{bg:C.silverPale,color:C.textMid,border:C.border},Low:{bg:C.successBg,color:C.success,border:"#90d0a0"}};
  const c=cols[p]||cols.Normal;
  return<span style={{background:c.bg,color:c.color,border:`1px solid ${c.border}`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>{p||"Normal"}</span>;
}
function Ref({children}){return<span style={{background:"#e8f0fb",color:C.navy,border:`1px solid #b0c8e8`,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:0.5,fontFamily:"monospace",whiteSpace:"nowrap"}}>{children}</span>;}
function Tag({children,color}){return<span style={{background:color?`${color}18`:C.silverLight,color:color||C.textMid,border:`1px solid ${color?`${color}44`:C.border}`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:500}}>{children}</span>;}
function Em({children,center}){return<div style={{color:C.textLight,fontSize:13,padding:center?"30px 0":"8px 0",textAlign:center?"center":undefined}}>{children}</div>;}
function ACard({title,count,color,children,large}){
  return(
    <div style={{background:C.white,border:`1px solid ${C.border}`,borderLeft:`4px solid ${color}`,borderRadius:8,padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontWeight:700,fontSize:13,color:C.text}}>{title}</span>
        <span style={{background:count>0?`${color}18`:C.silverPale,color:count>0?color:C.textLight,border:`1px solid ${count>0?`${color}44`:C.border}`,borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:700}}>{count}</span>
      </div>
      {children}
    </div>
  );
}
function ARow({job,onClick,children}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer"}} onClick={onClick}>
      <Ref>{job.jobRef}</Ref>
      <span style={{fontSize:13,color:C.textMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.customerName}</span>
      {children}
    </div>
  );
}
function ALarge({job,onClick,extra}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer",flexWrap:"wrap"}} onClick={onClick}>
      <Ref>{job.jobRef}</Ref>
      <span style={{fontSize:13,color:C.text,flex:1,minWidth:120}}>{job.description}</span>
      <span style={{fontSize:12,color:C.textLight}}>{job.customerName}</span>
      <SPill s={job.status}/>
      <span style={{fontSize:12,color:C.textMid}}>Due {fmt(job.dueDate)}</span>
      {extra&&<span style={{fontSize:13,fontWeight:700,color:C.navy}}>{extra}</span>}
    </div>
  );
}
function Btn({children,onClick,primary,ghost,danger,small}){
  const base={border:"none",borderRadius:5,fontFamily:"inherit",fontWeight:600,cursor:"pointer",padding:small?"5px 12px":"8px 16px",fontSize:small?12:13,letterSpacing:0.2};
  const v=primary?{background:C.navy,color:"#fff"}:danger?{background:C.dangerBg,color:C.danger,border:`1px solid ${C.danger}40`}:ghost?{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`}:{background:C.silverLight,color:C.navy,border:`1px solid ${C.border}`};
  return<button style={{...base,...v}} onClick={onClick}>{children}</button>;
}
function Overlay({children,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"#00000066",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}} onClick={onClose}>
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderTop:`4px solid ${C.navy}`,borderRadius:10,padding:28,maxWidth:640,width:"100%",position:"relative",boxShadow:"0 8px 40px #0003"}} onClick={e=>e.stopPropagation()}>
        <button style={{position:"absolute",top:12,right:14,background:"none",border:"none",color:C.textLight,fontSize:17,cursor:"pointer"}} onClick={onClose}>✕</button>
        <div style={{maxHeight:"85vh",overflowY:"auto",paddingRight:4}}>{children}</div>
      </div>
    </div>
  );
}
function FF({label,children,full}){
  return(
    <div style={{marginBottom:12,gridColumn:full?"1 / -1":undefined}}>
      <label style={{display:"block",color:C.textLight,fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:4}}>{label}</label>
      {children}
    </div>
  );
}
function Logo(){
  return(
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="6" fill={C.navyMid}/>
      <path d="M7 22 L18 10 L29 22" stroke={C.silver} strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
      <rect x="14" y="22" width="8" height="7" fill={C.gold} rx="1"/>
      <line x1="18" y1="22" x2="18" y2="29" stroke={C.navyMid} strokeWidth="1.5"/>
    </svg>
  );
}

const S={
  app:{minHeight:"100vh",background:C.silverPale,fontFamily:"'Trebuchet MS','Segoe UI',sans-serif",color:C.text},
  header:{background:C.navy,borderBottom:`3px solid ${C.gold}`,padding:"0 24px",display:"flex",alignItems:"center",gap:20,height:62,flexShrink:0,position:"sticky",top:0,zIndex:100},
  navBtn:{background:"none",border:"none",color:C.silver,fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"4px 14px",cursor:"pointer",borderBottom:"3px solid transparent",whiteSpace:"nowrap",height:62,letterSpacing:0.3,position:"relative"},
  navBtnOn:{color:C.white,borderBottom:`3px solid ${C.gold}`},
  dot:{position:"absolute",top:14,right:6,width:7,height:7,borderRadius:"50%",background:"#e84040"},
  newBtn:{background:C.gold,color:C.navy,border:"none",fontFamily:"inherit",fontWeight:800,fontSize:13,padding:"8px 18px",cursor:"pointer",borderRadius:5,whiteSpace:"nowrap",letterSpacing:0.3},
  pageH:{fontSize:20,fontWeight:700,color:C.navy,margin:"0 0 20px",letterSpacing:0.3},
  subH:{fontSize:14,fontWeight:700,color:C.textMid,margin:"24px 0 12px",letterSpacing:0.5,textTransform:"uppercase",borderTop:`1px solid ${C.border}`,paddingTop:20},
  statGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:24},
  statCard:{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"16px 20px",cursor:"pointer"},
  search:{background:C.white,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 12px",fontFamily:"inherit",fontSize:13,color:C.text,outline:"none",minWidth:220,flex:1},
  fBtn:{background:C.white,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 14px",fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:"pointer",color:C.textMid},
  fBtnOn:{background:C.navy,color:C.white,borderColor:C.navy},
  inp:{width:"100%",background:C.white,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:13,color:C.text,outline:"none",boxSizing:"border-box"},
  toast:{position:"fixed",bottom:24,right:24,color:"#fff",fontFamily:"inherit",fontWeight:700,fontSize:13,padding:"10px 20px",borderRadius:6,zIndex:9999,boxShadow:"0 4px 20px #0004"},
};
