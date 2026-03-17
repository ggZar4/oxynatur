import { useState, useEffect, createContext, useContext } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://eyfwqcxcjunrpnqhbbek.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5ZndxY3hjanVucnBucWhiYmVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjAwNTIsImV4cCI6MjA4ODEzNjA1Mn0.6pNYJTeFKs4Uf-KqqJ_H8pSQSOWGFUvy-UR_dk6fHGY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Colores por sede ──────────────────────────────────────────
const SEDE_COLOR = {
  "Molisalud": "#10B981",
  "Clínica San Miguel Arcángel": "#7C6AF7",
};
const getColor = (nombre) => SEDE_COLOR[nombre] || "#00C4B4";

// ── Componentes base ──────────────────────────────────────────
const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#080C18"}}>
    <div style={{width:40,height:40,border:"3px solid #1E2535",borderTop:"3px solid #00C4B4",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

const Badge = ({color, children}) => (
  <span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:color+"22",color,border:`1px solid ${color}33`}}>{children}</span>
);

const Card = ({children, style={}}) => (
  <div style={{background:"#111827",border:"1px solid #1E2535",borderRadius:16,padding:20,...style}}>{children}</div>
);

const Btn = ({children,onClick,variant="primary",disabled=false,style={}}) => {
  const styles = {
    primary: {background:"linear-gradient(135deg,#00C4B4,#7C6AF7)",color:"white",border:"none"},
    ghost:   {background:"#1A2035",color:"#9CA3AF",border:"1px solid #2A3550"},
    danger:  {background:"#F8717120",color:"#F87171",border:"1px solid #F8717140"},
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{...styles[variant],padding:"9px 20px",borderRadius:10,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontSize:14,fontWeight:600,opacity:disabled?0.5:1,transition:"opacity .2s",...style}}>
      {children}
    </button>
  );
};

const Input = ({label,value,onChange,type="text",placeholder="",required=false,error=""}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:error?"#F87171":"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:"#1A2035",border:`1px solid ${error?"#F87171":"#2A3550"}`,borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
    {error && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{error}</div>}
  </div>
);

const Select = ({label,value,onChange,options=[],required=false}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:value?"#E8EAF0":"#4B5563",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
      <option value="">Seleccionar...</option>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ── LOGIN ─────────────────────────────────────────────────────
function Login({onLogin}) {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if(!email||!pass){setError("Completa todos los campos");return;}
    setLoading(true); setError("");
    const {data,error:e} = await supabase.auth.signInWithPassword({email,password:pass});
    if(e){setError("Email o contraseña incorrectos");setLoading(false);return;}
    const {data:perfil} = await supabase.from("perfiles").select("*").eq("id",data.user.id).single();
    onLogin({...data.user, perfil});
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#080C18",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}input::placeholder{color:#4B5563}select option{background:#1A2035}`}</style>
      <div style={{width:"100%",maxWidth:420,padding:20}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,#00C4B420,#7C6AF720)",border:"1px solid #00C4B440",marginBottom:16,fontSize:28}}>🫁</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:800,color:"#E8EAF0",letterSpacing:"-0.03em"}}>OxyNatur</div>
          <div style={{fontSize:13,color:"#4B5563",marginTop:4}}>Sistema de Gestión Clínica</div>
        </div>
        <Card style={{padding:32}}>
          <div style={{fontSize:18,fontWeight:700,color:"#E8EAF0",marginBottom:6,fontFamily:"Syne,sans-serif"}}>Iniciar sesión</div>
          <div style={{fontSize:13,color:"#4B5563",marginBottom:24}}>Acceso autorizado al personal OxyNatur</div>
          {error && <div style={{background:"#F8717115",border:"1px solid #F8717140",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#F87171"}}>⚠ {error}</div>}
          <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="tu@email.com"/>
          <Input label="Contraseña" value={pass} onChange={setPass} type="password" placeholder="••••••••"/>
          <Btn onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15,marginTop:8}}>
            {loading ? "Ingresando..." : "Ingresar →"}
          </Btn>
        </Card>
        <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"#374151"}}>OxyNatur · Sistema Interno · Acceso Restringido</div>
      </div>
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────
function Sidebar({vista, setVista, perfil, onLogout}) {
  const isAdmin = perfil?.rol === "admin_general";
  const isMedico = perfil?.rol === "medico";
  const navAdmin = [
    {id:"dashboard", icon:"▦",  label:"Dashboard"},
    {id:"pacientes", icon:"👤", label:"Pacientes"},
    {id:"sesiones",  icon:"⚡", label:"Sesiones"},
    {id:"historias", icon:"📋", label:"Historias Clínicas"},
    {id:"finanzas",  icon:"💰", label:"Finanzas"},
    {id:"sedes",     icon:"📍", label:"Sedes"},
    {id:"usuarios",  icon:"👥", label:"Usuarios"},
  ];
  const navMedico = [
    {id:"pacientes", icon:"👤", label:"Pacientes"},
    {id:"historias", icon:"📋", label:"Historias Clínicas"},
    {id:"agenda",    icon:"📅", label:"Mi Agenda"},
  ];
  const navEnfermero = [
    {id:"agenda",    icon:"📅", label:"Agenda del día"},
    {id:"pacientes", icon:"👤", label:"Pacientes"},
    {id:"historias", icon:"📋", label:"Historias Clínicas"},
    {id:"sesiones",  icon:"⚡", label:"Sesiones"},
  ];
  const nav = isAdmin ? navAdmin : isMedico ? navMedico : navEnfermero;
  const rolLabel = isAdmin ? "Admin General" : isMedico ? "Médico" : "Enfermero";

  return (
    <div style={{width:240,background:"#0D1320",borderRight:"1px solid #1E2535",padding:"20px 10px",display:"flex",flexDirection:"column",gap:2,flexShrink:0,minHeight:"100vh"}}>
      <div style={{padding:"0 8px 24px"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:20,color:"#00C4B4",letterSpacing:"-0.03em"}}>OxyNatur</div>
        <div style={{fontSize:10,color:"#374151",marginTop:1,letterSpacing:"0.05em",textTransform:"uppercase"}}>{rolLabel}</div>
      </div>
      {nav.map(item=>(
        <button key={item.id} onClick={()=>setVista(item.id)}
          style={{background:vista===item.id?"linear-gradient(135deg,#00C4B420,#7C6AF720)":"none",border:vista===item.id?"1px solid #00C4B430":"1px solid transparent",cursor:"pointer",padding:"10px 14px",borderRadius:10,color:vista===item.id?"#00C4B4":"#6B7280",fontFamily:"inherit",fontSize:14,fontWeight:500,display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",transition:"all .2s"}}>
          <span style={{fontSize:15}}>{item.icon}</span>{item.label}
        </button>
      ))}
      <div style={{marginTop:"auto",padding:"16px 8px 0",borderTop:"1px solid #1E2535"}}>
        <div style={{fontSize:13,color:"#6B7280",fontWeight:500}}>{perfil?.nombre}</div>
        <div style={{fontSize:11,color:"#374151",marginTop:2}}>{perfil?.email}</div>
        <button onClick={onLogout} style={{marginTop:10,background:"none",border:"1px solid #2A3550",color:"#6B7280",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,width:"100%"}}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// ── DASHBOARD ADMIN ───────────────────────────────────────────
function DashboardAdmin() {
  const [resumen, setResumen] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    supabase.from("vista_resumen_sedes").select("*")
      .then(({data})=>{ setResumen(data||[]); setLoading(false); });
  },[]);

  const totales = {
    pacientes: resumen.reduce((a,s)=>a+Number(s.pacientes_activos||0),0),
    sesiones:  resumen.reduce((a,s)=>a+Number(s.sesiones_mes||0),0),
    ingresos:  resumen.reduce((a,s)=>a+Number(s.ingresos_mes||0),0),
    sesHoy:    resumen.reduce((a,s)=>a+Number(s.sesiones_hoy||0),0),
  };

  if(loading) return <div style={{padding:32,color:"#4B5563"}}>Cargando dashboard...</div>;

  return (
    <div>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:700,color:"#E8EAF0"}}>Dashboard</h1>
        <p style={{color:"#4B5563",fontSize:14,marginTop:4}}>{new Date().toLocaleDateString("es-PE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Pacientes Activos", val:totales.pacientes, color:"#00C4B4", icon:"👥"},
          {label:"Sesiones este mes",  val:totales.sesiones,  color:"#7C6AF7", icon:"⚡"},
          {label:"Ingresos del mes",   val:`S/ ${totales.ingresos.toLocaleString()}`, color:"#10B981", icon:"💰"},
          {label:"Sesiones hoy",       val:totales.sesHoy,   color:"#F59E0B", icon:"📅"},
        ].map((k,i)=>(
          <Card key={i}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:12,color:"#6B7280",marginBottom:8}}>{k.label}</div>
                <div style={{fontSize:28,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.color}}>{k.val}</div>
              </div>
              <div style={{fontSize:24,opacity:.3}}>{k.icon}</div>
            </div>
          </Card>
        ))}
      </div>
      <div style={{marginBottom:10,fontSize:13,fontWeight:700,color:"#6B7280",letterSpacing:"0.08em",textTransform:"uppercase"}}>Rendimiento por sede</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
        {resumen.map(s=>(
          <Card key={s.sede_id} style={{borderTop:`3px solid ${getColor(s.sede)}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,color:"#E8EAF0"}}>{s.sede}</div>
              <Badge color="#10B981">Activa</Badge>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[
                {l:"Pac. activos", v:s.pacientes_activos, c:getColor(s.sede)},
                {l:"Ses. hoy",     v:s.sesiones_hoy,      c:"#7C6AF7"},
                {l:"Ingresos mes", v:`S/${Number(s.ingresos_mes||0).toLocaleString()}`, c:"#10B981"},
              ].map((it,j)=>(
                <div key={j} style={{background:"#0D1320",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700,color:it.c}}>{it.v}</div>
                  <div style={{fontSize:10,color:"#6B7280",marginTop:2}}>{it.l}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── PACIENTES ─────────────────────────────────────────────────
function Pacientes({perfil}) {
  const isAdmin = perfil?.rol === "admin_general";
  const isMedico = perfil?.rol === "medico";
  const [pacs, setPacs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busq, setBusq]   = useState("");
  const [modal, setModal] = useState(false);
  const [sedes, setSedes] = useState([]);
  const [form, setForm]   = useState({nombres:"",apellidos:"",dni:"",telefono:"",email:"",genero:"",fecha_nacimiento:"",sede_principal_id:"",total_sesiones_prescritas:"",diagnostico_hc:""});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState({});

  const load = async () => {
    setLoading(true);
    let q = supabase.from("pacientes").select("*, sedes(nombre,color)").order("created_at",{ascending:false});
    if(!isAdmin && !isMedico) q = q.eq("sede_principal_id", perfil.sede_id);
    const {data} = await q;
    setPacs(data||[]);
    setLoading(false);
  };

  useEffect(()=>{
    load();
    supabase.from("sedes").select("id,nombre").then(({data})=>setSedes(data||[]));
  },[]);

  const filtrados = pacs.filter(p=>{
    const q = busq.toLowerCase();
    return p.nombres?.toLowerCase().includes(q) || p.apellidos?.toLowerCase().includes(q) || p.dni?.includes(q);
  });

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const guardar = async () => {
    const e = {};
    if(!form.nombres) e.nombres="Requerido";
    if(!form.apellidos) e.apellidos="Requerido";
    if(!form.dni) e.dni="Requerido";
    if(!form.sede_principal_id) e.sede_principal_id="Requerido";
    if(!form.diagnostico_hc) e.diagnostico_hc="Requerido";
    setErr(e);
    if(Object.keys(e).length) return;
    setSaving(true);
    const {data:pac,error} = await supabase.from("pacientes").insert({
      nombres:form.nombres, apellidos:form.apellidos, dni:form.dni,
      telefono:form.telefono, email:form.email, genero:form.genero||null,
      fecha_nacimiento:form.fecha_nacimiento||null,
      sede_principal_id:form.sede_principal_id,
      total_sesiones_prescritas:parseInt(form.total_sesiones_prescritas)||0,
      estado:"activo",
    }).select().single();
    if(!error && pac) {
      await supabase.from("historias_clinicas").insert({
        paciente_id:pac.id, sede_apertura_id:form.sede_principal_id,
        diagnostico_principal:form.diagnostico_hc, medico_id:perfil.id,
      });
      await supabase.from("paciente_sedes").insert({paciente_id:pac.id, sede_id:form.sede_principal_id});
    }
    setSaving(false);
    setModal(false);
    setForm({nombres:"",apellidos:"",dni:"",telefono:"",email:"",genero:"",fecha_nacimiento:"",sede_principal_id:"",total_sesiones_prescritas:"",diagnostico_hc:""});
    setErr({});
    load();
  };

  const estadoColor = {activo:"#10B981",inactivo:"#6B7280",completado:"#7C6AF7",pendiente:"#F59E0B",suspendido:"#F87171"};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Pacientes</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>{filtrados.length} pacientes encontrados</p>
        </div>
        <Btn onClick={()=>setModal(true)}>+ Nuevo Paciente</Btn>
      </div>
      <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar por nombre o DNI..."
        style={{background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 16px",fontSize:14,fontFamily:"inherit",outline:"none",width:300,marginBottom:18}}/>
      {loading
        ? <div style={{color:"#4B5563",padding:20}}>Cargando...</div>
        : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",padding:"0 18px 10px",fontSize:11,color:"#4B5563",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Paciente</span><span>DNI</span><span>Sede</span><span>Sesiones</span><span>Estado</span>
            </div>
            {filtrados.map(p=>(
              <div key={p.id} style={{background:"#111827",border:"1px solid #1E2535",borderRadius:12,padding:"14px 18px",marginBottom:8,display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",alignItems:"center",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="#1E2535"}>
                <div>
                  <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{p.nombres} {p.apellidos}</div>
                  <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>{p.email||"Sin email"}</div>
                </div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{p.dni}</div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:getColor(p.sedes?.nombre),display:"inline-block",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"#E8EAF0"}}>{p.sedes?.nombre||"—"}</span>
                </div>
                <div style={{fontSize:14,fontWeight:600,color:"#E8EAF0"}}>{p.sesiones_realizadas}<span style={{color:"#4B5563",fontWeight:400}}>/{p.total_sesiones_prescritas}</span></div>
                <div><Badge color={estadoColor[p.estado]||"#6B7280"}>{p.estado}</Badge></div>
              </div>
            ))}
            {filtrados.length===0 && <div style={{color:"#4B5563",textAlign:"center",padding:"40px 0",fontSize:14}}>No se encontraron pacientes</div>}
          </>
        )
      }
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>Nuevo Paciente</div>
              <button onClick={()=>setModal(false)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                <Input label="Nombres" value={form.nombres} onChange={v=>setF("nombres",v)} required error={err.nombres}/>
                <Input label="Apellidos" value={form.apellidos} onChange={v=>setF("apellidos",v)} required error={err.apellidos}/>
                <Input label="DNI" value={form.dni} onChange={v=>setF("dni",v)} required error={err.dni}/>
                <Input label="Teléfono" value={form.telefono} onChange={v=>setF("telefono",v)}/>
                <Input label="Email" value={form.email} onChange={v=>setF("email",v)} type="email"/>
                <Input label="Fecha Nacimiento" value={form.fecha_nacimiento} onChange={v=>setF("fecha_nacimiento",v)} type="date"/>
              </div>
              <Select label="Género" value={form.genero} onChange={v=>setF("genero",v)}
                options={[{value:"M",label:"Masculino"},{value:"F",label:"Femenino"},{value:"Otro",label:"Otro"}]}/>
              <Select label="Sede Principal" value={form.sede_principal_id} onChange={v=>setF("sede_principal_id",v)} required
                options={sedes.map(s=>({value:s.id,label:s.nombre}))}/>
              <Input label="Sesiones Prescritas" value={form.total_sesiones_prescritas} onChange={v=>setF("total_sesiones_prescritas",v)} type="number"/>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:err.diagnostico_hc?"#F87171":"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Diagnóstico Principal <span style={{color:"#F87171"}}>*</span></label>
                <textarea value={form.diagnostico_hc} onChange={e=>setF("diagnostico_hc",e.target.value)} rows={3}
                  placeholder="Diagnóstico para la historia clínica..."
                  style={{width:"100%",background:"#1A2035",border:`1px solid ${err.diagnostico_hc?"#F87171":"#2A3550"}`,borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                {err.diagnostico_hc && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{err.diagnostico_hc}</div>}
              </div>
            </div>
            <div style={{padding:"14px 24px",borderTop:"1px solid #1E2535",display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
              <Btn onClick={guardar} disabled={saving}>{saving?"Guardando...":"Registrar Paciente"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HISTORIAS CLÍNICAS ────────────────────────────────────────
function HistoriasClinicas({perfil}) {
  const isAdmin = perfil?.rol === "admin_general";
  const isMedico = perfil?.rol === "medico";
  const [hcs, setHcs]     = useState([]);
  const [sedes, setSedes] = useState([]);
  const [sedeTab, setSedeTab] = useState("todas");
  const [loading, setLoading] = useState(true);
  const [verHC, setVerHC] = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("evaluaciones_medicas")
      .select("*, pacientes(nombres,apellidos,dni), sedes(nombre,color), perfiles(nombre)")
      .order("fecha",{ascending:false});
    if(!isAdmin && !isMedico) q = q.eq("sede_id", perfil.sede_id);
    const {data} = await q;
    setHcs(data||[]);
    setLoading(false);
  };

  useEffect(()=>{
    load();
    supabase.from("sedes").select("id,nombre,color").then(({data})=>setSedes(data||[]));
  },[]);

  const filtradas = sedeTab==="todas" ? hcs : hcs.filter(h=>h.sede_id===sedeTab);
  const dolorColor = (n) => parseInt(n)>=7?"#F87171":parseInt(n)>=4?"#F59E0B":"#10B981";
  const estColor   = (e) => ["Excelente","Bueno"].includes(e)?"#10B981":e==="Regular"?"#F59E0B":"#F87171";

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Historias Clínicas</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>Registro obligatorio por sesión</p>
        </div>
      </div>
      {(isAdmin || isMedico) && (
        <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
          <button onClick={()=>setSedeTab("todas")} style={{background:sedeTab==="todas"?"#00C4B420":"#111827",border:`1px solid ${sedeTab==="todas"?"#00C4B455":"#1E2535"}`,color:sedeTab==="todas"?"#00C4B4":"#6B7280",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>
            Todas ({hcs.length})
          </button>
          {sedes.map(s=>{
            const cnt = hcs.filter(h=>h.sede_id===s.id).length;
            return (
              <button key={s.id} onClick={()=>setSedeTab(s.id)} style={{background:sedeTab===s.id?`${getColor(s.nombre)}20`:"#111827",border:`1px solid ${sedeTab===s.id?getColor(s.nombre)+"55":"#1E2535"}`,color:sedeTab===s.id?getColor(s.nombre):"#6B7280",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:sedeTab===s.id?700:400,display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:getColor(s.nombre),display:"inline-block"}}/>
                {s.nombre} ({cnt})
              </button>
            );
          })}
        </div>
      )}
      {loading
        ? <div style={{color:"#4B5563",padding:20}}>Cargando...</div>
        : filtradas.length===0
          ? <Card style={{textAlign:"center",padding:"50px 20px"}}><div style={{fontSize:40,marginBottom:12,opacity:.3}}>📋</div><div style={{color:"#6B7280"}}>Sin historias clínicas registradas</div></Card>
          : (
            <>
              <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 80px 90px 100px 100px",padding:"0 18px 10px",fontSize:11,color:"#4B5563",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
                <span>Paciente</span><span>Fecha</span><span>Sesión</span><span>Dolor</span><span>Estado</span><span>Acción</span>
              </div>
              {filtradas.map(hc=>(
                <div key={hc.id} style={{background:"#111827",border:"1px solid #1E2535",borderRadius:12,padding:"13px 18px",marginBottom:8,display:"grid",gridTemplateColumns:"1.5fr 1fr 80px 90px 100px 100px",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{hc.pacientes?.nombres} {hc.pacientes?.apellidos}</div>
                    <div style={{fontSize:12,color:"#6B7280",marginTop:2,display:"flex",alignItems:"center",gap:5}}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:getColor(hc.sedes?.nombre),display:"inline-block"}}/>
                      {hc.sedes?.nombre}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:"#E8EAF0"}}>{hc.fecha}<br/><span style={{color:"#6B7280",fontSize:11}}>{hc.hora?.slice(0,5)}</span></div>
                  <div style={{fontSize:15,fontWeight:700,color:"#00C4B4"}}>#{hc.numero_sesion}</div>
                  <div style={{fontSize:15,fontWeight:700,color:dolorColor(hc.nivel_dolor)}}>{hc.nivel_dolor}/10</div>
                  <div><Badge color={estColor(hc.estado_general)}>{hc.estado_general}</Badge></div>
                  <div><button onClick={()=>setVerHC(hc)} style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Ver</button></div>
                </div>
              ))}
            </>
          )
      }
      {verHC && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:600,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#00C4B4",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Historia Clínica · Sesión #{verHC.numero_sesion}</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>{verHC.pacientes?.nombres} {verHC.pacientes?.apellidos}</div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>{verHC.sedes?.nombre} · {verHC.fecha} · {verHC.hora?.slice(0,5)}</div>
              </div>
              <button onClick={()=>setVerHC(null)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {[
                {titulo:"Signos Vitales", campos:[["Presión Arterial",verHC.presion_arterial],["Frec. Cardíaca",verHC.frecuencia_cardiaca],["Saturación O₂",verHC.saturacion_o2],["Temperatura",verHC.temperatura],["Peso",verHC.peso?`${verHC.peso} kg`:null]]},
                {titulo:"Evaluación Clínica", campos:[["Nivel de Dolor",`${verHC.nivel_dolor}/10`],["Estado General",verHC.estado_general],["Evolución",verHC.evolucion]]},
                {titulo:"Contraindicaciones", campos:[["Otitis",verHC.otitis],["Claustrofobia",verHC.claustrofobia],["Embarazo",verHC.embarazo],["Fiebre",verHC.fiebre_activa]]},
                {titulo:"Parámetros", campos:[["Presión Cámara",`${verHC.presion_indicada} ATA`],["Duración",`${verHC.duracion_minutos} min`]]},
                {titulo:"Post-Sesión", campos:[["Incidencias",verHC.incidencias],["Observaciones",verHC.observaciones],["Médico",verHC.firma_medico]]},
              ].map(sec=>(
                <div key={sec.titulo} style={{marginBottom:20}}>
                  <div style={{fontSize:10,color:"#00C4B4",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #1A2035"}}>{sec.titulo}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {sec.campos.filter(([,v])=>v).map(([k,v])=>(
                      <div key={k} style={{background:"#0D1320",borderRadius:10,padding:"10px 14px",gridColumn:["Evolución","Incidencias","Observaciones"].includes(k)?"1/-1":undefined}}>
                        <div style={{fontSize:11,color:"#4B5563",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{k}</div>
                        <div style={{fontSize:14,color:"#E8EAF0",lineHeight:1.5}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SEDES ─────────────────────────────────────────────────────
function Sedes() {
  const [sedes, setSedes] = useState([]);
  const [resumen, setResumen] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    Promise.all([
      supabase.from("sedes").select("*"),
      supabase.from("vista_resumen_sedes").select("*"),
    ]).then(([{data:s},{data:r}])=>{ setSedes(s||[]); setResumen(r||[]); setLoading(false); });
  },[]);

  if(loading) return <div style={{color:"#4B5563",padding:20}}>Cargando...</div>;

  return (
    <div>
      <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:8}}>Sedes</h1>
      <p style={{color:"#4B5563",fontSize:14,marginBottom:24}}>Gestión de las {sedes.length} sedes operativas</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16}}>
        {sedes.map(sede=>{
          const r = resumen.find(x=>x.sede_id===sede.id)||{};
          return (
            <Card key={sede.id} style={{borderTop:`3px solid ${getColor(sede.nombre)}`}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div style={{width:42,height:42,borderRadius:12,background:`${getColor(sede.nombre)}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🏥</div>
                <div>
                  <div style={{fontWeight:700,fontSize:16,color:"#E8EAF0"}}>OxyNatur {sede.nombre}</div>
                  <div style={{fontSize:12,color:"#6B7280"}}>{sede.direccion||"Sin dirección"}</div>
                </div>
                <span style={{marginLeft:"auto"}}><Badge color={sede.estado==="activa"?"#10B981":"#F87171"}>{sede.estado}</Badge></span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {[
                  {l:"Pac. activos", v:r.pacientes_activos||0, c:getColor(sede.nombre)},
                  {l:"Ses. hoy",     v:r.sesiones_hoy||0,     c:"#7C6AF7"},
                  {l:"Cámaras OK",  v:r.camaras_operativas||0,c:"#10B981"},
                ].map((it,j)=>(
                  <div key={j} style={{background:"#0D1320",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:20,fontWeight:700,color:it.c}}>{it.v}</div>
                    <div style={{fontSize:10,color:"#6B7280",marginTop:2}}>{it.l}</div>
                  </div>
                ))}
              </div>
              {sede.telefono && <div style={{marginTop:12,fontSize:12,color:"#6B7280"}}>📞 {sede.telefono}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── FINANZAS ──────────────────────────────────────────────────
function Finanzas() {
  const [ingresos, setIngresos] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(()=>{
    supabase.from("vista_ingresos_mensual").select("*")
      .then(({data})=>{ setIngresos(data||[]); setLoading(false); });
  },[]);

  const totalIngresos = ingresos.reduce((a,r)=>a+Number(r.ingresos||0),0);
  const totalEgresos  = ingresos.reduce((a,r)=>a+Number(r.egresos||0),0);

  return (
    <div>
      <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:8}}>Finanzas</h1>
      <p style={{color:"#4B5563",fontSize:14,marginBottom:24}}>Resumen financiero por sede y mes</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Ingresos totales", val:`S/ ${totalIngresos.toLocaleString()}`, color:"#10B981"},
          {label:"Egresos totales",  val:`S/ ${totalEgresos.toLocaleString()}`,  color:"#F87171"},
          {label:"Utilidad neta",    val:`S/ ${(totalIngresos-totalEgresos).toLocaleString()}`, color:"#00C4B4"},
        ].map((k,i)=>(
          <Card key={i}>
            <div style={{fontSize:12,color:"#6B7280",marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.color}}>{k.val}</div>
          </Card>
        ))}
      </div>
      {loading ? <div style={{color:"#4B5563"}}>Cargando...</div>
        : ingresos.length===0
          ? <Card style={{textAlign:"center",padding:"40px"}}><div style={{color:"#6B7280"}}>Sin movimientos registrados aún</div></Card>
          : <Card>
              <div style={{fontSize:13,fontWeight:700,color:"#6B7280",marginBottom:16,letterSpacing:"0.06em",textTransform:"uppercase"}}>Detalle por sede y mes</div>
              {ingresos.map((r,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",padding:"10px 0",borderTop:"1px solid #1A2035",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:getColor(r.sede),display:"inline-block"}}/>
                    <span style={{fontSize:13,color:"#E8EAF0"}}>{r.sede}</span>
                  </div>
                  <div style={{fontSize:13,color:"#9CA3AF"}}>{new Date(r.mes).toLocaleDateString("es-PE",{month:"long",year:"numeric"})}</div>
                  <div style={{fontSize:13,color:"#9CA3AF"}}>{r.metodo_pago||"—"}</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#10B981"}}>S/ {Number(r.ingresos||0).toLocaleString()}</div>
                </div>
              ))}
            </Card>
      }
    </div>
  );
}

// ── USUARIOS ──────────────────────────────────────────────────
function Usuarios({perfil:adminPerfil}) {
  const [usuarios, setUsuarios] = useState([]);
  const [sedes, setSedes]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState({email:"",password:"",nombre:"",rol:"enfermero",sede_id:""});
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState("");

  const load = async () => {
    setLoading(true);
    const {data} = await supabase.from("perfiles").select("*, sedes(nombre)");
    setUsuarios(data||[]); setLoading(false);
  };

  useEffect(()=>{
    load();
    supabase.from("sedes").select("id,nombre").then(({data})=>setSedes(data||[]));
  },[]);

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const crear = async () => {
    if(!form.email||!form.password||!form.nombre){setMsg("Completa todos los campos requeridos");return;}
    setSaving(true); setMsg("");
    const {error} = await supabase.auth.signUp({
      email:form.email, password:form.password,
      options:{data:{nombre:form.nombre, rol:form.rol, sede_id:form.sede_id||null}}
    });
    if(error){setMsg("Error: "+error.message);setSaving(false);return;}
    setSaving(false); setModal(false);
    setForm({email:"",password:"",nombre:"",rol:"enfermero",sede_id:""});
    setMsg(""); load();
  };

  const rolColor = {admin_general:"#00C4B4",admin_sede:"#7C6AF7",medico:"#F59E0B",enfermero:"#10B981"};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Usuarios</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>{usuarios.length} usuarios registrados</p>
        </div>
        <Btn onClick={()=>setModal(true)}>+ Nuevo Usuario</Btn>
      </div>
      {loading ? <div style={{color:"#4B5563"}}>Cargando...</div>
        : <Card>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr 1.2fr",padding:"0 0 12px",fontSize:11,color:"#4B5563",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Usuario</span><span>Email</span><span>Rol</span><span>Sede</span>
            </div>
            {usuarios.map(u=>(
              <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr 1.2fr",padding:"12px 0",borderTop:"1px solid #1A2035",alignItems:"center"}}>
                <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{u.nombre}</div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{u.email}</div>
                <div><Badge color={rolColor[u.rol]||"#6B7280"}>{u.rol}</Badge></div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{u.sedes?.nombre||"Todas"}</div>
              </div>
            ))}
          </Card>
      }
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:440,padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>Nuevo Usuario</div>
              <button onClick={()=>setModal(false)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            {msg && <div style={{background:"#F8717115",border:"1px solid #F8717140",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#F87171"}}>{msg}</div>}
            <Input label="Nombre completo" value={form.nombre} onChange={v=>setF("nombre",v)} required/>
            <Input label="Email" value={form.email} onChange={v=>setF("email",v)} type="email" required/>
            <Input label="Contraseña temporal" value={form.password} onChange={v=>setF("password",v)} type="password" required/>
            <Select label="Rol" value={form.rol} onChange={v=>setF("rol",v)} required
              options={[{value:"medico",label:"Médico"},{value:"enfermero",label:"Enfermero"}]}/>
            <Select label="Sede asignada" value={form.sede_id} onChange={v=>setF("sede_id",v)} required
              options={sedes.map(s=>({value:s.id,label:s.nombre}))}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:8}}>
              <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
              <Btn onClick={crear} disabled={saving}>{saving?"Creando...":"Crear Usuario"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AGENDA MÉDICO / ENFERMERO ─────────────────────────────────
function AgendaMedico({perfil}) {
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let q = supabase.from("vista_agenda_hoy").select("*");
    if(perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
    q.then(({data})=>{ setAgenda(data||[]); setLoading(false); });
  },[]);

  const estadoColor = {programada:"#F59E0B",en_curso:"#00C4B4",completada:"#10B981",cancelada:"#F87171",no_asistio:"#6B7280"};

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>
          {perfil?.rol==="medico" ? "Mi Agenda" : "Agenda del día"}
        </h1>
        <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>
          {new Date().toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long"})}
        </p>
      </div>
      {loading
        ? <div style={{color:"#4B5563"}}>Cargando agenda...</div>
        : agenda.length===0
          ? <Card style={{textAlign:"center",padding:"50px"}}><div style={{fontSize:40,marginBottom:12,opacity:.3}}>📅</div><div style={{color:"#6B7280"}}>Sin sesiones programadas para hoy</div></Card>
          : agenda.map(s=>(
            <Card key={s.id} style={{marginBottom:10,display:"flex",alignItems:"center",gap:16}}>
              <div style={{background:"#1A2035",borderRadius:12,padding:"10px 16px",textAlign:"center",minWidth:70}}>
                <div style={{fontSize:18,fontWeight:700,color:"#00C4B4",fontFamily:"Syne,sans-serif"}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:15,color:"#E8EAF0"}}>{s.paciente}</div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>DNI: {s.dni} · Sesión #{s.numero_sesion} · Cámara {s.camara||"—"}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {!s.hc_completada && <Badge color="#F59E0B">⚠ Sin HC</Badge>}
                <Badge color={estadoColor[s.estado]||"#6B7280"}>{s.estado}</Badge>
              </div>
            </Card>
          ))
      }
    </div>
  );
}

// ── SESIONES (placeholder) ────────────────────────────────────
function Sesiones({perfil}) {
  return (
    <div>
      <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:8}}>Sesiones</h1>
      <p style={{color:"#4B5563",fontSize:14,marginBottom:24}}>Gestión de sesiones hiperbáricas</p>
      <Card style={{textAlign:"center",padding:"60px 20px"}}>
        <div style={{fontSize:48,marginBottom:16,opacity:.3}}>⚡</div>
        <div style={{color:"#6B7280",fontSize:16,marginBottom:8}}>Módulo en construcción</div>
        <div style={{color:"#4B5563",fontSize:13}}>Próximamente: programar sesiones, marcar como completadas y vincular HC</div>
      </Card>
    </div>
  );
}

// ── APP PRINCIPAL ─────────────────────────────────────────────
export default function App() {
  const [user,    setUser]    = useState(null);
  const [perfil,  setPerfil]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [vista,   setVista]   = useState("dashboard");

  useEffect(()=>{
    let mounted = true;

    const loadPerfil = async (userId) => {
      try {
        const {data, error} = await supabase.from("perfiles").select("*").eq("id", userId).single();
        if(error) throw error;
        return data;
      } catch(e) {
        console.error("Error cargando perfil:", e);
        return null;
      }
    };

    const {data:{subscription}} = supabase.auth.onAuthStateChange(async (event, session) => {
      if(!mounted) return;
      console.log("Auth event:", event);

      if(event === "SIGNED_OUT" || !session) {
        setUser(null);
        setPerfil(null);
        setLoading(false);
        return;
      }

      if(["SIGNED_IN","TOKEN_REFRESHED","INITIAL_SESSION"].includes(event)) {
        if(session?.user) {
          const p = await loadPerfil(session.user.id);
          if(mounted) {
            setUser(session.user);
            setPerfil(p);
            const defaultVista = p?.rol === "admin_general" ? "dashboard"
              : p?.rol === "medico" ? "pacientes" : "agenda";
            setVista(defaultVista);
            setLoading(false);
          }
        } else {
          if(mounted) setLoading(false);
        }
      }
    });

    // Timeout de seguridad: si en 8 segundos no resuelve, fuerza login
    const timeout = setTimeout(() => {
      if(mounted) setLoading(false);
    }, 8000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleLogin = ({perfil:p,...u})=>{
    setUser(u);
    setPerfil(p);
    const defaultVista = p?.rol === "admin_general" ? "dashboard"
      : p?.rol === "medico" ? "pacientes" : "agenda";
    setVista(defaultVista);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setPerfil(null);
    setVista("dashboard");
  };

  if(loading) return <Spinner/>;
  if(!user)   return <Login onLogin={handleLogin}/>;

  const renderVista = () => {
    switch(vista){
      case "dashboard": return <DashboardAdmin/>;
      case "pacientes": return <Pacientes perfil={perfil}/>;
      case "historias": return <HistoriasClinicas perfil={perfil}/>;
      case "finanzas":  return <Finanzas/>;
      case "sedes":     return <Sedes/>;
      case "usuarios":  return <Usuarios perfil={perfil}/>;
      case "sesiones":  return <Sesiones perfil={perfil}/>;
      case "agenda":    return <AgendaMedico perfil={perfil}/>;
      default:          return <DashboardAdmin/>;
    }
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#080C18",minHeight:"100vh",color:"#E8EAF0",width:"100%"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#1E2535;border-radius:3px}select option{background:#1A2035}input::placeholder{color:#4B5563}textarea::placeholder{color:#4B5563}textarea{box-sizing:border-box}`}</style>
      <div style={{display:"flex",minHeight:"100vh",width:"100%"}}>
        <Sidebar vista={vista} setVista={setVista} perfil={perfil} onLogout={handleLogout}/>
        <div style={{flex:1,overflow:"auto",padding:"28px 40px"}}>
          {renderVista()}
        </div>
      </div>
    </div>
  );
}
 
 
