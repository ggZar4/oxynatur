import { useState, useEffect, createContext, useContext } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────
// FIX BUG 2: env vars obligatorias, sin fallback. Si faltan, fallamos ruidoso.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  const faltantes = [
    !SUPABASE_URL && "VITE_SUPABASE_URL",
    !SUPABASE_KEY && "VITE_SUPABASE_ANON_KEY",
  ].filter(Boolean).join(", ");
  throw new Error(
    `[OxyNatur] Faltan variables de entorno: ${faltantes}. ` +
    `Configúralas en Vercel (Settings → Environment Variables) ` +
    `y en .env.local para desarrollo.`
  );
}

// FIX BUG 6: lock huérfano de auth-token.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: async (_name, _acquireTimeout, fn) => {
      return await fn();
    },
  },
});

// ── Helpers para queries de Supabase ──────────────────────────
async function safeQuery(queryFn, contexto = "query") {
  try {
    const result = await queryFn();
    if (result?.error) {
      console.error(`[${contexto}] Error de Supabase:`, result.error);
      return { data: null, error: result.error };
    }
    return { data: result?.data ?? null, error: null };
  } catch (e) {
    console.error(`[${contexto}] Excepción:`, e);
    return { data: null, error: e };
  }
}

function useSupabaseQuery(queryFn, deps = [], contexto = "query") {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    safeQuery(queryFn, contexto).then(({ data, error }) => {
      if (!mounted) return;
      setData(data);
      setError(error);
      setLoading(false);
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refetchTick]);

  const refetch = () => setRefetchTick(t => t + 1);
  return { data, loading, error, refetch };
}

// ── Colores por sede ──────────────────────────────────────────
const SEDE_COLOR = {
  "Molisalud": "#10B981",
  "Clínica San Miguel Arcángel": "#7C6AF7",
};
const getColor = (nombre) => SEDE_COLOR[nombre] || "#00C4B4";

// ── FASE B: Helper central de roles ──────────────────────────
// ÚNICA fuente de verdad para permisos en toda la app.
// Si cambia un rol, se cambia aquí y afecta todo.
// Nunca uses perfil?.rol directamente en los componentes —
// usa siempre los flags que devuelve esta función.
function getRolFlags(perfil) {
  const rol          = perfil?.rol;
  const esEspecialista = perfil?.es_especialista === true;

  const esAdmin      = rol === "admin_general";
  const esMedico     = rol === "medico";
  const esEnfermero  = rol === "enfermero";
  const esMedicoEsp  = esMedico && esEspecialista;   // consultor remoto cross-sede
  const esMedicoSede = esMedico && !esEspecialista;  // médico físico en una sede

  return {
    // ── Identidad ──
    esAdmin,
    esMedico,
    esEnfermero,
    esMedicoEsp,
    esMedicoSede,

    // ── Acceso a módulos ──
    puedeVerDashboard:  esAdmin || esMedico,
    puedeVerVentas:     esAdmin || esEnfermero,  // enfermero registra ventas en mostrador
    puedeVerFinanzas:   esAdmin,
    puedeVerSedes:      esAdmin,
    puedeVerUsuarios:   esAdmin,
    puedeVerAlertas:    esAdmin || esMedico,

    // ── Restricciones dentro de Ventas ──
    ventasSoloSuSede:   esEnfermero,  // enfermero solo ve/registra ventas de su sede

    // ── Acceso a pacientes ──
    puedeCrearPaciente:      esAdmin || esMedico || esEnfermero,
    puedeEditarPaciente:     esAdmin,
    puedeVerTodosPacientes:  esAdmin || esMedicoEsp,

    // ── Acceso a historias clínicas ──
    puedeEscribirProtocolo:    esAdmin || esMedicoEsp,
    puedeEscribirObservacion:  esAdmin || esMedico || esEnfermero,
    puedeVerTodasHC:           esAdmin || esMedicoEsp,

    // ── UI helpers ──
    rolLabel: esAdmin      ? "Admin General"
            : esMedicoEsp  ? "Médico Especialista"
            : esMedicoSede ? "Médico"
            : esEnfermero  ? "Enfermero"
            : "Usuario",

    vistaDefault: esAdmin  ? "dashboard"
                : esMedico ? "alertas"
                : "agenda",
  };
}

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
function Login() {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if(!email||!pass){setError("Completa todos los campos");return;}
    setLoading(true); setError("");
    const {error:e} = await supabase.auth.signInWithPassword({email,password:pass});
    if(e){
      setError("Email o contraseña incorrectos");
      setLoading(false);
      return;
    }
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
// FASE B: Nav completamente dinámico basado en getRolFlags().
// Badge de alertas recibe alertasNuevas como prop desde App.
function Sidebar({vista, setVista, perfil, onLogout, alertasNuevas = 0}) {
  const f = getRolFlags(perfil);

  const navItems = [
    { id:"dashboard", icon:"▦",  label:"Dashboard",         visible: f.puedeVerDashboard },
    { id:"alertas",   icon:"🔔", label:"Alertas Clínicas",  visible: f.puedeVerAlertas,
      badge: alertasNuevas > 0 ? alertasNuevas : null },
    { id:"pacientes", icon:"👤", label:"Pacientes",         visible: true },
    { id:"ventas",    icon:"💵", label:"Ventas",            visible: f.puedeVerVentas },
    { id:"sesiones",  icon:"⚡", label:"Sesiones",          visible: true },
    { id:"historias", icon:"📋", label:"Historias Clínicas", visible: true },
    { id:"finanzas",  icon:"💰", label:"Finanzas",          visible: f.puedeVerFinanzas },
    { id:"sedes",     icon:"📍", label:"Sedes",             visible: f.puedeVerSedes },
    { id:"usuarios",  icon:"👥", label:"Usuarios",          visible: f.puedeVerUsuarios },
    { id:"agenda",    icon:"📅", label:"Agenda",            visible: true },
  ].filter(item => item.visible);

  return (
    <div style={{width:240,background:"#0D1320",borderRight:"1px solid #1E2535",padding:"20px 10px",display:"flex",flexDirection:"column",gap:2,flexShrink:0,minHeight:"100vh"}}>
      <div style={{padding:"0 8px 24px"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:20,color:"#00C4B4",letterSpacing:"-0.03em"}}>OxyNatur</div>
        <div style={{fontSize:10,color:"#374151",marginTop:1,letterSpacing:"0.05em",textTransform:"uppercase"}}>{f.rolLabel}</div>
      </div>
      {navItems.map(item=>(
        <button key={item.id} onClick={()=>setVista(item.id)}
          style={{background:vista===item.id?"linear-gradient(135deg,#00C4B420,#7C6AF720)":"none",border:vista===item.id?"1px solid #00C4B430":"1px solid transparent",cursor:"pointer",padding:"10px 14px",borderRadius:10,color:vista===item.id?"#00C4B4":"#6B7280",fontFamily:"inherit",fontSize:14,fontWeight:500,display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",transition:"all .2s"}}>
          <span style={{fontSize:15}}>{item.icon}</span>
          <span style={{flex:1}}>{item.label}</span>
          {item.badge && (
            <span style={{background:"#F87171",color:"white",borderRadius:99,fontSize:11,fontWeight:700,padding:"1px 7px",minWidth:20,textAlign:"center"}}>
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
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
  const { data: resumen, loading } = useSupabaseQuery(
    () => supabase.from("vista_resumen_sedes").select("*"),
    [],
    "Dashboard:vista_resumen_sedes"
  );
  const filas = resumen || [];

  const totales = {
    pacientes: filas.reduce((a,s)=>a+Number(s.pacientes_activos||0),0),
    sesiones:  filas.reduce((a,s)=>a+Number(s.sesiones_mes||0),0),
    ingresos:  filas.reduce((a,s)=>a+Number(s.ingresos_mes||0),0),
    sesHoy:    filas.reduce((a,s)=>a+Number(s.sesiones_hoy||0),0),
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
        {filas.map(s=>(
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
  const f = getRolFlags(perfil);
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
    const { data } = await safeQuery(() => {
      let q = supabase.from("pacientes").select("*, sedes!sede_principal_id(nombre,color)").order("created_at",{ascending:false});
      // admin_general y médico especialista ven todo; el resto solo su sede
      if(!f.puedeVerTodosPacientes && perfil?.sede_id) q = q.eq("sede_principal_id", perfil.sede_id);
      return q;
    }, "Pacientes:load");
    setPacs(data || []);
    setLoading(false);
  };

  useEffect(()=>{
    let mounted = true;
    (async () => {
      await load();
      const { data: sedesData } = await safeQuery(
        () => supabase.from("sedes").select("id,nombre"),
        "Pacientes:sedes"
      );
      if (mounted) setSedes(sedesData || []);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const filtrados = pacs.filter(p=>{
    const q = busq.toLowerCase();
    return p.nombres?.toLowerCase().includes(q) || p.apellidos?.toLowerCase().includes(q) || p.dni?.includes(q);
  });

  const setF = (k,v) => setForm(fm=>({...fm,[k]:v}));

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
        {/* FASE B: solo roles con permiso ven el botón */}
        {f.puedeCrearPaciente && <Btn onClick={()=>setModal(true)}>+ Nuevo Paciente</Btn>}
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
      {modal && f.puedeCrearPaciente && (
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
  const f = getRolFlags(perfil);
  const [hcs, setHcs]     = useState([]);
  const [sedes, setSedes] = useState([]);
  const [sedeTab, setSedeTab] = useState("todas");
  const [loading, setLoading] = useState(true);
  const [verHC, setVerHC] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("evaluaciones_medicas")
        .select("*, pacientes(nombres,apellidos,dni), sedes(nombre,color), perfiles(nombre)")
        .order("fecha",{ascending:false});
      // admin y especialista ven todo; médico de sede y enfermero solo su sede
      if(!f.puedeVerTodasHC && perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
      return q;
    }, "HistoriasClinicas:load");
    setHcs(data || []);
    setLoading(false);
  };

  useEffect(()=>{
    let mounted = true;
    (async () => {
      await load();
      const { data: sedesData } = await safeQuery(
        () => supabase.from("sedes").select("id,nombre,color"),
        "HistoriasClinicas:sedes"
      );
      if (mounted) setSedes(sedesData || []);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const filtradas = sedeTab==="todas" ? hcs : hcs.filter(h=>h.sede_id===sedeTab);
  const dolorColor = (n) => parseInt(n)>=7?"#F87171":parseInt(n)>=4?"#F59E0B":"#10B981";
  const estColor   = (e) => ["Excelente","Bueno"].includes(e)?"#10B981":e==="Regular"?"#F59E0B":"#F87171";

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Historias Clínicas</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>{filtradas.length} evaluaciones</p>
        </div>
      </div>
      {/* Tabs de sede — solo si puede ver todas */}
      {f.puedeVerTodasHC && sedes.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[{id:"todas",nombre:"Todas"},...sedes].map(s=>(
            <button key={s.id} onClick={()=>setSedeTab(s.id)}
              style={{padding:"6px 16px",borderRadius:20,border:"1px solid",fontSize:13,cursor:"pointer",fontFamily:"inherit",
                borderColor:sedeTab===s.id?"#00C4B4":"#2A3550",
                background:sedeTab===s.id?"#00C4B415":"none",
                color:sedeTab===s.id?"#00C4B4":"#6B7280"}}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}
      {loading
        ? <div style={{color:"#4B5563",padding:20}}>Cargando...</div>
        : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 0.5fr",padding:"0 18px 10px",fontSize:11,color:"#4B5563",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Paciente</span><span>Sede</span><span>Fecha</span><span>Dolor</span><span>Estado</span><span></span>
            </div>
            {filtradas.map(hc=>(
              <div key={hc.id} style={{background:"#111827",border:"1px solid #1E2535",borderRadius:12,padding:"14px 18px",marginBottom:8,display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 0.5fr",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{hc.pacientes?.nombres} {hc.pacientes?.apellidos}</div>
                  <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>DNI: {hc.pacientes?.dni} · Sesión #{hc.numero_sesion}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:getColor(hc.sedes?.nombre),display:"inline-block"}}/>
                  <span style={{fontSize:13,color:"#E8EAF0"}}>{hc.sedes?.nombre||"—"}</span>
                </div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{hc.fecha}</div>
                <div><Badge color={dolorColor(hc.nivel_dolor)}>{hc.nivel_dolor}/10</Badge></div>
                <div><Badge color={estColor(hc.estado_general)}>{hc.estado_general}</Badge></div>
                <div><button onClick={()=>setVerHC(hc)} style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Ver</button></div>
              </div>
            ))}
            {filtradas.length===0 && <div style={{color:"#4B5563",textAlign:"center",padding:"40px 0",fontSize:14}}>No hay evaluaciones registradas</div>}
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
    let mounted = true;
    (async () => {
      const [r1, r2] = await Promise.all([
        safeQuery(() => supabase.from("sedes").select("*"), "Sedes:sedes"),
        safeQuery(() => supabase.from("vista_resumen_sedes").select("*"), "Sedes:resumen"),
      ]);
      if (!mounted) return;
      setSedes(r1.data || []);
      setResumen(r2.data || []);
      setLoading(false);
    })();
    return () => { mounted = false; };
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
  const { data: ingresosData, loading } = useSupabaseQuery(
    () => supabase.from("vista_ingresos_mensual").select("*"),
    [],
    "Finanzas:vista_ingresos_mensual"
  );
  const ingresos = ingresosData || [];
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
  const [form, setForm]         = useState({email:"",password:"",nombre:"",rol:"enfermero",sede_id:"",es_especialista:false});
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(
      () => supabase.from("perfiles").select("*, sedes(nombre)"),
      "Usuarios:load"
    );
    setUsuarios(data || []);
    setLoading(false);
  };

  useEffect(()=>{
    let mounted = true;
    (async () => {
      await load();
      const { data: sedesData } = await safeQuery(
        () => supabase.from("sedes").select("id,nombre"),
        "Usuarios:sedes"
      );
      if (mounted) setSedes(sedesData || []);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const crear = async () => {
    if(!form.email||!form.password||!form.nombre){setMsg("Completa todos los campos requeridos");return;}
    setSaving(true); setMsg("");
    const {error} = await supabase.auth.signUp({
      email:form.email, password:form.password,
      options:{data:{
        nombre:form.nombre,
        rol:form.rol,
        sede_id: form.rol==="medico" && form.es_especialista ? null : (form.sede_id||null),
        es_especialista: form.rol==="medico" ? form.es_especialista : false,
      }}
    });
    if(error){setMsg("Error: "+error.message);setSaving(false);return;}
    setSaving(false); setModal(false);
    setForm({email:"",password:"",nombre:"",rol:"enfermero",sede_id:"",es_especialista:false});
    setMsg(""); load();
  };

  const rolColor = {admin_general:"#00C4B4",admin_sede:"#7C6AF7",medico:"#F59E0B",enfermero:"#10B981"};
  const rolLabel = (u) => {
    if(u.rol === "medico" && u.es_especialista) return "Médico Especialista";
    if(u.rol === "medico") return "Médico";
    if(u.rol === "admin_general") return "Admin General";
    if(u.rol === "enfermero") return "Enfermero";
    return u.rol;
  };

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
            <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1.2fr 1fr",padding:"0 0 12px",fontSize:11,color:"#4B5563",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Usuario</span><span>Email</span><span>Rol</span><span>Sede</span>
            </div>
            {usuarios.map(u=>(
              <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1.2fr 1fr",padding:"12px 0",borderTop:"1px solid #1A2035",alignItems:"center"}}>
                <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{u.nombre}</div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{u.email}</div>
                <div><Badge color={rolColor[u.rol]||"#6B7280"}>{rolLabel(u)}</Badge></div>
                <div style={{fontSize:13,color:"#9CA3AF"}}>{u.sedes?.nombre||"Todas las sedes"}</div>
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
            {/* Si es médico, mostrar opción especialista */}
            {form.rol === "medico" && (
              <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#1A2035",borderRadius:10,border:"1px solid #2A3550"}}>
                <input type="checkbox" id="esEsp" checked={form.es_especialista}
                  onChange={e=>setF("es_especialista",e.target.checked)}
                  style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="esEsp" style={{fontSize:14,color:"#E8EAF0",cursor:"pointer"}}>
                  Médico Especialista <span style={{fontSize:12,color:"#6B7280"}}>(acceso cross-sede, sin sede fija)</span>
                </label>
              </div>
            )}
            {/* Sede solo si NO es especialista */}
            {!(form.rol === "medico" && form.es_especialista) && (
              <Select label="Sede asignada" value={form.sede_id} onChange={v=>setF("sede_id",v)} required
                options={sedes.map(s=>({value:s.id,label:s.nombre}))}/>
            )}
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
  const f = getRolFlags(perfil);
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let mounted = true;
    (async () => {
      const { data } = await safeQuery(() => {
        let q = supabase.from("vista_agenda_hoy").select("*");
        if(perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
        return q;
      }, "AgendaMedico:vista_agenda_hoy");
      if (!mounted) return;
      setAgenda(data || []);
      setLoading(false);
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const estadoColor = {programada:"#F59E0B",en_curso:"#00C4B4",completada:"#10B981",cancelada:"#F87171",no_asistio:"#6B7280"};

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>
          {f.esMedico ? "Mi Agenda" : "Agenda del día"}
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

// ── VENTAS ────────────────────────────────────────────────────
function Ventas({perfil}) {
  const f = getRolFlags(perfil);
  // Enfermero solo ve su sede; admin ve todo
  const sedeFija = f.ventasSoloSuSede ? perfil?.sede_id : null;

  const { data: pacientesData } = useSupabaseQuery(
    () => {
      let q = supabase.from("pacientes").select("id,nombres,apellidos,dni").order("apellidos");
      if(sedeFija) q = q.eq("sede_principal_id", sedeFija);
      return q;
    },
    [], "Ventas:pacientes"
  );
  const { data: paquetesData } = useSupabaseQuery(
    () => supabase.from("paquetes").select("*").eq("activo", true).order("cantidad_sesiones"),
    [], "Ventas:paquetes"
  );
  const { data: sedesData } = useSupabaseQuery(
    () => {
      let q = supabase.from("sedes").select("id,nombre").eq("estado", "activa");
      if(sedeFija) q = q.eq("id", sedeFija);
      return q;
    },
    [], "Ventas:sedes"
  );

  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(true);

  const loadVentas = async () => {
    setLoadingVentas(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("compras_paciente")
        .select(`
          id, fecha_compra, monto_pagado, precio_sugerido, descuento_pct,
          promo_aplicada, metodo_pago, notas, numero_comprobante, comprobante_url,
          pacientes(nombres,apellidos,dni),
          paquetes(codigo,nombre),
          sedes(nombre,color)
        `)
        .order("fecha_compra", {ascending:false})
        .limit(50);
      if(sedeFija) q = q.eq("sede_id", sedeFija);
      return q;
    }, "Ventas:loadVentas");
    setVentas(data || []);
    setLoadingVentas(false);
  };

  useEffect(()=>{ loadVentas(); }, []); // eslint-disable-line

  const formInicial = {
    paciente_id:"", sede_id: sedeFija || "", paquete_id:"",
    monto_pagado:"", metodo_pago:"efectivo", notas:"",
    numero_comprobante:"", fotoFile: null, fotoPreview: null,
  };
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState(formInicial);
  const [calculo, setCalculo]   = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // "subiendo" | null
  const [err, setErr]           = useState({});

  // Cálculo automático de precio al cambiar paquete
  useEffect(()=>{
    let mounted = true;
    if(!form.paquete_id) { setCalculo(null); return; }
    setCalculando(true);
    (async()=>{
      const { data } = await safeQuery(
        () => supabase.rpc("calcular_precio", {
          p_paquete_id: form.paquete_id,
          p_fecha: new Date().toISOString().slice(0,10),
        }), "Ventas:calcular_precio"
      );
      if(!mounted) return;
      const desglose = Array.isArray(data) && data[0] ? data[0] : null;
      setCalculo(desglose);
      if(desglose) setForm(f=>({...f, monto_pagado: String(desglose.precio_final)}));
      setCalculando(false);
    })();
    return ()=>{ mounted = false; };
  }, [form.paquete_id]);

  const openModal = () => { setForm(formInicial); setCalculo(null); setErr({}); setModal(true); };

  const handleFoto = (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setForm(f=>({...f, fotoFile: file, fotoPreview: URL.createObjectURL(file)}));
  };

  const validar = () => {
    const e = {};
    if(!form.paciente_id)          e.paciente_id        = "Selecciona un paciente";
    if(!form.sede_id)               e.sede_id            = "Selecciona la sede";
    if(!form.paquete_id)            e.paquete_id         = "Selecciona un paquete";
    if(!form.numero_comprobante.trim()) e.numero_comprobante = "El número de comprobante es obligatorio";
    if(!form.monto_pagado || isNaN(Number(form.monto_pagado)) || Number(form.monto_pagado) <= 0)
      e.monto_pagado = "Monto inválido";
    if(calculo && Number(form.monto_pagado) < Number(calculo.precio_final) && !form.notas.trim())
      e.notas = "Obligatorio cuando el monto cobrado es menor al sugerido";
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const guardar = async () => {
    if(!validar()) return;
    setSaving(true);

    // 1. Upload foto si existe
    let comprobante_url = null;
    if(form.fotoFile) {
      setUploadProgress("subiendo");
      const ext  = form.fotoFile.name.split(".").pop();
      const path = `${form.sede_id}/${Date.now()}_${form.numero_comprobante.replace(/\s/g,"_")}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage
        .from("comprobantes")
        .upload(path, form.fotoFile, { upsert: false });
      setUploadProgress(null);
      if(upErr) {
        alert("Error subiendo foto: " + upErr.message);
        setSaving(false);
        return;
      }
      // Generar signed URL de 10 años (~315 millones de segundos)
      const { data: signed } = await supabase.storage
        .from("comprobantes")
        .createSignedUrl(upData.path, 315_360_000);
      comprobante_url = signed?.signedUrl || null;
    }

    // 2. Insert en compras_paciente
    const paquete = paquetesData?.find(p => p.id === form.paquete_id);
    const fechaVencimiento = paquete?.vigencia_dias > 0
      ? new Date(Date.now() + paquete.vigencia_dias*24*60*60*1000).toISOString().slice(0,10)
      : null;
    const payload = {
      paciente_id:        form.paciente_id,
      paquete_id:         form.paquete_id,
      sede_id:            form.sede_id,
      fecha_compra:       new Date().toISOString().slice(0,10),
      monto_pagado:       Number(form.monto_pagado),
      precio_sugerido:    calculo?.precio_final ? Number(calculo.precio_final) : null,
      promo_aplicada:     calculo?.promo_aplicada || null,
      descuento_pct:      calculo?.descuento_pct ? Number(calculo.descuento_pct) : 0,
      metodo_pago:        form.metodo_pago,
      sesiones_totales:   paquete?.cantidad_sesiones || 1,
      sesiones_usadas:    0,
      fecha_vencimiento:  fechaVencimiento,
      estado:             "activa",
      registrado_por:     perfil?.id,
      notas:              form.notas.trim() || null,
      numero_comprobante: form.numero_comprobante.trim(),
      comprobante_url,
    };
    const { error } = await safeQuery(
      () => supabase.from("compras_paciente").insert(payload), "Ventas:insert"
    );
    setSaving(false);
    if(error) { alert("Error al guardar la venta: " + (error.message || "ver consola")); return; }
    setModal(false);
    loadVentas();
  };

  const hoyMes      = new Date().toISOString().slice(0,7);
  const ventasMes   = ventas.filter(v => (v.fecha_compra||"").startsWith(hoyMes));
  const totalMes    = ventasMes.reduce((a,v)=>a+Number(v.monto_pagado||0), 0);
  const descuentosMes = ventasMes.reduce((a,v)=>a+Math.max(Number(v.precio_sugerido||0)-Number(v.monto_pagado||0),0), 0);
  const fmtSol = (n) => `S/ ${Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:4}}>Ventas</h1>
          <p style={{color:"#4B5563",fontSize:13}}>
            {sedeFija ? `Ventas de tu sede` : "Registro de paquetes y sesiones vendidas"}
          </p>
        </div>
        <Btn onClick={openModal}>+ Nueva venta</Btn>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
        <Card>
          <div style={{fontSize:12,color:"#6B7280",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>Ventas del mes</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#00C4B4",marginTop:8}}>{fmtSol(totalMes)}</div>
          <div style={{fontSize:11,color:"#4B5563",marginTop:4}}>{ventasMes.length} ventas</div>
        </Card>
        <Card>
          <div style={{fontSize:12,color:"#6B7280",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>Descuentos otorgados</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#F59E0B",marginTop:8}}>{fmtSol(descuentosMes)}</div>
          <div style={{fontSize:11,color:"#4B5563",marginTop:4}}>diferencia sugerido vs cobrado</div>
        </Card>
        <Card>
          <div style={{fontSize:12,color:"#6B7280",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>Total registrado</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#7C6AF7",marginTop:8}}>{ventas.length}</div>
          <div style={{fontSize:11,color:"#4B5563",marginTop:4}}>últimos 50 movimientos</div>
        </Card>
      </div>

      {/* Tabla */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",fontSize:13,fontWeight:700,color:"#9CA3AF",letterSpacing:"0.05em",textTransform:"uppercase"}}>Últimas ventas</div>
        {loadingVentas ? (
          <div style={{padding:40,textAlign:"center",color:"#4B5563"}}>Cargando...</div>
        ) : ventas.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:"#4B5563"}}>No hay ventas registradas</div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"#0D1320"}}>
                  {["Fecha","Comprobante","Paciente","Paquete","Pagado","Método","Doc"].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"11px 14px",fontSize:11,fontWeight:700,color:"#6B7280",letterSpacing:"0.05em",textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ventas.map(v=>{
                  const sug = Number(v.precio_sugerido||0);
                  const pag = Number(v.monto_pagado||0);
                  const conDesc = sug > 0 && pag < sug;
                  return (
                    <tr key={v.id} style={{borderTop:"1px solid #1E2535"}}>
                      <td style={{padding:"11px 14px",fontSize:13,color:"#9CA3AF"}}>{v.fecha_compra}</td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"#E8EAF0",fontWeight:600}}>
                        {v.numero_comprobante || <span style={{color:"#4B5563"}}>—</span>}
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"#E8EAF0"}}>
                        {v.pacientes ? `${v.pacientes.nombres} ${v.pacientes.apellidos}` : "—"}
                        {v.pacientes?.dni && <div style={{fontSize:11,color:"#4B5563"}}>DNI {v.pacientes.dni}</div>}
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"#E8EAF0"}}>
                        {v.paquetes?.codigo || "—"}
                        <div style={{fontSize:11,color:"#4B5563"}}>{v.paquetes?.nombre}</div>
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,fontWeight:600,color:conDesc?"#F59E0B":"#00C4B4"}}>{fmtSol(pag)}</td>
                      <td style={{padding:"11px 14px",fontSize:12,color:"#6B7280"}}>{v.metodo_pago}</td>
                      <td style={{padding:"11px 14px"}}>
                        {v.comprobante_url
                          ? <a href={v.comprobante_url} target="_blank" rel="noreferrer"
                              style={{fontSize:12,color:"#00C4B4",textDecoration:"none"}}>Ver 📎</a>
                          : <span style={{fontSize:12,color:"#374151"}}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal nueva venta */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}>
          <div style={{background:"#0D1320",border:"1px solid #1E2535",borderRadius:14,maxWidth:540,width:"100%",maxHeight:"92vh",overflowY:"auto",padding:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:700,color:"#E8EAF0"}}>Nueva venta</div>
              <button onClick={()=>setModal(false)} style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            <Select label="Paciente" value={form.paciente_id} onChange={v=>setForm({...form,paciente_id:v})}
              options={(pacientesData||[]).map(p=>({value:p.id,label:`${p.apellidos}, ${p.nombres}${p.dni?` — DNI ${p.dni}`:""}`}))} required/>
            {err.paciente_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.paciente_id}</div>}

            {/* Sede: fija para enfermero, seleccionable para admin */}
            {sedeFija
              ? <div style={{marginBottom:14,padding:"10px 14px",background:"#1A2035",borderRadius:10,fontSize:14,color:"#9CA3AF"}}>
                  Sede: <strong style={{color:"#E8EAF0"}}>{sedesData?.[0]?.nombre || "Tu sede"}</strong>
                </div>
              : <>
                  <Select label="Sede" value={form.sede_id} onChange={v=>setForm({...form,sede_id:v})}
                    options={(sedesData||[]).map(s=>({value:s.id,label:s.nombre}))} required/>
                  {err.sede_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.sede_id}</div>}
                </>
            }

            <Select label="Paquete" value={form.paquete_id} onChange={v=>setForm({...form,paquete_id:v})}
              options={(paquetesData||[]).map(p=>({value:p.id,label:`${p.codigo} — ${p.nombre} — ${fmtSol(p.precio_total)}`}))} required/>
            {err.paquete_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.paquete_id}</div>}

            {calculando && <div style={{padding:14,background:"#0A0F1F",borderRadius:10,fontSize:13,color:"#6B7280",marginBottom:14}}>Calculando precio...</div>}
            {calculo && !calculando && (
              <div style={{padding:14,background:"#0A0F1F",border:"1px solid #1E2535",borderRadius:10,marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#9CA3AF",marginBottom:6}}>
                  <span>Precio base</span><span>{fmtSol(calculo.precio_base)}</span>
                </div>
                {calculo.promo_aplicada && (
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#7C6AF7",marginBottom:6}}>
                    <span>{calculo.promo_aplicada} (-{calculo.descuento_pct}%)</span>
                    <span>-{fmtSol(Number(calculo.precio_base)-Number(calculo.precio_final))}</span>
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,color:"#00C4B4",borderTop:"1px solid #1E2535",paddingTop:8,marginTop:8}}>
                  <span>Sugerido</span><span>{fmtSol(calculo.precio_final)}</span>
                </div>
              </div>
            )}

            <Input label="Monto cobrado (S/)" type="number" value={form.monto_pagado}
              onChange={v=>setForm({...form,monto_pagado:v})} placeholder="0.00" required error={err.monto_pagado}/>
            {calculo && form.monto_pagado && Number(form.monto_pagado) !== Number(calculo.precio_final) && (
              <div style={{padding:"8px 12px",background:Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B20":"#00C4B420",border:`1px solid ${Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B40":"#00C4B440"}`,borderRadius:8,fontSize:12,color:"#E8EAF0",marginBottom:14}}>
                {Number(form.monto_pagado)<Number(calculo.precio_final)
                  ?`Cobrando ${fmtSol(Number(calculo.precio_final)-Number(form.monto_pagado))} menos del sugerido. Anota la razón abajo.`
                  :`Cobrando ${fmtSol(Number(form.monto_pagado)-Number(calculo.precio_final))} más del sugerido.`}
              </div>
            )}

            <Select label="Método de pago" value={form.metodo_pago} onChange={v=>setForm({...form,metodo_pago:v})}
              options={[{value:"efectivo",label:"Efectivo"},{value:"transferencia",label:"Transferencia"},{value:"tarjeta",label:"Tarjeta"},{value:"yape",label:"Yape / Plin"},{value:"otro",label:"Otro"}]}/>

            {/* Número de comprobante — OBLIGATORIO */}
            <Input label="N° de comprobante (boleta/factura)" value={form.numero_comprobante}
              onChange={v=>setForm({...form,numero_comprobante:v})}
              placeholder="Ej: B001-00123" required error={err.numero_comprobante}/>

            {/* Upload foto del comprobante — OPCIONAL */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>
                Foto del comprobante <span style={{color:"#4B5563",fontWeight:400}}>(opcional)</span>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,cursor:"pointer"}}>
                <span style={{fontSize:18}}>📷</span>
                <span style={{fontSize:13,color:"#6B7280"}}>
                  {form.fotoFile ? form.fotoFile.name : "Toca para adjuntar foto"}
                </span>
                <input type="file" accept="image/*" capture="environment"
                  onChange={handleFoto} style={{display:"none"}}/>
              </label>
              {form.fotoPreview && (
                <div style={{marginTop:8,position:"relative",display:"inline-block"}}>
                  <img src={form.fotoPreview} alt="preview" style={{width:120,height:80,objectFit:"cover",borderRadius:8,border:"1px solid #2A3550"}}/>
                  <button onClick={()=>setForm(f=>({...f,fotoFile:null,fotoPreview:null}))}
                    style={{position:"absolute",top:-6,right:-6,background:"#F87171",border:"none",borderRadius:"50%",width:18,height:18,color:"white",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              )}
            </div>

            {/* Notas */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:err.notas?"#F87171":"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>
                Notas {calculo&&form.monto_pagado&&Number(form.monto_pagado)<Number(calculo.precio_final)&&<span style={{color:"#F87171"}}> *</span>}
              </label>
              <textarea value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})}
                placeholder="Razón del descuento, paciente referido, observaciones..."
                style={{width:"100%",background:"#1A2035",border:`1px solid ${err.notas?"#F87171":"#2A3550"}`,borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",minHeight:60,resize:"vertical"}}/>
              {err.notas && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{err.notas}</div>}
            </div>

            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
              <Btn variant="ghost" onClick={()=>setModal(false)} disabled={saving}>Cancelar</Btn>
              <Btn onClick={guardar} disabled={saving||calculando}>
                {uploadProgress==="subiendo" ? "Subiendo foto..." : saving ? "Guardando..." : "Registrar venta"}
              </Btn>
            </div>
          </div>
        </div>
      )}
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

// ── ALERTAS CLÍNICAS ──────────────────────────────────────────
// FASE C: bandeja real con ciclo nueva→vista→resuelta.
// Médico especialista ve todas las sedes.
// Médico de sede ve solo su sede.
// Admin ve todo.
// Enfermero NO accede a este módulo.
function Alertas({perfil}) {
  const f = getRolFlags(perfil);

  const PRIORIDAD_COLOR = { alta:"#F87171", media:"#F59E0B", baja:"#6B7280" };
  const TIPO_LABEL = {
    observacion_critica: "Observación crítica",
    protocolo_pendiente: "Protocolo pendiente",
    seguimiento:         "Seguimiento",
    consulta:            "Consulta",
  };
  const ESTADO_COLOR = { nueva:"#F87171", vista:"#F59E0B", resuelta:"#10B981" };

  const [alertas, setAlertas]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("pendientes"); // pendientes | resuelta | todas
  const [verAlerta, setVerAlerta] = useState(null);  // alerta abierta en modal
  const [respuesta, setRespuesta] = useState("");
  const [saving, setSaving]     = useState(false);
  const [modalNueva, setModalNueva] = useState(false);

  // Form nueva alerta (para admin/médico que la crea manualmente)
  const formInicial = { paciente_id:"", sede_id:"", tipo:"observacion_critica", prioridad:"media", mensaje:"" };
  const [formNueva, setFormNueva] = useState(formInicial);
  const [savingNueva, setSavingNueva] = useState(false);
  const [errNueva, setErrNueva] = useState({});

  // Datos de soporte para el form
  const { data: pacientesData } = useSupabaseQuery(
    () => supabase.from("pacientes").select("id,nombres,apellidos,dni").order("apellidos"),
    [], "Alertas:pacientes"
  );
  const { data: sedesData } = useSupabaseQuery(
    () => supabase.from("sedes").select("id,nombre").eq("estado","activa"),
    [], "Alertas:sedes"
  );

  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("alertas_clinicas")
        .select(`
          id, tipo, prioridad, estado, mensaje, respuesta,
          created_at, respondida_at,
          pacientes(nombres, apellidos, dni),
          sedes(nombre),
          generada_por_perfil:perfiles!generada_por(nombre),
          respondida_por_perfil:perfiles!respondida_por(nombre)
        `)
        .order("created_at", { ascending: false })
        .limit(100);
      return q;
    }, "Alertas:load");
    setAlertas(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  // Marcar como vista automáticamente al abrir
  const abrirAlerta = async (alerta) => {
    setVerAlerta(alerta);
    setRespuesta(alerta.respuesta || "");
    if(alerta.estado === "nueva") {
      await safeQuery(
        () => supabase.from("alertas_clinicas").update({ estado:"vista" }).eq("id", alerta.id),
        "Alertas:marcarVista"
      );
      setAlertas(prev => prev.map(a => a.id === alerta.id ? {...a, estado:"vista"} : a));
    }
  };

  const responder = async () => {
    if(!respuesta.trim()) return;
    setSaving(true);
    const { error } = await safeQuery(
      () => supabase.from("alertas_clinicas").update({
        respuesta: respuesta.trim(),
        estado: "resuelta",
        respondida_por: perfil.id,
        respondida_at: new Date().toISOString(),
      }).eq("id", verAlerta.id),
      "Alertas:responder"
    );
    setSaving(false);
    if(error) { alert("Error al guardar respuesta"); return; }
    setVerAlerta(null);
    load();
  };

  const crearAlerta = async () => {
    const e = {};
    if(!formNueva.paciente_id) e.paciente_id = "Requerido";
    if(!formNueva.sede_id)     e.sede_id     = "Requerido";
    if(!formNueva.mensaje.trim()) e.mensaje  = "Requerido";
    setErrNueva(e);
    if(Object.keys(e).length) return;
    setSavingNueva(true);
    const { error } = await safeQuery(
      () => supabase.from("alertas_clinicas").insert({
        paciente_id:  formNueva.paciente_id,
        sede_id:      formNueva.sede_id,
        generada_por: perfil.id,
        origen:       "manual",
        tipo:         formNueva.tipo,
        prioridad:    formNueva.prioridad,
        mensaje:      formNueva.mensaje.trim(),
        estado:       "nueva",
      }),
      "Alertas:crear"
    );
    setSavingNueva(false);
    if(error) { alert("Error al crear alerta"); return; }
    setModalNueva(false);
    setFormNueva(formInicial);
    setErrNueva({});
    load();
  };

  const alertasFiltradas = alertas.filter(a => {
    if(filtroEstado === "pendientes") return a.estado !== "resuelta";
    if(filtroEstado === "resuelta")   return a.estado === "resuelta";
    return true;
  });

  const countNuevas    = alertas.filter(a => a.estado === "nueva").length;
  const countVistas    = alertas.filter(a => a.estado === "vista").length;
  const countResueltas = alertas.filter(a => a.estado === "resuelta").length;

  const fmtFecha = (iso) => iso
    ? new Date(iso).toLocaleDateString("es-PE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})
    : "—";

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:4}}>
            Alertas Clínicas
          </h1>
          <p style={{color:"#4B5563",fontSize:14}}>
            {f.esMedicoEsp ? "Todas las sedes" : f.esAdmin ? "Vista completa" : "Tu sede"}
          </p>
        </div>
        {(f.esAdmin || f.esMedico) && (
          <Btn onClick={()=>setModalNueva(true)}>+ Nueva alerta</Btn>
        )}
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Nuevas",    val:countNuevas,    color:"#F87171"},
          {label:"En revisión", val:countVistas,  color:"#F59E0B"},
          {label:"Resueltas", val:countResueltas, color:"#10B981"},
        ].map((k,i)=>(
          <Card key={i}>
            <div style={{fontSize:12,color:"#6B7280",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:32,fontWeight:700,color:k.color,marginTop:6}}>{k.val}</div>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[
          {id:"pendientes", label:"Pendientes"},
          {id:"resuelta",   label:"Resueltas"},
          {id:"todas",      label:"Todas"},
        ].map(f=>(
          <button key={f.id} onClick={()=>setFiltroEstado(f.id)}
            style={{padding:"6px 16px",borderRadius:20,border:"1px solid",fontSize:13,cursor:"pointer",fontFamily:"inherit",
              borderColor:filtroEstado===f.id?"#00C4B4":"#2A3550",
              background:filtroEstado===f.id?"#00C4B415":"none",
              color:filtroEstado===f.id?"#00C4B4":"#6B7280"}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de alertas */}
      {loading
        ? <div style={{color:"#4B5563",padding:20}}>Cargando alertas...</div>
        : alertasFiltradas.length === 0
          ? <Card style={{textAlign:"center",padding:"50px"}}>
              <div style={{fontSize:36,marginBottom:12,opacity:.3}}>🔔</div>
              <div style={{color:"#6B7280"}}>No hay alertas {filtroEstado === "pendientes" ? "pendientes" : ""}</div>
            </Card>
          : alertasFiltradas.map(alerta => (
            <div key={alerta.id}
              onClick={()=>abrirAlerta(alerta)}
              style={{
                background:"#111827",
                border:`1px solid ${alerta.estado==="nueva"?"#F8717140":"#1E2535"}`,
                borderLeft:`3px solid ${PRIORIDAD_COLOR[alerta.prioridad]}`,
                borderRadius:12, padding:"14px 18px", marginBottom:8,
                cursor:"pointer", transition:"border-color .2s",
                display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:16,
              }}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=alerta.estado==="nueva"?"#F8717140":"#1E2535"}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Badge color={PRIORIDAD_COLOR[alerta.prioridad]}>{alerta.prioridad}</Badge>
                  <span style={{fontSize:12,color:"#6B7280"}}>{TIPO_LABEL[alerta.tipo]}</span>
                  {alerta.estado==="nueva" && (
                    <span style={{background:"#F87171",color:"white",borderRadius:99,fontSize:10,fontWeight:700,padding:"1px 8px"}}>NUEVA</span>
                  )}
                </div>
                <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0",marginBottom:4}}>
                  {alerta.pacientes?.nombres} {alerta.pacientes?.apellidos}
                  <span style={{fontWeight:400,color:"#6B7280",fontSize:12,marginLeft:8}}>DNI {alerta.pacientes?.dni}</span>
                </div>
                <div style={{fontSize:13,color:"#9CA3AF",marginBottom:4,lineHeight:1.5}}>
                  {alerta.mensaje.length > 120 ? alerta.mensaje.slice(0,120)+"..." : alerta.mensaje}
                </div>
                <div style={{fontSize:11,color:"#4B5563"}}>
                  {alerta.sedes?.nombre} · {fmtFecha(alerta.created_at)}
                  {alerta.generada_por_perfil?.nombre && ` · Por: ${alerta.generada_por_perfil.nombre}`}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                <Badge color={ESTADO_COLOR[alerta.estado]}>{alerta.estado}</Badge>
                {alerta.respondida_por_perfil?.nombre && (
                  <div style={{fontSize:11,color:"#4B5563"}}>✓ {alerta.respondida_por_perfil.nombre}</div>
                )}
              </div>
            </div>
          ))
      }

      {/* Modal ver/responder alerta */}
      {verAlerta && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:580,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            {/* Header modal */}
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Badge color={PRIORIDAD_COLOR[verAlerta.prioridad]}>{verAlerta.prioridad}</Badge>
                  <Badge color={ESTADO_COLOR[verAlerta.estado]}>{verAlerta.estado}</Badge>
                  <span style={{fontSize:12,color:"#6B7280"}}>{TIPO_LABEL[verAlerta.tipo]}</span>
                </div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>
                  {verAlerta.pacientes?.nombres} {verAlerta.pacientes?.apellidos}
                </div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>
                  DNI {verAlerta.pacientes?.dni} · {verAlerta.sedes?.nombre} · {fmtFecha(verAlerta.created_at)}
                </div>
              </div>
              <button onClick={()=>setVerAlerta(null)}
                style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {/* Mensaje original */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:11,color:"#00C4B4",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                  Observación registrada
                </div>
                <div style={{background:"#0D1320",borderRadius:10,padding:"14px 16px",fontSize:14,color:"#E8EAF0",lineHeight:1.6}}>
                  {verAlerta.mensaje}
                </div>
                {verAlerta.generada_por_perfil?.nombre && (
                  <div style={{fontSize:11,color:"#4B5563",marginTop:6}}>
                    Registrada por: {verAlerta.generada_por_perfil.nombre}
                  </div>
                )}
              </div>

              {/* Respuesta existente */}
              {verAlerta.respuesta && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:11,color:"#10B981",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                    Respuesta médica
                  </div>
                  <div style={{background:"#10B98115",border:"1px solid #10B98130",borderRadius:10,padding:"14px 16px",fontSize:14,color:"#E8EAF0",lineHeight:1.6}}>
                    {verAlerta.respuesta}
                  </div>
                  {verAlerta.respondida_por_perfil?.nombre && (
                    <div style={{fontSize:11,color:"#4B5563",marginTop:6}}>
                      Respondida por: {verAlerta.respondida_por_perfil.nombre} · {fmtFecha(verAlerta.respondida_at)}
                    </div>
                  )}
                </div>
              )}

              {/* Botón Meet/Zoom — solo especialista */}
              {f.esMedicoEsp && (
                <div style={{marginBottom:20,padding:"12px 16px",background:"#1A2035",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"#E8EAF0"}}>Consulta por videollamada</div>
                    <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>Coordinar sesión con el médico de sede</div>
                  </div>
                  <a href="https://meet.google.com/new" target="_blank" rel="noreferrer"
                    style={{background:"linear-gradient(135deg,#00C4B4,#7C6AF7)",color:"white",padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:600,textDecoration:"none",whiteSpace:"nowrap"}}>
                    📹 Iniciar Meet
                  </a>
                </div>
              )}

              {/* Campo respuesta — solo médico y admin, solo si no está resuelta */}
              {(f.esMedico || f.esAdmin) && verAlerta.estado !== "resuelta" && (
                <div>
                  <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                    Escribir respuesta / indicación
                  </div>
                  <textarea
                    value={respuesta}
                    onChange={e=>setRespuesta(e.target.value)}
                    placeholder="Indicación clínica, protocolo a seguir, observación..."
                    rows={4}
                    style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}
                  />
                </div>
              )}
            </div>

            {/* Footer modal */}
            <div style={{padding:"14px 24px",borderTop:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div style={{fontSize:12,color:"#4B5563"}}>
                {verAlerta.estado === "resuelta" ? "✓ Alerta resuelta" : "Pendiente de respuesta"}
              </div>
              <div style={{display:"flex",gap:10}}>
                <Btn variant="ghost" onClick={()=>setVerAlerta(null)}>Cerrar</Btn>
                {(f.esMedico || f.esAdmin) && verAlerta.estado !== "resuelta" && (
                  <Btn onClick={responder} disabled={saving||!respuesta.trim()}>
                    {saving ? "Guardando..." : "Responder y resolver"}
                  </Btn>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva alerta manual */}
      {modalNueva && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:500,padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>Nueva Alerta Clínica</div>
              <button onClick={()=>setModalNueva(false)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>

            <Select label="Paciente" value={formNueva.paciente_id}
              onChange={v=>setFormNueva(f=>({...f,paciente_id:v}))}
              options={(pacientesData||[]).map(p=>({value:p.id,label:`${p.apellidos}, ${p.nombres} — DNI ${p.dni}`}))} required/>
            {errNueva.paciente_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{errNueva.paciente_id}</div>}

            <Select label="Sede" value={formNueva.sede_id}
              onChange={v=>setFormNueva(f=>({...f,sede_id:v}))}
              options={(sedesData||[]).map(s=>({value:s.id,label:s.nombre}))} required/>
            {errNueva.sede_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{errNueva.sede_id}</div>}

            <Select label="Tipo" value={formNueva.tipo}
              onChange={v=>setFormNueva(f=>({...f,tipo:v}))}
              options={[
                {value:"observacion_critica", label:"Observación crítica"},
                {value:"protocolo_pendiente", label:"Protocolo pendiente"},
                {value:"seguimiento",         label:"Seguimiento"},
                {value:"consulta",            label:"Consulta"},
              ]}/>

            <Select label="Prioridad" value={formNueva.prioridad}
              onChange={v=>setFormNueva(f=>({...f,prioridad:v}))}
              options={[
                {value:"alta",  label:"🔴 Alta"},
                {value:"media", label:"🟡 Media"},
                {value:"baja",  label:"⚫ Baja"},
              ]}/>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:errNueva.mensaje?"#F87171":"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>
                Mensaje <span style={{color:"#F87171"}}>*</span>
              </label>
              <textarea value={formNueva.mensaje}
                onChange={e=>setFormNueva(f=>({...f,mensaje:e.target.value}))}
                placeholder="Describe la observación o consulta clínica..."
                rows={4}
                style={{width:"100%",background:"#1A2035",border:`1px solid ${errNueva.mensaje?"#F87171":"#2A3550"}`,borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              {errNueva.mensaje && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{errNueva.mensaje}</div>}
            </div>

            <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setModalNueva(false)}>Cancelar</Btn>
              <Btn onClick={crearAlerta} disabled={savingNueva}>{savingNueva?"Creando...":"Crear alerta"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── APP PRINCIPAL ─────────────────────────────────────────────
export default function App() {
  const [user,          setUser]          = useState(null);
  const [alertasNuevas, setAlertasNuevas] = useState(0);
  const [perfil,  setPerfil]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [vista,   setVista]   = useState("dashboard");

  useEffect(()=>{
    let mounted = true;
    let loadedUserId = null;
    let inFlightUserId = null;

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

    const handleSession = async (session, eventName) => {
      if(!mounted) return;
      if(!session?.user) {
        loadedUserId = null; inFlightUserId = null;
        setUser(null); setPerfil(null); setLoading(false);
        return;
      }
      const uid = session.user.id;
      if(uid === loadedUserId) { if(mounted) setLoading(false); return; }
      if(uid === inFlightUserId) return;
      inFlightUserId = uid;
      const p = await loadPerfil(uid);
      if(!mounted) return;
      inFlightUserId = null; loadedUserId = uid;
      setUser(session.user);
      setPerfil(p);
      // FASE B: vistaDefault viene de getRolFlags
      setVista(prevVista => prevVista || getRolFlags(p).vistaDefault);
      setLoading(false);
    };

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if(error) { console.error("Error obteniendo sesión inicial:", error); if(mounted) setLoading(false); return; }
      await handleSession(data.session, "BOOT");
    })();

    const {data:{subscription}} = supabase.auth.onAuthStateChange(async (event, session) => {
      if(!mounted) return;
      console.log("Auth event:", event);
      if(event === "SIGNED_OUT") { await handleSession(null, event); return; }
      if(["SIGNED_IN","TOKEN_REFRESHED","INITIAL_SESSION","USER_UPDATED"].includes(event)) {
        await handleSession(session, event);
      }
    });

    const timeout = setTimeout(() => {
      if(mounted && loadedUserId === null) setLoading(false);
    }, 8000);

    return () => { mounted = false; subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null); setPerfil(null); setVista("dashboard");
  };

  // FASE C: badge de alertas nuevas — query liviana cada 60 segundos
  useEffect(() => {
    if(!perfil) return;
    const f = getRolFlags(perfil);
    if(!f.puedeVerAlertas) return;
    const fetchCount = async () => {
      const { count } = await supabase
        .from("alertas_clinicas")
        .select("*", { count:"exact", head:true })
        .eq("estado", "nueva");
      setAlertasNuevas(count || 0);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [perfil?.id]); // eslint-disable-line

  if(loading) return <Spinner/>;
  if(!user)   return <Login/>;

  const f = getRolFlags(perfil);

  const renderVista = () => {
    switch(vista){
      case "dashboard": return f.puedeVerDashboard  ? <DashboardAdmin/>              : null;
      case "pacientes": return                         <Pacientes perfil={perfil}/>;
      case "ventas":    return f.puedeVerVentas      ? <Ventas perfil={perfil}/>      : null;
      case "historias": return                         <HistoriasClinicas perfil={perfil}/>;
      case "finanzas":  return f.puedeVerFinanzas    ? <Finanzas/>                    : null;
      case "sedes":     return f.puedeVerSedes       ? <Sedes/>                       : null;
      case "usuarios":  return f.puedeVerUsuarios    ? <Usuarios perfil={perfil}/>    : null;
      case "sesiones":  return                         <Sesiones perfil={perfil}/>;
      case "alertas":   return f.puedeVerAlertas     ? <Alertas perfil={perfil}/>     : null;
      case "agenda":    return                         <AgendaMedico perfil={perfil}/>;
      default:          return f.puedeVerDashboard   ? <DashboardAdmin/>              : <Pacientes perfil={perfil}/>;
    }
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#080C18",minHeight:"100vh",color:"#E8EAF0",width:"100%"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#1E2535;border-radius:3px}select option{background:#1A2035}input::placeholder{color:#4B5563}textarea::placeholder{color:#4B5563}textarea{box-sizing:border-box}`}</style>
      <div style={{display:"flex",minHeight:"100vh",width:"100%"}}>
        <Sidebar vista={vista} setVista={setVista} perfil={perfil} onLogout={handleLogout} alertasNuevas={alertasNuevas}/>
        <div style={{flex:1,overflow:"auto",padding:"28px 40px"}}>
          {renderVista()}
        </div>
      </div>
    </div>
  );
}
