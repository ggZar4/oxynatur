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

// ── DASHBOARD — detecta rol y muestra vista correcta ─────────
function DashboardAdmin({perfil}) {
  const f = getRolFlags(perfil);
  if(f.esMedico) return <DashboardMedico perfil={perfil}/>;
  return <DashboardFinanciero/>;
}

// ── DASHBOARD CLÍNICO — Dr. Raúl y médicos ───────────────────
function DashboardMedico({perfil}) {
  const f = getRolFlags(perfil);
  const hoy = new Date().toISOString().slice(0,10);

  const [alertas,    setAlertas]    = useState([]);
  const [sinProtocolo, setSinProtocolo] = useState([]);
  const [sesionesHoy,  setSesionesHoy]  = useState([]);
  const [resumen,    setResumen]    = useState([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      const [r1,r2,r3,r4] = await Promise.all([
        // Alertas pendientes
        safeQuery(()=> {
          let q = supabase.from("alertas_clinicas")
            .select("id,tipo,prioridad,mensaje,created_at,pacientes(nombres,apellidos),sedes(nombre)")
            .neq("estado","resuelta")
            .order("created_at",{ascending:false})
            .limit(5);
          return q;
        }, "DashMed:alertas"),
        // Pacientes sin protocolo (HC sin evolución médica firmada)
        safeQuery(()=>
          supabase.from("historias_clinicas")
            .select("id,paciente_id,diagnostico_principal,pacientes(nombres,apellidos),sedes!sede_apertura_id(nombre)")
            .eq("estado","activo")
            .limit(10),
          "DashMed:sinProtocolo"
        ),
        // Sesiones del día
        safeQuery(()=> {
          let q = supabase.from("vista_agenda_hoy")
            .select("*").eq("fecha", hoy).order("hora_inicio");
          return q;
        }, "DashMed:sesiones"),
        // Resumen por sede
        safeQuery(()=>
          supabase.from("vista_resumen_sedes").select("*"),
          "DashMed:resumen"
        ),
      ]);
      if(!mounted) return;
      setAlertas(r1.data||[]);
      setSinProtocolo(r2.data||[]);
      setSesionesHoy(r3.data||[]);
      setResumen(r4.data||[]);
      setLoading(false);
    })();
    return ()=>{ mounted=false; };
  },[]); // eslint-disable-line

  const PRIORIDAD_COLOR = {alta:"#F87171",media:"#F59E0B",baja:"#6B7280"};
  const ESTADO_COLOR    = {programada:"#F59E0B",en_curso:"#00C4B4",completada:"#10B981",cancelada:"#F87171"};

  if(loading) return <div style={{padding:32,color:"#4B5563"}}>Cargando dashboard clínico...</div>;

  const sesCompletadas = sesionesHoy.filter(s=>s.estado==="completada").length;
  const sesEnCurso     = sesionesHoy.filter(s=>s.estado==="en_curso").length;
  const sesPendientes  = sesionesHoy.filter(s=>s.estado==="programada").length;

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:700,color:"#E8EAF0"}}>
          Panel Clínico
        </h1>
        <p style={{color:"#4B5563",fontSize:14,marginTop:4}}>
          {new Date().toLocaleDateString("es-PE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
          {f.esMedicoEsp && <span style={{color:"#00C4B4",marginLeft:8}}>· Todas las sedes</span>}
        </p>
      </div>

      {/* KPIs clínicos */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Alertas pendientes", val:alertas.length,    color: alertas.length>0?"#F87171":"#10B981"},
          {label:"Sesiones hoy",       val:sesionesHoy.length, color:"#00C4B4"},
          {label:"Completadas hoy",    val:sesCompletadas,    color:"#10B981"},
          {label:"En curso",           val:sesEnCurso,        color:"#7C6AF7"},
        ].map((k,i)=>(
          <Card key={i}>
            <div style={{fontSize:11,color:"#6B7280",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:32,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.color}}>{k.val}</div>
          </Card>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>

        {/* Alertas pendientes */}
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#F87171",letterSpacing:"0.06em",textTransform:"uppercase"}}>🔔 Alertas pendientes</div>
            <span style={{fontSize:12,color:"#4B5563"}}>{alertas.length} sin resolver</span>
          </div>
          {alertas.length===0
            ? <div style={{padding:"24px",textAlign:"center",color:"#4B5563",fontSize:13}}>✓ Sin alertas pendientes</div>
            : alertas.map(a=>(
              <div key={a.id} style={{padding:"12px 18px",borderBottom:"1px solid #1A2035",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontSize:11,fontWeight:700,color:PRIORIDAD_COLOR[a.prioridad],background:`${PRIORIDAD_COLOR[a.prioridad]}15`,padding:"2px 8px",borderRadius:99,flexShrink:0,marginTop:1}}>{a.prioridad}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#E8EAF0",marginBottom:2}}>{a.pacientes?.nombres} {a.pacientes?.apellidos}</div>
                  <div style={{fontSize:12,color:"#6B7280",marginBottom:2}}>{a.sedes?.nombre}</div>
                  <div style={{fontSize:12,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.mensaje}</div>
                </div>
              </div>
            ))
          }
        </Card>

        {/* Sesiones del día */}
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#00C4B4",letterSpacing:"0.06em",textTransform:"uppercase"}}>⚡ Sesiones de hoy</div>
            <span style={{fontSize:12,color:"#4B5563"}}>{sesCompletadas}/{sesionesHoy.length} completadas</span>
          </div>
          {sesionesHoy.length===0
            ? <div style={{padding:"24px",textAlign:"center",color:"#4B5563",fontSize:13}}>Sin sesiones programadas para hoy</div>
            : sesionesHoy.map(s=>(
              <div key={s.id} style={{padding:"10px 18px",borderBottom:"1px solid #1A2035",display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"#00C4B4",minWidth:44}}>{s.hora_inicio?.slice(0,5)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#E8EAF0"}}>{s.paciente}</div>
                  <div style={{fontSize:11,color:"#6B7280"}}>{s.sede_nombre} · Ses. #{s.numero_sesion}</div>
                </div>
                <Badge color={ESTADO_COLOR[s.estado]||"#6B7280"}>{s.estado}</Badge>
              </div>
            ))
          }
        </Card>
      </div>

      {/* Pacientes sin evaluación médica firmada */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#7C6AF7",letterSpacing:"0.06em",textTransform:"uppercase"}}>📋 Pacientes activos por sede</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:0}}>
          {resumen.map((s,i)=>(
            <div key={s.sede_id} style={{padding:"16px 20px",borderRight:i%2===0?"1px solid #1A2035":"none",borderBottom:"1px solid #1A2035"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:getColor(s.sede),display:"inline-block"}}/>
                <span style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"#E8EAF0"}}>{s.sede}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[
                  {l:"Pac. activos", v:s.pacientes_activos, c:getColor(s.sede)},
                  {l:"Ses. hoy",     v:s.sesiones_hoy,      c:"#7C6AF7"},
                  {l:"Ses. mes",     v:s.sesiones_mes,      c:"#10B981"},
                ].map((it,j)=>(
                  <div key={j} style={{background:"#0D1320",borderRadius:8,padding:"8px",textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:700,color:it.c}}>{it.v||0}</div>
                    <div style={{fontSize:10,color:"#6B7280",marginTop:2}}>{it.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── DASHBOARD FINANCIERO — solo admin ────────────────────────
function DashboardFinanciero() {
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
  const [pacs, setPacs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [busq, setBusq]     = useState("");
  const [modal, setModal]   = useState(false);
  const [sedes, setSedes]   = useState([]);
  const [form, setForm]     = useState({nombres:"",apellidos:"",dni:"",telefono:"",email:"",genero:"",fecha_nacimiento:"",sede_principal_id:"",total_sesiones_prescritas:"",diagnostico_hc:""});
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState({});

  // Perfil de paciente seleccionado
  const [pacSelec, setPacSelec]   = useState(null);
  const [pacDetalle, setPacDetalle] = useState(null); // datos completos del paciente
  const [compras, setCompras]     = useState([]);
  const [ultimasSesiones, setUltimasSesiones] = useState([]);
  const [loadingPerfil, setLoadingPerfil] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("pacientes")
        .select("*, sedes!sede_principal_id(nombre,color)")
        .order("created_at",{ascending:false});
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
        () => supabase.from("sedes").select("id,nombre"), "Pacientes:sedes"
      );
      if (mounted) setSedes(sedesData || []);
    })();
    return () => { mounted = false; };
  },[]); // eslint-disable-line

  const abrirPerfil = async (pac) => {
    setPacSelec(pac);
    setLoadingPerfil(true);
    const [r1, r2, r3] = await Promise.all([
      // Datos completos del paciente
      safeQuery(()=>
        supabase.from("pacientes")
          .select("*, sedes!sede_principal_id(nombre)")
          .eq("id", pac.id).single(),
        "Perfil:paciente"
      ),
      // Compras/paquetes activos e históricos
      safeQuery(()=>
        supabase.from("compras_paciente")
          .select("*, paquetes(nombre,cantidad_sesiones,codigo)")
          .eq("paciente_id", pac.id)
          .order("created_at",{ascending:false}),
        "Perfil:compras"
      ),
      // Últimas sesiones
      safeQuery(()=>
        supabase.from("sesiones")
          .select("*, sedes(nombre), camaras(numero)")
          .eq("paciente_id", pac.id)
          .order("fecha",{ascending:false})
          .order("hora_inicio",{ascending:false})
          .limit(10),
        "Perfil:sesiones"
      ),
    ]);
    setPacDetalle(r1.data);
    setCompras(r2.data||[]);
    setUltimasSesiones(r3.data||[]);
    setLoadingPerfil(false);
  };

  const filtrados = pacs.filter(p=>{
    const q = busq.toLowerCase();
    return p.nombres?.toLowerCase().includes(q) || p.apellidos?.toLowerCase().includes(q) || p.dni?.includes(q);
  });

  const setF = (k,v) => setForm(fm=>({...fm,[k]:v}));

  const guardar = async () => {
    const e = {};
    if(!form.nombres)          e.nombres          = "Requerido";
    if(!form.apellidos)        e.apellidos        = "Requerido";
    if(!form.dni)              e.dni              = "Requerido";
    if(!form.sede_principal_id) e.sede_principal_id = "Requerido";
    if(!form.diagnostico_hc)   e.diagnostico_hc   = "Requerido";
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
  const fmtSol = (n) => `S/ ${Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // ── Vista perfil de paciente ──
  if(pacSelec) return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{ setPacSelec(null); setPacDetalle(null); setCompras([]); setUltimasSesiones([]); }}
            style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
            ← Volver
          </button>
          <div>
            <h1 style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:700,color:"#E8EAF0"}}>
              {pacSelec.nombres} {pacSelec.apellidos}
            </h1>
            <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>
              DNI {pacSelec.dni}
              {pacSelec.email && ` · ${pacSelec.email}`}
              {pacSelec.telefono && ` · ${pacSelec.telefono}`}
            </div>
          </div>
        </div>
        <Badge color={estadoColor[pacSelec.estado]||"#6B7280"}>{pacSelec.estado}</Badge>
      </div>

      {loadingPerfil ? <div style={{color:"#4B5563"}}>Cargando perfil...</div> : (
        <>
          {/* Datos generales + progreso */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <Card>
              <div style={{fontSize:11,color:"#00C4B4",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Datos del paciente</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Sede",        pacSelec.sedes?.nombre],
                  ["Género",      pacDetalle?.genero],
                  ["Nacimiento",  pacDetalle?.fecha_nacimiento],
                  ["Diagnóstico", pacDetalle?.diagnostico_hc || "Ver HC"],
                ].filter(([,v])=>v).map(([k,v])=>(
                  <div key={k} style={{background:"#0D1320",borderRadius:8,padding:"8px 12px"}}>
                    <div style={{fontSize:10,color:"#4B5563",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3}}>{k}</div>
                    <div style={{fontSize:13,color:"#E8EAF0"}}>{v}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Progreso de sesiones */}
            <Card>
              <div style={{fontSize:11,color:"#00C4B4",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Progreso del tratamiento</div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#1E2535" strokeWidth="8"/>
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#00C4B4" strokeWidth="8"
                      strokeDasharray={`${2*Math.PI*30}`}
                      strokeDashoffset={`${2*Math.PI*30*(1-(pacSelec.sesiones_realizadas||0)/(pacSelec.total_sesiones_prescritas||1))}`}
                      strokeLinecap="round" transform="rotate(-90 36 36)"/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:16,fontWeight:700,color:"#00C4B4"}}>{pacSelec.sesiones_realizadas||0}</div>
                    <div style={{fontSize:10,color:"#4B5563"}}>/{pacSelec.total_sesiones_prescritas||0}</div>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:13,color:"#E8EAF0",fontWeight:600,marginBottom:4}}>
                    {pacSelec.sesiones_realizadas||0} de {pacSelec.total_sesiones_prescritas||0} sesiones
                  </div>
                  <div style={{fontSize:12,color:"#6B7280"}}>
                    {Math.max(0,(pacSelec.total_sesiones_prescritas||0)-(pacSelec.sesiones_realizadas||0))} sesiones restantes
                  </div>
                  {pacSelec.sesiones_realizadas >= pacSelec.total_sesiones_prescritas && pacSelec.total_sesiones_prescritas > 0 && (
                    <div style={{fontSize:12,color:"#10B981",marginTop:4}}>✓ Tratamiento completado</div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Paquetes activos e histórico */}
          <Card style={{marginBottom:14,padding:0,overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",fontSize:12,fontWeight:700,color:"#7C6AF7",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              Paquetes comprados
            </div>
            {compras.length===0
              ? <div style={{padding:"20px",textAlign:"center",color:"#4B5563",fontSize:13}}>Sin compras registradas</div>
              : compras.map((c,i)=>{
                  const usadas    = c.sesiones_usadas||0;
                  const totales   = c.sesiones_totales||1;
                  const pct       = Math.round((usadas/totales)*100);
                  const estadoC   = c.estado==="activo"?"#10B981":c.estado==="agotado"?"#6B7280":"#F87171";
                  return (
                    <div key={c.id} style={{padding:"12px 18px",borderBottom:i<compras.length-1?"1px solid #1A2035":"none",display:"flex",alignItems:"center",gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:13,fontWeight:600,color:"#E8EAF0"}}>{c.paquetes?.nombre||"Paquete"}</span>
                          <Badge color={estadoC}>{c.estado}</Badge>
                        </div>
                        <div style={{fontSize:12,color:"#6B7280",marginBottom:6}}>
                          {c.fecha_compra} · {fmtSol(c.monto_pagado)} · {c.metodo_pago||""}
                          {c.fecha_vencimiento && ` · Vence: ${c.fecha_vencimiento}`}
                        </div>
                        {/* Barra de progreso */}
                        <div style={{height:4,background:"#1E2535",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:pct>=100?"#10B981":"#00C4B4",borderRadius:2,transition:"width .3s"}}/>
                        </div>
                        <div style={{fontSize:11,color:"#6B7280",marginTop:3}}>{usadas}/{totales} sesiones usadas ({pct}%)</div>
                      </div>
                    </div>
                  );
                })
            }
          </Card>

          {/* Últimas sesiones */}
          <Card style={{padding:0,overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:"1px solid #1E2535",fontSize:12,fontWeight:700,color:"#F59E0B",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              Últimas sesiones
            </div>
            {ultimasSesiones.length===0
              ? <div style={{padding:"20px",textAlign:"center",color:"#4B5563",fontSize:13}}>Sin sesiones registradas</div>
              : ultimasSesiones.map((s,i)=>{
                  const ECOLOR = {programada:"#F59E0B",en_curso:"#00C4B4",completada:"#10B981",cancelada:"#F87171",no_asistio:"#6B7280"};
                  return (
                    <div key={s.id} style={{padding:"10px 18px",borderBottom:i<ultimasSesiones.length-1?"1px solid #1A2035":"none",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:700,color:"#00C4B4",minWidth:44}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:"#E8EAF0"}}>Sesión #{s.numero_sesion} · {s.fecha}</div>
                        <div style={{fontSize:11,color:"#6B7280"}}>{s.sedes?.nombre} · Cámara #{s.camaras?.numero||"—"} · {s.presion_aplicada} ATA · {s.duracion_minutos} min</div>
                      </div>
                      <Badge color={ECOLOR[s.estado]||"#6B7280"}>{s.estado}</Badge>
                    </div>
                  );
                })
            }
          </Card>
        </>
      )}
    </div>
  );

  // ── Lista de pacientes ──
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Pacientes</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>{filtrados.length} pacientes encontrados</p>
        </div>
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
              <div key={p.id} onClick={()=>abrirPerfil(p)}
                style={{background:"#111827",border:"1px solid #1E2535",borderRadius:12,padding:"14px 18px",marginBottom:8,display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",alignItems:"center",cursor:"pointer"}}
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
// Dos capas: HC Maestra (por paciente) + Evaluaciones por sesión.
// Enfermero: registra signos vitales y datos operativos.
// Médico: agrega evolución clínica y firma de supervisión.
// Especialista: ve todo, puede editar HC maestra y protocolos.
function HistoriasClinicas({perfil}) {
  const f = getRolFlags(perfil);

  // Vista principal: lista de pacientes con HC
  const [pacientes, setPacientes] = useState([]);
  const [sedes, setSedes]         = useState([]);
  const [sedeTab, setSedeTab]     = useState("todas");
  const [loading, setLoading]     = useState(true);
  const [busq, setBusq]           = useState("");

  // Vistas de detalle
  const [pacSelec, setPacSelec]   = useState(null); // paciente seleccionado → ver HC maestra + evaluaciones
  const [modalEval, setModalEval] = useState(null); // evaluación a ver/editar
  const [modalNuevaEval, setModalNuevaEval] = useState(false);
  const [comprasPaciente, setComprasPaciente] = useState([]); // compras activas del paciente seleccionado

  // Form nueva evaluación (enfermero)
  const evalInicial = {
    presion_arterial:"", frecuencia_cardiaca:"", saturacion_o2:"", temperatura:"", peso:"",
    nivel_dolor:0, estado_general:"Bueno",
    otitis:"No", claustrofobia:"No", embarazo:"No", fiebre_activa:"No",
    presion_indicada:"2.0", duracion_minutos:"90",
    incidencias:"", observaciones:"", numero_sesion:"",
    evolucion:"", firma_medico:"", compra_id:"",
  };
  const [formEval, setFormEval]   = useState(evalInicial);
  const [savingEval, setSavingEval] = useState(false);
  const [errEval, setErrEval]     = useState({});

  // Evaluaciones del paciente seleccionado
  const [evals, setEvals]         = useState([]);
  const [loadingEvals, setLoadingEvals] = useState(false);

  // HC maestra del paciente
  const [hcMaestra, setHcMaestra] = useState(null);
  const [editandoHC, setEditandoHC] = useState(false);
  const [formHC, setFormHC]       = useState({});
  const [savingHC, setSavingHC]   = useState(false);

  const dolorColor = (n) => parseInt(n)>=7?"#F87171":parseInt(n)>=4?"#F59E0B":"#10B981";
  const estColor   = (e) => ["Excelente","Bueno"].includes(e)?"#10B981":e==="Regular"?"#F59E0B":"#F87171";

  // Cargar lista de pacientes con HC
  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("historias_clinicas")
        .select("*, pacientes(id,nombres,apellidos,dni,estado,sesiones_realizadas,total_sesiones_prescritas), sedes!sede_apertura_id(nombre)")
        .order("created_at",{ascending:false});
      if(!f.puedeVerTodasHC && perfil?.sede_id) q = q.eq("sede_apertura_id", perfil.sede_id);
      return q;
    }, "HC:load");
    setPacientes(data || []);
    setLoading(false);
  };

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      await load();
      const { data: s } = await safeQuery(()=>supabase.from("sedes").select("id,nombre"), "HC:sedes");
      if(mounted) setSedes(s||[]);
    })();
    return ()=>{ mounted=false; };
  },[]); // eslint-disable-line

  // Al seleccionar paciente — cargar HC maestra + evaluaciones
  const abrirPaciente = async (hc) => {
    setPacSelec(hc);
    setHcMaestra(hc);
    setFormHC({
      diagnostico_principal: hc.diagnostico_principal||"",
      antecedentes_personales: hc.antecedentes_personales||"",
      antecedentes_familiares: hc.antecedentes_familiares||"",
      alergias: hc.alergias||"",
      medicamentos_habituales: hc.medicamentos_habituales||"",
      contraindicaciones: hc.contraindicaciones||"",
      observaciones_generales: hc.observaciones_generales||"",
      apto_hiperbarica: hc.apto_hiperbarica !== false,
    });

    // Cargar compras activas del paciente para el selector de episodio
    const { data: compras } = await safeQuery(()=>
      supabase.from("compras_paciente")
        .select("id,sesiones_usadas,sesiones_totales,paquetes(nombre,cantidad_sesiones)")
        .eq("paciente_id", hc.paciente_id)
        .eq("estado","activo")
        .order("created_at",{ascending:false}),
      "HC:compras"
    );
    setComprasPaciente(compras||[]);
    setLoadingEvals(true);
    const { data } = await safeQuery(()=>
      supabase.from("evaluaciones_medicas")
        .select("*, sedes(nombre), perfiles!medico_id(nombre), compras_paciente(id,fecha_compra,paquetes(nombre,cantidad_sesiones))")
        .eq("paciente_id", hc.paciente_id)
        .order("fecha",{ascending:false})
        .order("numero_sesion",{ascending:false}),
      "HC:evals"
    );
    setEvals(data||[]);
    setLoadingEvals(false);
  };

  const guardarHCMaestra = async () => {
    setSavingHC(true);
    const { error } = await safeQuery(()=>
      supabase.from("historias_clinicas").update({
        diagnostico_principal:    formHC.diagnostico_principal,
        antecedentes_personales:  formHC.antecedentes_personales,
        antecedentes_familiares:  formHC.antecedentes_familiares,
        alergias:                 formHC.alergias,
        medicamentos_habituales:  formHC.medicamentos_habituales,
        contraindicaciones:       formHC.contraindicaciones,
        observaciones_generales:  formHC.observaciones_generales,
        apto_hiperbarica:         formHC.apto_hiperbarica,
      }).eq("id", hcMaestra.id),
      "HC:guardarMaestra"
    );
    setSavingHC(false);
    if(!error){ setEditandoHC(false); load(); }
  };

  const guardarEval = async () => {
    const e = {};
    if(!formEval.presion_arterial)    e.presion_arterial    = "Requerido";
    if(!formEval.frecuencia_cardiaca) e.frecuencia_cardiaca = "Requerido";
    if(!formEval.saturacion_o2)       e.saturacion_o2       = "Requerido";
    if(!formEval.numero_sesion)       e.numero_sesion       = "Requerido";
    setErrEval(e);
    if(Object.keys(e).length) return;
    setSavingEval(true);

    // Si médico, verificar que pone firma
    const esMedFirmando = (f.esMedico || f.esAdmin) && formEval.firma_medico.trim();

    const { error } = await safeQuery(()=>
      supabase.from("evaluaciones_medicas").insert({
        historia_id:         pacSelec.id,
        paciente_id:         pacSelec.paciente_id,
        sede_id:             pacSelec.sede_apertura_id,
        medico_id:           (f.esMedico||f.esAdmin) ? perfil.id : null,
        numero_sesion:       parseInt(formEval.numero_sesion),
        fecha:               new Date().toISOString().slice(0,10),
        hora:                new Date().toTimeString().slice(0,8),
        presion_arterial:    formEval.presion_arterial,
        frecuencia_cardiaca: formEval.frecuencia_cardiaca,
        saturacion_o2:       formEval.saturacion_o2,
        temperatura:         formEval.temperatura||null,
        peso:                formEval.peso ? parseFloat(formEval.peso) : null,
        nivel_dolor:         parseInt(formEval.nivel_dolor),
        estado_general:      formEval.estado_general,
        otitis:              formEval.otitis,
        claustrofobia:       formEval.claustrofobia,
        embarazo:            formEval.embarazo,
        fiebre_activa:       formEval.fiebre_activa,
        presion_indicada:    parseFloat(formEval.presion_indicada)||2.0,
        duracion_minutos:    parseInt(formEval.duracion_minutos)||90,
        incidencias:         formEval.incidencias||null,
        observaciones:       formEval.observaciones||null,
        evolucion:           formEval.evolucion||null,
        firma_medico:        esMedFirmando
          ? formEval.firma_medico
          : null,
        es_borrador:         !esMedFirmando,
        compra_id:           formEval.compra_id || null,
      }),
      "HC:guardarEval"
    );
    setSavingEval(false);
    if(!error){
      setModalNuevaEval(false);
      setFormEval(evalInicial);
      setErrEval({});
      await abrirPaciente(pacSelec);
    }
  };

  // Médico firma una evaluación borrador
  const firmarEval = async (ev) => {
    const firma = prompt("Escriba su nombre completo como firma de supervisión:");
    if(!firma?.trim()) return;
    await safeQuery(()=>
      supabase.from("evaluaciones_medicas").update({
        evolucion:   ev.evolucion || "",
        firma_medico: firma.trim(),
        es_borrador:  false,
        medico_id:    perfil.id,
      }).eq("id", ev.id),
      "HC:firmar"
    );
    await abrirPaciente(pacSelec);
  };

  // Vista filtrada por sede
  const filtrados = (sedeTab==="todas" ? pacientes : pacientes.filter(p=>p.sede_apertura_id===sedeTab))
    .filter(p=>!busq || `${p.pacientes?.nombres} ${p.pacientes?.apellidos} ${p.pacientes?.dni}`.toLowerCase().includes(busq.toLowerCase()));

  // ── Si hay paciente seleccionado — mostrar detalle ──
  if(pacSelec) return (
    <div>
      {/* Header detalle */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{ setPacSelec(null); setEvals([]); setEditandoHC(false); }}
            style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
            ← Volver
          </button>
          <div>
            <h1 style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:700,color:"#E8EAF0"}}>
              {pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}
            </h1>
            <div style={{fontSize:12,color:"#6B7280"}}>
              DNI {pacSelec.pacientes?.dni} · {pacSelec.sedes?.nombre} · {pacSelec.pacientes?.sesiones_realizadas}/{pacSelec.pacientes?.total_sesiones_prescritas} sesiones
            </div>
          </div>
        </div>
        {(f.esEnfermero || f.esMedico || f.esAdmin) && (
          <Btn onClick={()=>{ setFormEval(evalInicial); setErrEval({}); setModalNuevaEval(true); }}>
            + Nueva evaluación
          </Btn>
        )}
      </div>

      {/* HC MAESTRA */}
      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,color:"#00C4B4",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>
            Historia Clínica Maestra
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Badge color={pacSelec.apto_hiperbarica!==false?"#10B981":"#F87171"}>
              {pacSelec.apto_hiperbarica!==false?"Apto HBOT":"No apto HBOT"}
            </Badge>
            {f.puedeEscribirProtocolo && !editandoHC && (
              <button onClick={()=>setEditandoHC(true)}
                style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                ✏ Editar
              </button>
            )}
          </div>
        </div>

        {editandoHC ? (
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              {[
                ["Diagnóstico principal","diagnostico_principal"],
                ["Antecedentes personales","antecedentes_personales"],
                ["Antecedentes familiares","antecedentes_familiares"],
                ["Alergias","alergias"],
                ["Medicamentos habituales","medicamentos_habituales"],
                ["Contraindicaciones","contraindicaciones"],
              ].map(([label,key])=>(
                <div key={key} style={{gridColumn:["diagnostico_principal","contraindicaciones"].includes(key)?"1/-1":undefined}}>
                  <label style={{fontSize:11,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
                  <textarea value={formHC[key]||""} onChange={e=>setFormHC(f=>({...f,[key]:e.target.value}))}
                    rows={2} style={{width:"100%",background:"#0D1320",border:"1px solid #2A3550",borderRadius:8,color:"#E8EAF0",padding:"8px 12px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                </div>
              ))}
            </div>
            <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#0D1320",borderRadius:8}}>
              <input type="checkbox" checked={formHC.apto_hiperbarica!==false}
                onChange={e=>setFormHC(f=>({...f,apto_hiperbarica:e.target.checked}))}
                style={{width:16,height:16,accentColor:"#00C4B4"}}/>
              <span style={{fontSize:14,color:"#E8EAF0"}}>Paciente apto para terapia hiperbárica</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setEditandoHC(false)}>Cancelar</Btn>
              <Btn onClick={guardarHCMaestra} disabled={savingHC}>{savingHC?"Guardando...":"Guardar HC"}</Btn>
            </div>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              ["Diagnóstico",         hcMaestra?.diagnostico_principal,    true],
              ["Antec. personales",   hcMaestra?.antecedentes_personales,   false],
              ["Antec. familiares",   hcMaestra?.antecedentes_familiares,   false],
              ["Alergias",            hcMaestra?.alergias,                  false],
              ["Medicamentos",        hcMaestra?.medicamentos_habituales,   false],
              ["Contraindicaciones",  hcMaestra?.contraindicaciones,        true],
            ].map(([label,val,full])=> val ? (
              <div key={label} style={{background:"#0D1320",borderRadius:10,padding:"10px 14px",gridColumn:full?"1/-1":undefined}}>
                <div style={{fontSize:10,color:"#4B5563",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{label}</div>
                <div style={{fontSize:13,color:"#E8EAF0",lineHeight:1.5}}>{val}</div>
              </div>
            ) : null)}
          </div>
        )}
      </Card>

      {/* EVALUACIONES POR SESIÓN */}
      <div style={{fontSize:11,color:"#6B7280",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
        Evaluaciones por sesión ({evals.length})
      </div>

      {loadingEvals
        ? <div style={{color:"#4B5563"}}>Cargando evaluaciones...</div>
        : evals.length === 0
          ? <Card style={{textAlign:"center",padding:"30px",color:"#6B7280"}}>Sin evaluaciones registradas aún</Card>
          : (() => {
              // Agrupar evaluaciones por compra_id (episodio)
              // Cada compra = un episodio de tratamiento independiente
              const episodios = {};
              evals.forEach(ev => {
                const key = ev.compra_id || "sin_paquete";
                if(!episodios[key]) episodios[key] = { evals: [], compra_id: ev.compra_id };
                episodios[key].evals.push(ev);
              });

              // Ordenar episodios por fecha de la primera evaluación (más reciente primero)
              const episodiosOrdenados = Object.values(episodios).sort((a,b) => {
                const fa = a.evals[0]?.fecha || "";
                const fb = b.evals[0]?.fecha || "";
                return fb.localeCompare(fa);
              });

              return episodiosOrdenados.map((ep, epIdx) => {
                const evCount     = ep.evals.length;
                const firmadas    = ep.evals.filter(e=>!e.es_borrador && e.firma_medico).length;
                const borradores  = ep.evals.filter(e=>e.es_borrador).length;
                const fechaInicio = ep.evals[ep.evals.length-1]?.fecha;
                const fechaFin    = ep.evals[0]?.fecha;
                const epNum       = episodiosOrdenados.length - epIdx; // numeración descendente
                const completo    = ep.evals.length > 0 && borradores === 0;

                return (
                  <div key={ep.compra_id||"sin_paquete"} style={{marginBottom:24}}>
                    {/* Header episodio */}
                    <div style={{
                      display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"10px 16px",
                      background:"linear-gradient(135deg,#1A2035,#111827)",
                      border:"1px solid #2A3550",
                      borderRadius:12,marginBottom:8,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <div style={{
                          width:32,height:32,borderRadius:8,
                          background: epIdx===0?"linear-gradient(135deg,#00C4B4,#7C6AF7)":"#2A3550",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:13,fontWeight:700,color:"white",flexShrink:0,
                        }}>{epNum}</div>
                        <div>
                          <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"#E8EAF0"}}>
                            Episodio {epNum}
                            {ep.evals[0]?.compras_paciente?.paquetes?.nombre && (
                              <span style={{fontSize:12,color:"#9CA3AF",fontWeight:400,marginLeft:8}}>
                                — {ep.evals[0].compras_paciente.paquetes.nombre}
                              </span>
                            )}
                            {epIdx===0 && <span style={{fontSize:11,color:"#00C4B4",marginLeft:8,fontWeight:400}}>● Activo</span>}
                          </div>
                          <div style={{fontSize:11,color:"#6B7280",marginTop:1}}>
                            {fechaInicio}{fechaFin && fechaFin!==fechaInicio ? ` → ${fechaFin}` : ""} · {evCount} sesiones
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        {borradores > 0 && <Badge color="#F59E0B">{borradores} pendiente{borradores>1?"s":""}</Badge>}
                        {completo && <Badge color="#10B981">✓ Completo</Badge>}
                        <span style={{fontSize:11,color:"#4B5563"}}>{firmadas}/{evCount} firmadas</span>
                      </div>
                    </div>

                    {/* Evaluaciones del episodio */}
                    {ep.evals.map(ev=>(
                      <div key={ev.id} style={{
                        background:"#111827",
                        border:`1px solid ${ev.es_borrador?"#F59E0B40":"#1E2535"}`,
                        borderLeft:`3px solid ${ev.es_borrador?"#F59E0B":ev.firma_medico?"#10B981":"#00C4B4"}`,
                        borderRadius:12,padding:"14px 18px",marginBottom:6,marginLeft:8,
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                              <span style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"#E8EAF0"}}>Sesión #{ev.numero_sesion}</span>
                              <span style={{fontSize:12,color:"#6B7280"}}>{ev.fecha} · {ev.hora?.slice(0,5)}</span>
                              {ev.es_borrador && <Badge color="#F59E0B">Borrador</Badge>}
                              {!ev.es_borrador && ev.firma_medico && <Badge color="#10B981">✓ Firmado</Badge>}
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:ev.evolucion?8:0}}>
                              {[
                                ["PA",    ev.presion_arterial],
                                ["FC",    ev.frecuencia_cardiaca],
                                ["SatO₂", ev.saturacion_o2],
                                ["Dolor", ev.nivel_dolor!=null?`${ev.nivel_dolor}/10`:null],
                                ["Estado",ev.estado_general],
                              ].filter(([,v])=>v).map(([k,v])=>(
                                <div key={k} style={{background:"#0D1320",borderRadius:8,padding:"5px 8px",textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"#4B5563",textTransform:"uppercase"}}>{k}</div>
                                  <div style={{fontSize:12,fontWeight:600,color:"#E8EAF0",marginTop:1}}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{fontSize:11,color:"#6B7280",marginBottom:ev.evolucion?6:0}}>
                              {ev.presion_indicada} ATA · {ev.duracion_minutos} min
                              {ev.incidencias && <span style={{color:"#F59E0B"}}> · ⚠ {ev.incidencias}</span>}
                            </div>
                            {ev.evolucion && (
                              <div style={{background:"#7C6AF715",border:"1px solid #7C6AF730",borderRadius:8,padding:"7px 11px",marginBottom:4}}>
                                <div style={{fontSize:10,color:"#7C6AF7",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Evolución médica</div>
                                <div style={{fontSize:12,color:"#E8EAF0",lineHeight:1.5}}>{ev.evolucion}</div>
                              </div>
                            )}
                            {ev.firma_medico && (
                              <div style={{fontSize:11,color:"#10B981",marginTop:3}}>
                                ✓ Supervisado por: {ev.firma_medico}
                              </div>
                            )}
                          </div>
                          {(f.esMedico||f.esAdmin) && ev.es_borrador && (
                            <button onClick={()=>setModalEval(ev)}
                              style={{background:"#7C6AF720",border:"1px solid #7C6AF740",color:"#7C6AF7",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,flexShrink:0}}>
                              ✍ Firmar
                            </button>
                          )}
                          {!ev.es_borrador && (
                            <button onClick={()=>setModalEval(ev)}
                              style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,flexShrink:0}}>
                              Ver
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              });
            })()
      }

      {/* Modal nueva evaluación */}
      {modalNuevaEval && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:620,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#00C4B4",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Nueva Evaluación</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"#E8EAF0"}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}</div>
              </div>
              <button onClick={()=>setModalNuevaEval(false)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>

              {/* N° sesión */}
              <Input label="N° de sesión" type="number" value={formEval.numero_sesion}
                onChange={v=>setFormEval(f=>({...f,numero_sesion:v}))} required error={errEval.numero_sesion}/>

              {/* Selector de paquete/episodio */}
              {comprasPaciente.length > 0 && (
                <Select label="Paquete / Episodio a descontar" value={formEval.compra_id||""}
                  onChange={v=>setFormEval(f=>({...f,compra_id:v}))}
                  options={comprasPaciente.map(c=>({
                    value:c.id,
                    label:`${c.paquetes?.nombre||"Paquete"} — ${c.sesiones_usadas}/${c.sesiones_totales} sesiones usadas`
                  }))}/>
              )}

              {/* SECCIÓN ENFERMERO — Signos vitales */}
              <div style={{fontSize:11,color:"#00C4B4",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:4,paddingBottom:8,borderBottom:"1px solid #1A2035"}}>
                📋 Signos Vitales
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                <Input label="Presión arterial" value={formEval.presion_arterial}
                  onChange={v=>setFormEval(f=>({...f,presion_arterial:v}))} placeholder="120/80" required error={errEval.presion_arterial}/>
                <Input label="Frec. cardíaca (bpm)" value={formEval.frecuencia_cardiaca}
                  onChange={v=>setFormEval(f=>({...f,frecuencia_cardiaca:v}))} placeholder="72" required error={errEval.frecuencia_cardiaca}/>
                <Input label="Saturación O₂ (%)" value={formEval.saturacion_o2}
                  onChange={v=>setFormEval(f=>({...f,saturacion_o2:v}))} placeholder="98" required error={errEval.saturacion_o2}/>
                <Input label="Temperatura (°C)" value={formEval.temperatura}
                  onChange={v=>setFormEval(f=>({...f,temperatura:v}))} placeholder="36.5"/>
                <Input label="Peso (kg)" type="number" value={formEval.peso}
                  onChange={v=>setFormEval(f=>({...f,peso:v}))} placeholder="70"/>
              </div>

              {/* Nivel de dolor */}
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:8}}>
                  Nivel de dolor pre-sesión: <span style={{color:dolorColor(formEval.nivel_dolor),fontWeight:700}}>{formEval.nivel_dolor}/10</span>
                </label>
                <input type="range" min="0" max="10" value={formEval.nivel_dolor}
                  onChange={e=>setFormEval(f=>({...f,nivel_dolor:parseInt(e.target.value)}))}
                  style={{width:"100%",accentColor:"#00C4B4"}}/>
              </div>

              <Select label="Estado general" value={formEval.estado_general}
                onChange={v=>setFormEval(f=>({...f,estado_general:v}))}
                options={["Excelente","Bueno","Regular","Malo"].map(v=>({value:v,label:v}))}/>

              {/* Contraindicaciones del día */}
              <div style={{fontSize:11,color:"#F59E0B",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"1px solid #1A2035"}}>
                ⚠ Contraindicaciones del día
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                {["otitis","claustrofobia","embarazo","fiebre_activa"].map(campo=>(
                  <Select key={campo} label={campo.replace("_"," ").replace(/\w/g,l=>l.toUpperCase())} value={formEval[campo]}
                    onChange={v=>setFormEval(f=>({...f,[campo]:v}))}
                    options={[{value:"No",label:"No"},{value:"Sí",label:"Sí"},{value:"Posible",label:"Posible"}]}/>
                ))}
              </div>

              {/* Parámetros cámara */}
              <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"1px solid #1A2035"}}>
                🫁 Parámetros de sesión
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                <Input label="Presión indicada (ATA)" type="number" value={formEval.presion_indicada}
                  onChange={v=>setFormEval(f=>({...f,presion_indicada:v}))}/>
                <Input label="Duración (min)" type="number" value={formEval.duracion_minutos}
                  onChange={v=>setFormEval(f=>({...f,duracion_minutos:v}))}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Incidencias</label>
                <textarea value={formEval.incidencias} onChange={e=>setFormEval(f=>({...f,incidencias:e.target.value}))}
                  placeholder="Describe cualquier incidencia durante la sesión..." rows={2}
                  style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Observaciones del operador</label>
                <textarea value={formEval.observaciones} onChange={e=>setFormEval(f=>({...f,observaciones:e.target.value}))}
                  placeholder="Observaciones post-sesión..." rows={2}
                  style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              </div>

              {/* SECCIÓN MÉDICO — solo si es médico o admin */}
              {(f.esMedico || f.esAdmin) && (
                <>
                  <div style={{fontSize:11,color:"#10B981",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"1px solid #1A2035"}}>
                    🩺 Sección médica
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Evolución clínica</label>
                    <textarea value={formEval.evolucion} onChange={e=>setFormEval(f=>({...f,evolucion:e.target.value}))}
                      placeholder="Evolución del paciente, respuesta al tratamiento, ajustes de protocolo..." rows={3}
                      style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                  </div>
                  <Input label="Firma de supervisión (nombre completo)" value={formEval.firma_medico}
                    onChange={v=>setFormEval(f=>({...f,firma_medico:v}))}
                    placeholder="Dr. Raúl Aguado Quevedo — CMP 12345"/>
                  <div style={{padding:"8px 12px",background:"#10B98110",border:"1px solid #10B98130",borderRadius:8,fontSize:12,color:"#10B981",marginBottom:4}}>
                    Al firmar confirma: "Ordené verbalmente la terapia hiperbárica. El tratamiento estuvo bajo mi dirección y control general."
                  </div>
                </>
              )}
            </div>
            <div style={{padding:"14px 24px",borderTop:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,color:"#4B5563"}}>
                {!(f.esMedico||f.esAdmin) ? "Se guardará como borrador hasta firma médica" : formEval.firma_medico ? "Se guardará como firmada" : "Sin firma — se guardará como borrador"}
              </div>
              <div style={{display:"flex",gap:10}}>
                <Btn variant="ghost" onClick={()=>setModalNuevaEval(false)}>Cancelar</Btn>
                <Btn onClick={guardarEval} disabled={savingEval}>{savingEval?"Guardando...":"Registrar evaluación"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal firmar evaluación borrador */}
      {modalEval && (f.esMedico||f.esAdmin) && modalEval.es_borrador && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:500,padding:28}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0",marginBottom:4}}>Firmar evaluación — Sesión #{modalEval.numero_sesion}</div>
            <div style={{fontSize:12,color:"#6B7280",marginBottom:20}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos} · {modalEval.fecha}</div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Evolución clínica</label>
              <textarea defaultValue={modalEval.evolucion||""} id="evol-firma" rows={3}
                style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
            </div>
            <Input label="Firma (nombre completo)" value={formEval.firma_medico}
              onChange={v=>setFormEval(f=>({...f,firma_medico:v}))} placeholder="Dr. Nombre Apellido — CMP"/>
            <div style={{padding:"8px 12px",background:"#10B98110",border:"1px solid #10B98130",borderRadius:8,fontSize:12,color:"#10B981",marginBottom:16}}>
              Al firmar confirma supervisión general del tratamiento hiperbárico.
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>{ setModalEval(null); setFormEval(f=>({...f,firma_medico:""})); }}>Cancelar</Btn>
              <Btn onClick={async()=>{
                const evol = document.getElementById("evol-firma")?.value||"";
                if(!formEval.firma_medico?.trim()) return;
                await safeQuery(()=>supabase.from("evaluaciones_medicas").update({
                  evolucion: evol, firma_medico: formEval.firma_medico.trim(),
                  es_borrador:false, medico_id: perfil.id,
                }).eq("id",modalEval.id),"HC:firmarModal");
                setModalEval(null); setFormEval(f=>({...f,firma_medico:""}));
                await abrirPaciente(pacSelec);
              }}>✍ Firmar y cerrar evaluación</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal ver evaluación firmada */}
      {modalEval && !modalEval.es_borrador && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#10B981",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Evaluación Firmada · Sesión #{modalEval.numero_sesion}</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"#E8EAF0"}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}</div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>{modalEval.fecha} · {modalEval.hora?.slice(0,5)} · {modalEval.sedes?.nombre}</div>
              </div>
              <button onClick={()=>setModalEval(null)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {[
                {titulo:"Signos Vitales", color:"#00C4B4", campos:[
                  ["Presión arterial",modalEval.presion_arterial],["FC",modalEval.frecuencia_cardiaca],
                  ["SatO₂",modalEval.saturacion_o2],["Temperatura",modalEval.temperatura],["Peso",modalEval.peso?`${modalEval.peso} kg`:null],
                  ["Dolor",`${modalEval.nivel_dolor}/10`],["Estado",modalEval.estado_general],
                ]},
                {titulo:"Contraindicaciones del día", color:"#F59E0B", campos:[
                  ["Otitis",modalEval.otitis],["Claustrofobia",modalEval.claustrofobia],
                  ["Embarazo",modalEval.embarazo],["Fiebre",modalEval.fiebre_activa],
                ]},
                {titulo:"Parámetros de sesión", color:"#7C6AF7", campos:[
                  ["Presión",`${modalEval.presion_indicada} ATA`],["Duración",`${modalEval.duracion_minutos} min`],
                  ["Incidencias",modalEval.incidencias],["Observaciones",modalEval.observaciones],
                ]},
                {titulo:"Evolución médica", color:"#10B981", campos:[
                  ["Evolución",modalEval.evolucion],["Firmado por",modalEval.firma_medico],
                ]},
              ].map(sec=>(
                <div key={sec.titulo} style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:sec.color,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,paddingBottom:6,borderBottom:"1px solid #1A2035"}}>{sec.titulo}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {sec.campos.filter(([,v])=>v).map(([k,v])=>(
                      <div key={k} style={{background:"#0D1320",borderRadius:8,padding:"8px 12px",gridColumn:["Evolución","Incidencias","Observaciones"].includes(k)?"1/-1":undefined}}>
                        <div style={{fontSize:10,color:"#4B5563",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3}}>{k}</div>
                        <div style={{fontSize:13,color:"#E8EAF0",lineHeight:1.5}}>{v}</div>
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

  // ── Vista lista de pacientes ──
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0"}}>Historias Clínicas</h1>
          <p style={{color:"#4B5563",fontSize:14,marginTop:3}}>{filtrados.length} pacientes con HC</p>
        </div>
      </div>

      {/* Búsqueda */}
      <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar paciente..."
        style={{background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 16px",fontSize:14,fontFamily:"inherit",outline:"none",width:300,marginBottom:16}}/>

      {/* Tabs sede */}
      {f.puedeVerTodasHC && sedes.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:16}}>
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

      {loading ? <div style={{color:"#4B5563"}}>Cargando...</div>
        : filtrados.length === 0
          ? <Card style={{textAlign:"center",padding:"40px",color:"#6B7280"}}>No hay historias clínicas registradas</Card>
          : filtrados.map(hc=>(
            <div key={hc.id} onClick={()=>abrirPaciente(hc)}
              style={{background:"#111827",border:"1px solid #1E2535",borderRadius:12,padding:"14px 18px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="#1E2535"}>
              <div>
                <div style={{fontWeight:600,fontSize:15,color:"#E8EAF0",marginBottom:4}}>
                  {hc.pacientes?.nombres} {hc.pacientes?.apellidos}
                </div>
                <div style={{fontSize:12,color:"#6B7280"}}>
                  DNI {hc.pacientes?.dni} · {hc.sedes?.nombre} · {hc.pacientes?.sesiones_realizadas}/{hc.pacientes?.total_sesiones_prescritas} sesiones
                </div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>{hc.diagnostico_principal}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <Badge color={hc.apto_hiperbarica!==false?"#10B981":"#F87171"}>
                  {hc.apto_hiperbarica!==false?"Apto":"No apto"}
                </Badge>
                <span style={{color:"#4B5563",fontSize:18}}>›</span>
              </div>
            </div>
          ))
      }
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
      estado:             "activo",
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

// ── SESIONES ──────────────────────────────────────────────────
// FASE 3: agenda del día + programar + completar con registro clínico
function Sesiones({perfil}) {
  const f = getRolFlags(perfil);

  const ESTADO_COLOR = {
    programada:"#F59E0B", en_curso:"#00C4B4",
    completada:"#10B981", cancelada:"#F87171", no_asistio:"#6B7280"
  };
  const ESTADO_LABEL = {
    programada:"Programada", en_curso:"En curso",
    completada:"Completada", cancelada:"Cancelada", no_asistio:"No asistió"
  };

  // Fecha seleccionada — default hoy
  const hoy = new Date().toISOString().slice(0,10);
  const [fecha, setFecha]       = useState(hoy);
  const [sesiones, setSesiones] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [verSesion, setVerSesion] = useState(null);  // modal detalle/completar
  const [modalNueva, setModalNueva] = useState(false);

  // Data de soporte
  const { data: pacientesData } = useSupabaseQuery(
    () => {
      let q = supabase.from("pacientes").select("id,nombres,apellidos,dni,sede_principal_id").order("apellidos");
      if(perfil?.sede_id) q = q.eq("sede_principal_id", perfil.sede_id);
      return q;
    }, [], "Sesiones:pacientes"
  );
  const { data: camarasData } = useSupabaseQuery(
    () => {
      let q = supabase.from("camaras").select("id,numero,modelo,sede_id").eq("estado","operativa");
      if(perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
      return q;
    }, [], "Sesiones:camaras"
  );
  const { data: comprasData } = useSupabaseQuery(
    () => supabase.from("compras_paciente")
      .select("id,paciente_id,sesiones_usadas,sesiones_totales,paquetes(nombre)")
      .eq("estado","activo"),
    [], "Sesiones:compras"
  );

  const load = async () => {
    setLoading(true);
    const { data } = await safeQuery(() => {
      let q = supabase.from("vista_agenda_hoy").select("*").eq("fecha", fecha).order("hora_inicio");
      if(perfil?.sede_id && !f.esAdmin && !f.esMedicoEsp) q = q.eq("sede_id", perfil.sede_id);
      return q;
    }, "Sesiones:load");
    setSesiones(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [fecha]); // eslint-disable-line

  // Form nueva sesión
  const formInicial = {
    paciente_id:"", camara_id:"", compra_id:"",
    fecha: hoy, hora_inicio:"08:00", hora_fin:"09:30",
    presion_aplicada:"2.0", duracion_minutos:"90",
    numero_sesion:"",
  };
  const [formNueva, setFormNueva] = useState(formInicial);
  const [savingNueva, setSavingNueva] = useState(false);
  const [errNueva, setErrNueva] = useState({});

  // Form completar sesión
  const [formCompletar, setFormCompletar] = useState({
    hora_inicio_real:"", hora_fin_real:"",
    nivel_dolor:0, estado_general:"Bueno", tolerancia:"Buena",
    observaciones:"", requiere_atencion:false,
  });
  const [savingCompletar, setSavingCompletar] = useState(false);

  const programar = async () => {
    const e = {};
    if(!formNueva.paciente_id) e.paciente_id = "Requerido";
    if(!formNueva.camara_id)   e.camara_id   = "Requerido";
    if(!formNueva.fecha)       e.fecha       = "Requerido";
    if(!formNueva.hora_inicio) e.hora_inicio = "Requerido";
    if(!formNueva.numero_sesion) e.numero_sesion = "Requerido";
    setErrNueva(e);
    if(Object.keys(e).length) return;
    setSavingNueva(true);

    // Obtener sede del paciente o del perfil
    const pac = pacientesData?.find(p => p.id === formNueva.paciente_id);
    const sede_id = pac?.sede_principal_id || perfil?.sede_id;

    const { error } = await safeQuery(() => supabase.from("sesiones").insert({
      paciente_id:       formNueva.paciente_id,
      sede_id,
      camara_id:         formNueva.camara_id,
      compra_id:         formNueva.compra_id || null,
      fecha:             formNueva.fecha,
      hora_inicio:       formNueva.hora_inicio,
      hora_fin:          formNueva.hora_fin,
      presion_aplicada:  parseFloat(formNueva.presion_aplicada) || 2.0,
      duracion_minutos:  parseInt(formNueva.duracion_minutos) || 90,
      numero_sesion:     parseInt(formNueva.numero_sesion),
      estado:            "programada",
      enfermero_id:      f.esEnfermero ? perfil.id : null,
      medico_id:         f.esMedico ? perfil.id : null,
    }), "Sesiones:programar");

    setSavingNueva(false);
    if(error) { alert("Error al programar: " + error.message); return; }
    setModalNueva(false);
    setFormNueva(formInicial);
    setErrNueva({});
    load();
  };

  const iniciar = async (sesion) => {
    await safeQuery(() => supabase.from("sesiones").update({
      estado: "en_curso",
      hora_inicio_real: new Date().toTimeString().slice(0,5),
    }).eq("id", sesion.id), "Sesiones:iniciar");
    load();
  };

  const completar = async () => {
    setSavingCompletar(true);
    const { error } = await safeQuery(() => supabase.from("sesiones").update({
      estado:            "completada",
      hora_fin_real:     formCompletar.hora_fin_real || new Date().toTimeString().slice(0,5),
      hora_inicio_real:  formCompletar.hora_inicio_real || verSesion.hora_inicio,
      nivel_dolor:       formCompletar.nivel_dolor,
      estado_general:    formCompletar.estado_general,
      tolerancia:        formCompletar.tolerancia,
      observaciones:     formCompletar.observaciones || null,
      requiere_atencion: formCompletar.requiere_atencion,
      hc_completada:     true,
    }).eq("id", verSesion.id), "Sesiones:completar");

    // Si requiere atención, crear alerta automáticamente
    if(!error && formCompletar.requiere_atencion) {
      await safeQuery(() => supabase.from("alertas_clinicas").insert({
        paciente_id:  verSesion.paciente_id,
        sede_id:      verSesion.sede_id,
        generada_por: perfil.id,
        origen:       "sesion",
        origen_id:    verSesion.id,
        tipo:         "observacion_critica",
        prioridad:    formCompletar.nivel_dolor >= 7 ? "alta" : "media",
        mensaje:      `Sesión #${verSesion.numero_sesion} completada con observación. ${formCompletar.observaciones || ""}`.trim(),
        estado:       "nueva",
      }), "Sesiones:crearAlerta");
    }

    setSavingCompletar(false);
    if(error) { alert("Error al completar: " + error.message); return; }
    setVerSesion(null);
    load();
  };

  const cancelar = async (sesion) => {
    if(!confirm("¿Cancelar esta sesión?")) return;
    await safeQuery(() => supabase.from("sesiones").update({ estado:"cancelada" }).eq("id", sesion.id), "Sesiones:cancelar");
    load();
  };

  // KPIs del día
  const total      = sesiones.length;
  const completadas = sesiones.filter(s => s.estado === "completada").length;
  const enCurso    = sesiones.filter(s => s.estado === "en_curso").length;
  const pendientes = sesiones.filter(s => s.estado === "programada").length;

  const comprasDelPaciente = (paciente_id) =>
    (comprasData || []).filter(c => c.paciente_id === paciente_id && c.sesiones_usadas < c.sesiones_totales);

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"#E8EAF0",marginBottom:4}}>Sesiones</h1>
          <p style={{color:"#4B5563",fontSize:14}}>Agenda de sesiones hiperbáricas</p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
            style={{background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"8px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          {(f.esAdmin || f.esMedico || f.esEnfermero) && (
            <Btn onClick={()=>setModalNueva(true)}>+ Programar sesión</Btn>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Total del día",  val:total,      color:"#E8EAF0"},
          {label:"En curso",       val:enCurso,    color:"#00C4B4"},
          {label:"Completadas",    val:completadas, color:"#10B981"},
          {label:"Pendientes",     val:pendientes, color:"#F59E0B"},
        ].map((k,i)=>(
          <Card key={i}>
            <div style={{fontSize:11,color:"#6B7280",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:30,fontWeight:700,color:k.color,marginTop:6}}>{k.val}</div>
          </Card>
        ))}
      </div>

      {/* Lista sesiones */}
      {loading
        ? <div style={{color:"#4B5563",padding:20}}>Cargando agenda...</div>
        : sesiones.length === 0
          ? <Card style={{textAlign:"center",padding:"50px"}}>
              <div style={{fontSize:36,opacity:.3,marginBottom:12}}>⚡</div>
              <div style={{color:"#6B7280"}}>No hay sesiones para esta fecha</div>
            </Card>
          : sesiones.map(s => (
            <div key={s.id} style={{
              background:"#111827", border:"1px solid #1E2535",
              borderLeft:`3px solid ${ESTADO_COLOR[s.estado]||"#374151"}`,
              borderRadius:12, padding:"14px 18px", marginBottom:8,
              display:"grid", gridTemplateColumns:"80px 2fr 1fr 1fr 1fr auto",
              alignItems:"center", gap:12,
            }}>
              {/* Hora */}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:700,color:"#00C4B4",fontFamily:"Syne,sans-serif"}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
                <div style={{fontSize:11,color:"#4B5563"}}>{s.hora_fin?.slice(0,5)||""}</div>
              </div>

              {/* Paciente */}
              <div>
                <div style={{fontWeight:600,fontSize:14,color:"#E8EAF0"}}>{s.paciente}</div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>
                  DNI {s.dni} · Sesión #{s.numero_sesion}
                  {s.sesiones_restantes != null && (
                    <span style={{color: s.sesiones_restantes <= 2 ? "#F87171" : "#6B7280"}}>
                      {" "}· {s.sesiones_restantes} restantes
                    </span>
                  )}
                </div>
              </div>

              {/* Cámara */}
              <div style={{fontSize:13,color:"#9CA3AF"}}>
                {s.camara_numero ? `Cámara #${s.camara_numero}` : "—"}
                <div style={{fontSize:11,color:"#4B5563"}}>{s.presion_aplicada} ATA · {s.duracion_minutos} min</div>
              </div>

              {/* Sede */}
              <div style={{fontSize:13,color:"#9CA3AF"}}>{s.sede_nombre}</div>

              {/* Estado */}
              <Badge color={ESTADO_COLOR[s.estado]||"#6B7280"}>{ESTADO_LABEL[s.estado]||s.estado}</Badge>

              {/* Acciones */}
              <div style={{display:"flex",gap:6}}>
                {s.estado === "programada" && (
                  <>
                    <button onClick={()=>iniciar(s)}
                      style={{background:"#00C4B420",border:"1px solid #00C4B440",color:"#00C4B4",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                      ▶ Iniciar
                    </button>
                    <button onClick={()=>cancelar(s)}
                      style={{background:"#F8717115",border:"1px solid #F8717130",color:"#F87171",padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                      ✕
                    </button>
                  </>
                )}
                {s.estado === "en_curso" && (
                  <button onClick={()=>{ setVerSesion(s); setFormCompletar({hora_inicio_real:s.hora_inicio_real||s.hora_inicio?.slice(0,5)||"",hora_fin_real:new Date().toTimeString().slice(0,5),nivel_dolor:0,estado_general:"Bueno",tolerancia:"Buena",observaciones:"",requiere_atencion:false}); }}
                    style={{background:"#10B98120",border:"1px solid #10B98140",color:"#10B981",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                    ✓ Completar
                  </button>
                )}
                {s.estado === "completada" && (
                  <button onClick={()=>setVerSesion(s)}
                    style={{background:"#1A2035",border:"1px solid #2A3550",color:"#9CA3AF",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                    Ver
                  </button>
                )}
              </div>
            </div>
          ))
      }

      {/* Modal programar nueva sesión */}
      {modalNueva && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:520,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>Programar Sesión</div>
              <button onClick={()=>setModalNueva(false)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              <Select label="Paciente" value={formNueva.paciente_id}
                onChange={v=>{ setFormNueva(f=>({...f,paciente_id:v,compra_id:""})); }}
                options={(pacientesData||[]).map(p=>({value:p.id,label:`${p.apellidos}, ${p.nombres} — DNI ${p.dni}`}))} required/>
              {errNueva.paciente_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{errNueva.paciente_id}</div>}

              {/* Paquete activo del paciente */}
              {formNueva.paciente_id && comprasDelPaciente(formNueva.paciente_id).length > 0 && (
                <Select label="Paquete a descontar" value={formNueva.compra_id}
                  onChange={v=>setFormNueva(f=>({...f,compra_id:v}))}
                  options={comprasDelPaciente(formNueva.paciente_id).map(c=>({
                    value:c.id,
                    label:`${c.paquetes?.nombre} — ${c.sesiones_usadas}/${c.sesiones_totales} usadas`
                  }))}/>
              )}

              <Select label="Cámara" value={formNueva.camara_id}
                onChange={v=>setFormNueva(f=>({...f,camara_id:v}))}
                options={(camarasData||[]).map(c=>({value:c.id,label:`Cámara #${c.numero} — ${c.modelo}`}))} required/>
              {errNueva.camara_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{errNueva.camara_id}</div>}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Input label="Fecha" type="date" value={formNueva.fecha}
                  onChange={v=>setFormNueva(f=>({...f,fecha:v}))} required error={errNueva.fecha}/>
                <Input label="N° de sesión" type="number" value={formNueva.numero_sesion}
                  onChange={v=>setFormNueva(f=>({...f,numero_sesion:v}))} required error={errNueva.numero_sesion}/>
                <Input label="Hora inicio" type="time" value={formNueva.hora_inicio}
                  onChange={v=>setFormNueva(f=>({...f,hora_inicio:v}))} required error={errNueva.hora_inicio}/>
                <Input label="Hora fin estimada" type="time" value={formNueva.hora_fin}
                  onChange={v=>setFormNueva(f=>({...f,hora_fin:v}))}/>
                <Input label="Presión (ATA)" type="number" value={formNueva.presion_aplicada}
                  onChange={v=>setFormNueva(f=>({...f,presion_aplicada:v}))}/>
                <Input label="Duración (min)" type="number" value={formNueva.duracion_minutos}
                  onChange={v=>setFormNueva(f=>({...f,duracion_minutos:v}))}/>
              </div>
            </div>
            <div style={{padding:"14px 24px",borderTop:"1px solid #1E2535",display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setModalNueva(false)}>Cancelar</Btn>
              <Btn onClick={programar} disabled={savingNueva}>{savingNueva?"Guardando...":"Programar"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal completar / ver sesión */}
      {verSesion && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"#111827",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"1px solid #1E2535",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:10,color:"#00C4B4",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>
                  Sesión #{verSesion.numero_sesion} · {verSesion.camara_numero ? `Cámara #${verSesion.camara_numero}` : ""}
                </div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"#E8EAF0"}}>{verSesion.paciente}</div>
                <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>
                  {verSesion.sede_nombre} · {verSesion.fecha} · {verSesion.presion_aplicada} ATA · {verSesion.duracion_minutos} min
                </div>
              </div>
              <button onClick={()=>setVerSesion(null)} style={{background:"#1A2035",border:"none",color:"#9CA3AF",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>

              {/* Si completada — mostrar registro */}
              {verSesion.estado === "completada" ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[
                    ["Hora inicio real", verSesion.hora_inicio_real?.slice(0,5)],
                    ["Hora fin real",    verSesion.hora_fin_real?.slice(0,5)],
                    ["Nivel de dolor",   verSesion.nivel_dolor != null ? `${verSesion.nivel_dolor}/10` : null],
                    ["Estado general",   verSesion.estado_general],
                    ["Tolerancia",       verSesion.tolerancia],
                    ["Observaciones",    verSesion.observaciones],
                  ].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} style={{background:"#0D1320",borderRadius:10,padding:"10px 14px",gridColumn:k==="Observaciones"?"1/-1":undefined}}>
                      <div style={{fontSize:11,color:"#4B5563",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{k}</div>
                      <div style={{fontSize:14,color:"#E8EAF0"}}>{v}</div>
                    </div>
                  ))}
                  {verSesion.requiere_atencion && (
                    <div style={{gridColumn:"1/-1",background:"#F8717115",border:"1px solid #F8717130",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#F87171"}}>
                      ⚠ Esta sesión generó una alerta clínica
                    </div>
                  )}
                </div>
              ) : (
                /* Si en_curso — formulario completar */
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                    <Input label="Hora inicio real" type="time" value={formCompletar.hora_inicio_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_inicio_real:v}))}/>
                    <Input label="Hora fin real" type="time" value={formCompletar.hora_fin_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_fin_real:v}))}/>
                  </div>

                  {/* Nivel de dolor */}
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:8}}>
                      Nivel de dolor: <span style={{color: formCompletar.nivel_dolor>=7?"#F87171":formCompletar.nivel_dolor>=4?"#F59E0B":"#10B981",fontWeight:700}}>{formCompletar.nivel_dolor}/10</span>
                    </label>
                    <input type="range" min="0" max="10" value={formCompletar.nivel_dolor}
                      onChange={e=>setFormCompletar(f=>({...f,nivel_dolor:parseInt(e.target.value)}))}
                      style={{width:"100%",accentColor:"#00C4B4"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#4B5563",marginTop:2}}>
                      <span>Sin dolor</span><span>Dolor máximo</span>
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <Select label="Estado general" value={formCompletar.estado_general}
                      onChange={v=>setFormCompletar(f=>({...f,estado_general:v}))}
                      options={["Excelente","Bueno","Regular","Malo"].map(v=>({value:v,label:v}))}/>
                    <Select label="Tolerancia a presión" value={formCompletar.tolerancia}
                      onChange={v=>setFormCompletar(f=>({...f,tolerancia:v}))}
                      options={["Buena","Regular","Mala","Intolerante"].map(v=>({value:v,label:v}))}/>
                  </div>

                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"#9CA3AF",fontWeight:600,display:"block",marginBottom:5}}>Observaciones</label>
                    <textarea value={formCompletar.observaciones}
                      onChange={e=>setFormCompletar(f=>({...f,observaciones:e.target.value}))}
                      placeholder="Incidencias, reacciones, notas del operador..."
                      rows={3}
                      style={{width:"100%",background:"#1A2035",border:"1px solid #2A3550",borderRadius:10,color:"#E8EAF0",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                  </div>

                  {/* Flag alerta */}
                  <div style={{padding:"12px 14px",background:"#1A2035",borderRadius:10,border:"1px solid #2A3550",display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <input type="checkbox" id="reqAtencion" checked={formCompletar.requiere_atencion}
                      onChange={e=>setFormCompletar(f=>({...f,requiere_atencion:e.target.checked}))}
                      style={{width:16,height:16,cursor:"pointer",accentColor:"#F87171"}}/>
                    <label htmlFor="reqAtencion" style={{fontSize:14,color:"#E8EAF0",cursor:"pointer"}}>
                      🔔 Requiere atención médica
                      <span style={{fontSize:12,color:"#6B7280",display:"block"}}>Genera alerta automática al especialista y médico de sede</span>
                    </label>
                  </div>
                </>
              )}
            </div>
            <div style={{padding:"14px 24px",borderTop:"1px solid #1E2535",display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setVerSesion(null)}>Cerrar</Btn>
              {verSesion.estado === "en_curso" && (
                <Btn onClick={completar} disabled={savingCompletar}>
                  {savingCompletar ? "Guardando..." : "✓ Marcar completada"}
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MIS OBSERVACIONES — solo enfermero ── */}
      {f.esEnfermero && (
        <MisObservaciones perfil={perfil}/>
      )}
    </div>
  );
}

// ── MIS OBSERVACIONES (para enfermero) ───────────────────────
function MisObservaciones({perfil}) {
  const [obs, setObs]         = useState([]);
  const [loading, setLoading] = useState(true);

  const ESTADO_COLOR = { nueva:"#F87171", vista:"#F59E0B", resuelta:"#10B981" };
  const ESTADO_LABEL = { nueva:"Pendiente de revisión", vista:"En revisión", resuelta:"Revisada ✓" };
  const ESTADO_ICON  = { nueva:"🔔", vista:"👁", resuelta:"✓" };

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      const { data } = await safeQuery(()=>
        supabase.from("alertas_clinicas")
          .select("id,tipo,prioridad,estado,mensaje,respuesta,created_at,pacientes(nombres,apellidos)")
          .eq("generada_por", perfil.id)
          .order("created_at",{ascending:false})
          .limit(20),
        "MisObservaciones:load"
      );
      if(mounted){ setObs(data||[]); setLoading(false); }
    })();
    return ()=>{ mounted=false; };
  },[perfil.id]);

  if(loading || obs.length===0) return null;

  return (
    <div style={{marginTop:32}}>
      <div style={{fontSize:11,color:"#6B7280",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12,paddingTop:20,borderTop:"1px solid #1E2535"}}>
        Mis observaciones registradas
      </div>
      {obs.map(o=>(
        <div key={o.id} style={{
          background:"#111827",border:"1px solid #1E2535",
          borderLeft:`3px solid ${ESTADO_COLOR[o.estado]}`,
          borderRadius:12,padding:"12px 16px",marginBottom:8,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={{fontSize:14}}>{ESTADO_ICON[o.estado]}</span>
                <span style={{fontSize:13,fontWeight:600,color:"#E8EAF0"}}>
                  {o.pacientes?.nombres} {o.pacientes?.apellidos}
                </span>
                <span style={{fontSize:11,color:"#4B5563"}}>
                  · {new Date(o.created_at).toLocaleDateString("es-PE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}
                </span>
              </div>
              <div style={{fontSize:13,color:"#9CA3AF",lineHeight:1.5,marginBottom:o.respuesta?8:0}}>
                {o.mensaje.length>100 ? o.mensaje.slice(0,100)+"..." : o.mensaje}
              </div>
              {o.respuesta && (
                <div style={{background:"#10B98115",border:"1px solid #10B98130",borderRadius:8,padding:"8px 12px",marginTop:6}}>
                  <div style={{fontSize:10,color:"#10B981",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Respuesta médica</div>
                  <div style={{fontSize:13,color:"#E8EAF0",lineHeight:1.5}}>{o.respuesta}</div>
                </div>
              )}
            </div>
            <span style={{
              background:`${ESTADO_COLOR[o.estado]}15`,color:ESTADO_COLOR[o.estado],
              border:`1px solid ${ESTADO_COLOR[o.estado]}30`,
              borderRadius:99,fontSize:11,fontWeight:700,padding:"3px 10px",whiteSpace:"nowrap",flexShrink:0
            }}>
              {ESTADO_LABEL[o.estado]}
            </span>
          </div>
        </div>
      ))}
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
    () => supabase.from("sedes").select("id,nombre").eq("estado","activo"),
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
      case "dashboard": return f.puedeVerDashboard  ? <DashboardAdmin perfil={perfil}/>        : null;
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
