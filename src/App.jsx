import { useState, useEffect, createContext, useContext } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Helper fecha Lima (UTC-5) ─────────────────────────────────
const fechaHoyLima = () => {
  return new Date().toLocaleDateString("en-CA", {timeZone:"America/Lima"});
};
const mesMesLima = () => {
  return fechaHoyLima().slice(0,7);
};

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

// Crear usuario via Edge Function (service_role seguro en servidor)
const EDGE_CREATE_USER = "https://eyfwqcxcjunrpnqhbbek.supabase.co/functions/v1/create-user";

// FIX BUG 6: lock huérfano de auth-token.
// Singleton para evitar múltiples instancias GoTrueClient en HMR/dev
if (!globalThis.__oxynatur_supabase) {
  globalThis.__oxynatur_supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "oxynatur-auth",
      lock: async (_name, _acquireTimeout, fn) => {
        return await fn();
      },
    },
  });
}
const supabase = globalThis.__oxynatur_supabase;

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
const getColor = (nombre) => SEDE_COLOR[nombre] || "#00A896";

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
  const esATC        = rol === "atc";
  const esAdminSede  = rol === "admin_sede";
  const esMedicoEsp  = esMedico && esEspecialista;
  const esMedicoSede = esMedico && !esEspecialista;

  return {
    // ── Identidad ──
    esAdmin, esMedico, esEnfermero, esATC, esMedicoEsp, esMedicoSede, esAdminSede,

    // ── Acceso a módulos ──
    puedeVerDashboard:      esAdmin || esMedico,
    puedeVerDashboardSede:  esAdminSede,
    puedeVerVentas:         esAdmin || esEnfermero || esAdminSede,
    puedeVerFinanzas:       esAdmin,
    puedeVerSedes:          esAdmin,
    puedeVerUsuarios:       esAdmin,
    puedeVerAlertas:        esAdmin || esMedico,
    // Admin sede y ATC ven prospectos — filtrados por sede en el query
    puedeVerProspectos:     esAdmin || esATC || esEnfermero || esAdminSede,

    // ── Restricciones por sede ──
    // true = solo ve/opera sobre su sede_id
    soloSuSede:             esEnfermero || esAdminSede,
    ventasSoloSuSede:       esEnfermero || esAdminSede,

    // ── Acceso a pacientes ──
    puedeCrearPaciente:      esAdmin || esAdminSede,
    puedeEditarPaciente:     esAdmin || esAdminSede,
    puedeVerTodosPacientes:  esAdmin || esMedicoEsp,

    // ── Acceso a historias clínicas ──
    puedeEscribirProtocolo:    esAdmin || esMedicoEsp,
    puedeEscribirObservacion:  esAdmin || esMedico || esEnfermero || esAdminSede,
    puedeVerTodasHC:           esAdmin || esMedicoEsp,

    // ── UI helpers ──
    rolLabel: esAdmin      ? "Admin General"
            : esMedicoEsp  ? "Médico Especialista"
            : esMedicoSede ? "Médico"
            : esEnfermero  ? "Enfermero"
            : esATC        ? "ATC"
            : esAdminSede  ? "Admin Sede"
            : "Usuario",

    vistaDefault: esAdmin     ? "dashboard"
                : esMedico    ? "alertas"
                : esATC       ? "prospectos"
                : esAdminSede ? "dashboard_sede"
                : "sesiones",
  };
}

// ── Componentes base ──────────────────────────────────────────
const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--bg)"}}>
    <div style={{width:40,height:40,border:"3px solid #1E2535",borderTop:"3px solid #00C4B4",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

const Badge = ({color, children}) => (
  <span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:color+"22",color,border:`1px solid ${color}33`}}>{children}</span>
);

const Card = ({children, style={}}) => (
  <div style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:12,padding:20,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",...style}}>{children}</div>
);

const Btn = ({children,onClick,variant="primary",disabled=false,style={}}) => {
  const styles = {
    primary: {background:"#00A896",color:"white",border:"none"},
    ghost:   {background:"var(--surface)",color:"var(--text2)",border:"0.5px solid #E2E8F0"},
    danger:  {background:"#FEE2E2",color:"#DC2626",border:"0.5px solid #FECACA"},
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{...styles[variant],padding:"9px 20px",borderRadius:10,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontSize:14,fontWeight:600,opacity:disabled?0.5:1,transition:"opacity .2s",...style}}>
      {children}
    </button>
  );
};

const Input = ({label,value,onChange,type="text",placeholder="",required=false,error=""}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:error?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${error?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",WebkitAppearance:"none"}}/>
    {error && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{error}</div>}
  </div>
);

const Select = ({label,value,onChange,options=[],required=false}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:value?"var(--text)":"var(--text3)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",colorScheme:"light dark"}}>
      <option value="" style={{background:"var(--surface)",color:"var(--text3)"}}>Seleccionar...</option>
      {options.map(o=><option key={o.value} value={o.value} style={{background:"var(--surface)",color:"var(--text)"}}>{o.label}</option>)}
    </select>
  </div>
);

// ── LOGIN ─────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

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
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}:root,[data-theme="light"]{--bg:#F4F6FA;--surface:#FFFFFF;--surface2:#F8FAFC;--border:#E2E8F0;--border2:#CBD5E1;--text:#0F172A;--text2:#64748B;--text3:#94A3B8}[data-theme="dark"]{--bg:#0A0F1F;--surface:#0D1320;--surface2:#1A2035;--border:#2A3550;--border2:#374151;--text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8}input::placeholder{color:var(--text3)}select option{background:var(--surface);color:var(--text)}input::-ms-reveal,input::-ms-clear{display:none}input::-webkit-credentials-auto-fill-button{display:none}`}</style>
      <div style={{width:"100%",maxWidth:420,padding:20}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <img src="data:image/jpeg;base64,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" alt="OxyNatur" style={{width:96,height:96,borderRadius:"50%",objectFit:"cover",marginBottom:16,border:"2px solid #00C4B440"}}/>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:800,color:"var(--text)",letterSpacing:"-0.03em"}}>OxyNatur</div>
          <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>Sistema de Gestión Clínica</div>
        </div>
        <Card style={{padding:32}}>
          <div style={{fontSize:18,fontWeight:700,color:"var(--text)",marginBottom:6,fontFamily:"Syne,sans-serif"}}>Iniciar sesión</div>
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:24}}>Acceso autorizado al personal OxyNatur</div>
          {error && <div style={{background:"#F8717115",border:"1px solid #F8717140",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#F87171"}}>⚠ {error}</div>}
          <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="tu@email.com"/>
          <div style={{position:"relative"}}>
            <Input label="Contraseña" value={pass} onChange={setPass} type={showPass?"text":"password"} placeholder="••••••••"/>
            <button onClick={()=>setShowPass(s=>!s)} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",color:"var(--text3)",padding:0,display:"flex",alignItems:"center"}}>
              {showPass
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              }
            </button>
          </div>
          <Btn onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15,marginTop:8}}>
            {loading ? "Ingresando..." : "Ingresar →"}
          </Btn>
        </Card>
        <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"var(--border2)"}}>OxyNatur · Sistema Interno · Acceso Restringido</div>
      </div>
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────
// FASE B: Nav completamente dinámico basado en getRolFlags().
// Badge de alertas recibe alertasNuevas como prop desde App.
function Sidebar({vista, setVista, perfil, onLogout, alertasNuevas = 0, darkMode, setDarkMode}) {
  const f = getRolFlags(perfil);

  const navItems = [
    { id:"dashboard", icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>),  label:"Dashboard",         visible: f.puedeVerDashboard },
    { id:"alertas",   icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>), label:"Alertas Clínicas",  visible: f.puedeVerAlertas,
      badge: alertasNuevas > 0 ? alertasNuevas : null },
    { id:"pacientes", icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>), label:"Pacientes",         visible: true },
    { id:"ventas",    icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M10 19a1 1 0 100 2 1 1 0 000-2zm7 0a1 1 0 100 2 1 1 0 000-2z"/></svg>), label:"Ventas",            visible: f.puedeVerVentas },
    { id:"sesiones",  icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>), label:"Sesiones",          visible: true },
    { id:"historias", icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>), label:"Historias Clínicas", visible: true },
    { id:"finanzas",  icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v2m0 8v2m-3-5c0 1.1 1.34 2 3 2s3-.9 3-2-1.34-2-3-2-3-.9-3-2 1.34-2 3-2 3 .9 3 2"/></svg>), label:"Finanzas",          visible: f.puedeVerFinanzas },
    { id:"sedes",     icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>), label:"Sedes",             visible: f.puedeVerSedes },
    { id:"usuarios",  icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.87"/></svg>), label:"Usuarios",          visible: f.puedeVerUsuarios },
    { id:"prospectos", icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/><line x1="19" y1="8" x2="23" y2="8"/><line x1="21" y1="6" x2="21" y2="10"/></svg>), label:"Prospectos", visible: f.puedeVerProspectos },
    { id:"dashboard_sede", icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>), label:"Mi Sede",             visible: f.puedeVerDashboardSede },
    { id:"agenda",    icon:(<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>), label:"Agenda",            visible: true },
  ].filter(item => item.visible);

  return (
    <div style={{width:210,background:"var(--surface)",borderRight:"0.5px solid #E2E8F0",padding:"20px 10px",display:"flex",flexDirection:"column",gap:2,flexShrink:0,minHeight:"100vh"}}>
      <div style={{padding:"0 8px 24px"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:20,color:"#00A896",letterSpacing:"-0.03em"}}>OxyNatur</div>
        <div style={{fontSize:10,color:"var(--text3)",marginTop:1,letterSpacing:"0.05em",textTransform:"uppercase"}}>{f.rolLabel}</div>
      </div>
      {navItems.map(item=>(
        <button key={item.id} onClick={()=>setVista(item.id)}
          style={{background:vista===item.id?"#00A89620":"none",borderTop:"none",borderRight:"none",borderBottom:"none",borderLeft:vista===item.id?"2px solid #00A896":"2px solid transparent",cursor:"pointer",padding:"9px 14px",borderRadius:8,color:vista===item.id?"#00A896":"var(--text2)",fontFamily:"inherit",fontSize:13,fontWeight:vista===item.id?600:500,display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",transition:"all .15s"}}>
          <span style={{display:"flex",alignItems:"center",opacity:0.7}}>{item.icon}</span>
          <span style={{flex:1}}>{item.label}</span>
          {item.badge && (
            <span style={{background:"#F87171",color:"white",borderRadius:99,fontSize:11,fontWeight:700,padding:"1px 7px",minWidth:20,textAlign:"center"}}>
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </button>
      ))}
      <div style={{marginTop:"auto",padding:"16px 8px 0",borderTop:"0.5px solid #E2E8F0"}}>
        <div style={{fontSize:13,color:"var(--text3)",fontWeight:500}}>{perfil?.nombre}</div>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{perfil?.email}</div>
        <button onClick={onLogout} style={{marginTop:10,background:"none",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,width:"100%"}}>
          Cerrar sesión
        </button>
        <button onClick={()=>setDarkMode(d=>!d)}
          style={{marginTop:6,background:"none",border:"0.5px solid var(--border)",color:"var(--text3)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          {darkMode
            ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Modo claro</>
            : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg> Modo oscuro</>
          }
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
  const hoy = fechaHoyLima();

  const [alertas,      setAlertas]      = useState([]);
  const [sesionesHoy,  setSesionesHoy]  = useState([]);
  const [resumen,      setResumen]      = useState([]);
  const [firmasPend,   setFirmasPend]   = useState([]);
  const [filtroFirmas, setFiltroFirmas] = useState("hoy"); // "hoy" | "todas"
  const [loading,      setLoading]      = useState(true);

  // Estado para firma inline desde Dashboard
  const [firmaModal,   setFirmaModal]   = useState(null);
  const [firmaTexto,   setFirmaTexto]   = useState("");
  const [savingFirma,  setSavingFirma]  = useState(false);

  const abrirFirmaDash = (ev) => {
    setFirmaTexto(perfil?.nombre || "");
    setFirmaModal({...ev, evolucionEdit: ev.evolucion || ""});
  };

  const confirmarFirmaDash = async () => {
    if(!firmaTexto.trim()) return;
    setSavingFirma(true);
    const idxActual = firmasPend.findIndex(e=>e.id===firmaModal.id);
    await safeQuery(()=>
      supabase.from("evaluaciones_medicas").update({
        evolucion:    firmaModal.evolucionEdit || "",
        firma_medico: firmaTexto.trim(),
        es_borrador:  false,
        medico_id:    perfil.id,
      }).eq("id", firmaModal.id), "DashMed:firmar"
    );
    setSavingFirma(false);
    // Ir al siguiente automáticamente
    const nuevaLista = firmasPend.filter(e=>e.id!==firmaModal.id);
    setFirmasPend(nuevaLista);
    if(nuevaLista.length > 0 && idxActual < nuevaLista.length){
      abrirFirmaDash(nuevaLista[idxActual]);
    } else if(nuevaLista.length > 0){
      abrirFirmaDash(nuevaLista[nuevaLista.length-1]);
    } else {
      setFirmaModal(null);
    }
    // Refrescar firmas pendientes
    const { data } = await safeQuery(()=>
      supabase.from("evaluaciones_medicas")
        .select(`id,numero_sesion,fecha,hora,evolucion,incidencias,observaciones,
          presion_arterial,frecuencia_cardiaca,saturacion_o2,temperatura,peso,nivel_dolor,estado_general,
          presion_indicada,duracion_minutos,otitis,claustrofobia,embarazo,fiebre_activa,
          pacientes(nombres,apellidos,dni),sedes(nombre),compras_paciente(paquetes(nombre))`)
        .eq("es_borrador", true)
        .order("fecha",{ascending:true})
        .order("hora",{ascending:true})
        .limit(50), "DashMed:firmasPend"
    );
    setFirmasPend(data||[]);
  };

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      const [r1,r2,r3,r4] = await Promise.all([
        safeQuery(()=> supabase.from("alertas_clinicas")
          .select("id,tipo,prioridad,mensaje,created_at,pacientes(nombres,apellidos),sedes(nombre)")
          .neq("estado","resuelta").order("created_at",{ascending:false}).limit(5),
          "DashMed:alertas"),
        safeQuery(()=> {
          let q = supabase.from("vista_agenda_hoy")
            .select("*").eq("fecha", hoy).order("hora_inicio");
          return q;
        }, "DashMed:sesiones"),
        safeQuery(()=> supabase.from("vista_resumen_sedes").select("*"), "DashMed:resumen"),
        // Cola de firmas pendientes
        safeQuery(()=> {
          let q = supabase.from("evaluaciones_medicas")
            .select(`id,numero_sesion,fecha,hora,evolucion,incidencias,observaciones,
              presion_arterial,frecuencia_cardiaca,saturacion_o2,temperatura,peso,nivel_dolor,estado_general,
              presion_indicada,duracion_minutos,otitis,claustrofobia,embarazo,fiebre_activa,
              pacientes(nombres,apellidos,dni),sedes(nombre,id),compras_paciente(paquetes(nombre))`)
            .eq("es_borrador", true)
            .order("fecha",{ascending:true})
            .order("hora",{ascending:true})
            .limit(50);
          // Médico de sede solo ve firmas de su sede
          if(f.esMedicoSede && perfil.sede_id) {
            q = q.eq("sede_id", perfil.sede_id);
          }
          return q;
        }, "DashMed:firmasPend"),
      ]);
      if(!mounted) return;
      setAlertas(r1.data||[]);
      setSesionesHoy(r2.data||[]);
      setResumen(r3.data||[]);
      setFirmasPend(r4.data||[]);
      setLoading(false);

      // Alerta automática si hay borradores de más de 12 horas sin firmar
      const borradores = r4.data||[];
      const viejos = borradores.filter(e=>{
        const fechaEval = new Date(e.fecha+"T"+(e.hora||"00:00:00"));
        const horasTranscurridas = (Date.now() - fechaEval.getTime()) / (1000*60*60);
        return horasTranscurridas > 12;
      });
      // Solo borradores con paciente_id válido (NOT NULL constraint)
      const viejosConPaciente = viejos.filter(e => e.pacientes?.id);
      if(viejosConPaciente.length > 0 && mounted){
        // Crear alerta automática si no existe ya
        await safeQuery(()=> supabase.from("alertas_clinicas").insert(
          viejosConPaciente.slice(0,3).map(e=>({
            paciente_id:  e.pacientes.id,
            sede_id:      e.sedes?.id || null,
            generada_por: perfil.id,
            origen:       "sistema",
            tipo:         "protocolo_pendiente",
            prioridad:    "alta",
            mensaje:      `Evaluación de sesión #${e.numero_sesion} (${e.fecha}) requiere firma médica hace más de 12 horas.`,
            estado:       "nueva",
          }))
        ).select(), "DashMed:alertaAuto");
      }
    })();
    return ()=>{ mounted=false; };
  },[]); // eslint-disable-line

  const PRIORIDAD_COLOR = {alta:"#F87171",media:"#F59E0B",baja:"var(--text3)"};
  const ESTADO_COLOR    = {programada:"#F59E0B",en_curso:"#00A896",completada:"#10B981",cancelada:"#F87171"};

  if(loading) return <div style={{padding:32,color:"var(--text3)"}}>Cargando dashboard clínico...</div>;

  const sesCompletadas = sesionesHoy.filter(s=>s.estado==="completada").length;
  const sesEnCurso     = sesionesHoy.filter(s=>s.estado==="en_curso").length;
  const sesPendientes  = sesionesHoy.filter(s=>s.estado==="programada").length;

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:700,color:"var(--text)"}}>
          Panel Clínico
        </h1>
        <p style={{color:"var(--text3)",fontSize:14,marginTop:4}}>
          {new Date().toLocaleDateString("es-PE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
          {f.esMedicoEsp && <span style={{color:"#00A896",marginLeft:8}}>· Todas las sedes</span>}
        </p>
      </div>

      {/* KPIs clínicos */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Firmas pendientes",  val:firmasPend.length,  color: firmasPend.length>0?"#F59E0B":"#10B981"},
          {label:"Alertas pendientes", val:alertas.length,    color: alertas.length>0?"#F87171":"#10B981"},
          {label:"Sesiones hoy",       val:sesionesHoy.length, color:"#00A896"},
          {label:"Completadas hoy",    val:sesCompletadas,    color:"#10B981"},
        ].map((k,i)=>(
          <Card key={i} style={{minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:30,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}</div>
          </Card>
        ))}
      </div>

      {/* Cola de firmas pendientes */}
      {firmasPend.length > 0 && (()=>{
        // Filtrar por fecha
        const firmasFiltradas = filtroFirmas === "hoy"
          ? firmasPend.filter(e=>e.fecha===hoy)
          : firmasPend;

        // Contador por sede
        const porSede = firmasPend.reduce((acc,e)=>{
          const s = e.sedes?.nombre || "Sin sede";
          acc[s] = (acc[s]||0)+1;
          return acc;
        },{});

        return (
          <Card style={{padding:0,overflow:"hidden",marginBottom:16,border:"0.5px solid #F59E0B40"}}>
            {/* Header con filtros y contador por sede */}
            <div style={{padding:"12px 18px",borderBottom:"0.5px solid var(--border)",background:"#F59E0B08"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"#F59E0B",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                  ✍ Cola de firmas — {firmasFiltradas.length} de {firmasPend.length} pendiente{firmasPend.length>1?"s":""}
                </div>
                {firmasFiltradas.length > 0 && (
                  <button onClick={()=>abrirFirmaDash(firmasFiltradas[0])}
                    style={{background:"#7C6AF7",color:"white",border:"none",padding:"5px 14px",borderRadius:8,
                      cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                    ✍ Firmar todo
                  </button>
                )}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                {/* Filtro fecha */}
                <div style={{display:"flex",gap:6}}>
                  {[{id:"hoy",label:`Hoy (${firmasPend.filter(e=>e.fecha===hoy).length})`},{id:"todas",label:`Todas (${firmasPend.length})`}].map(f=>(
                    <button key={f.id} onClick={()=>setFiltroFirmas(f.id)}
                      style={{padding:"3px 10px",borderRadius:20,border:"0.5px solid",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600,
                        borderColor:filtroFirmas===f.id?"#F59E0B":"var(--border)",
                        background:filtroFirmas===f.id?"#F59E0B20":"none",
                        color:filtroFirmas===f.id?"#F59E0B":"var(--text3)"}}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {/* Contador por sede */}
                <div style={{display:"flex",gap:10}}>
                  {Object.entries(porSede).map(([sede,count])=>(
                    <span key={sede} style={{fontSize:11,color:"var(--text3)"}}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:getColor(sede),display:"inline-block",marginRight:4}}/>
                      {sede.split(" ")[0]}: <strong style={{color:"var(--text)"}}>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {/* Lista */}
            <div style={{maxHeight:280,overflowY:"auto"}}>
              {firmasFiltradas.length === 0
                ? <div style={{padding:"20px",textAlign:"center",color:"var(--text3)",fontSize:13}}>
                    No hay firmas pendientes para hoy
                  </div>
                : firmasFiltradas.map((ev,i)=>(
                  <div key={ev.id} style={{
                    padding:"11px 18px",
                    borderBottom: i<firmasFiltradas.length-1 ? "0.5px solid var(--border)" : "none",
                    display:"flex",alignItems:"center",gap:12,
                  }}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>
                        {ev.pacientes?.nombres} {ev.pacientes?.apellidos}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span>Sesión #{ev.numero_sesion}</span>
                        <span>·</span>
                        <span>{ev.fecha} {ev.hora?.slice(0,5)}</span>
                        <span>·</span>
                        <span style={{display:"flex",alignItems:"center",gap:3}}>
                          <span style={{width:5,height:5,borderRadius:"50%",background:getColor(ev.sedes?.nombre||""),display:"inline-block"}}/>
                          {ev.sedes?.nombre}
                        </span>
                        {ev.compras_paciente?.paquetes?.nombre && <>
                          <span>·</span>
                          <span>{ev.compras_paciente.paquetes.nombre}</span>
                        </>}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                      <span style={{fontSize:10,background:"#F59E0B20",color:"#F59E0B",padding:"2px 8px",borderRadius:99,fontWeight:700}}>BORRADOR</span>
                      <button onClick={()=>abrirFirmaDash(ev)}
                        style={{background:"#7C6AF7",color:"white",border:"none",padding:"5px 12px",borderRadius:8,
                          cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                        ✍ Firmar
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          </Card>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>

        {/* Alertas pendientes */}
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#F87171",letterSpacing:"0.06em",textTransform:"uppercase"}}>🔔 Alertas pendientes</div>
            <span style={{fontSize:12,color:"var(--text3)"}}>{alertas.length} sin resolver</span>
          </div>
          {alertas.length===0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--text3)",fontSize:13}}>✓ Sin alertas pendientes</div>
            : alertas.map(a=>(
              <div key={a.id} style={{padding:"12px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontSize:11,fontWeight:700,color:PRIORIDAD_COLOR[a.prioridad],background:`${PRIORIDAD_COLOR[a.prioridad]}15`,padding:"2px 8px",borderRadius:99,flexShrink:0,marginTop:1}}>{a.prioridad}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:2}}>{a.pacientes?.nombres} {a.pacientes?.apellidos}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:2}}>{a.sedes?.nombre}</div>
                  <div style={{fontSize:12,color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.mensaje}</div>
                </div>
              </div>
            ))
          }
        </Card>

        {/* Sesiones del día */}
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#00A896",letterSpacing:"0.06em",textTransform:"uppercase"}}>⚡ Sesiones de hoy</div>
            <span style={{fontSize:12,color:"var(--text3)"}}>{sesCompletadas}/{sesionesHoy.length} completadas</span>
          </div>
          {sesionesHoy.length===0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--text3)",fontSize:13}}>Sin sesiones programadas para hoy</div>
            : sesionesHoy.map(s=>(
              <div key={s.id} style={{padding:"10px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"#00A896",minWidth:44}}>{s.hora_inicio?.slice(0,5)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{s.paciente}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{s.sede_nombre} · Ses. #{s.numero_sesion}</div>
                </div>
                <Badge color={ESTADO_COLOR[s.estado]||"var(--text3)"}>{s.estado}</Badge>
              </div>
            ))
          }
        </Card>
      </div>

      {/* Pacientes sin evaluación médica firmada */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#7C6AF7",letterSpacing:"0.06em",textTransform:"uppercase"}}>📋 Pacientes activos por sede</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:0}}>
          {resumen.map((s,i)=>(
            <div key={s.sede_id} style={{padding:"16px 20px",borderRight:i%2===0?"0.5px solid var(--border)":"none",borderBottom:"0.5px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:getColor(s.sede),display:"inline-block"}}/>
                <span style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"var(--text)"}}>{s.sede}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[
                  {l:"Pac. activos", v:s.pacientes_activos, c:getColor(s.sede)},
                  {l:"Ses. hoy",     v:s.sesiones_hoy,      c:"#7C6AF7"},
                  {l:"Ses. mes",     v:s.sesiones_mes,      c:"#10B981"},
                ].map((it,j)=>(
                  <div key={j} style={{background:"var(--surface)",borderRadius:8,padding:"8px",textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:700,color:it.c}}>{it.v||0}</div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>{it.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {/* Modal firma desde Dashboard — con vista completa de la evaluación */}
      {firmaModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:580,width:"100%",
            boxShadow:"0 20px 60px rgba(0,0,0,0.18)",maxHeight:"92vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* Header */}
            <div style={{padding:"16px 20px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)"}}>
                  Revisar y firmar — Sesión #{firmaModal.numero_sesion}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {firmaModal.pacientes?.nombres} {firmaModal.pacientes?.apellidos} · DNI {firmaModal.pacientes?.dni}
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>
                  {firmaModal.fecha} {firmaModal.hora?.slice(0,5)} · {firmaModal.sedes?.nombre} · {firmaModal.compras_paciente?.paquetes?.nombre}
                </div>
              </div>
              <button onClick={()=>setFirmaModal(null)}
                style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:20,padding:"0 4px"}}>×</button>
            </div>

            {/* Contenido scrolleable */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>

              {/* Signos vitales */}
              <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Signos Vitales</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                {[
                  ["Presión arterial", firmaModal.presion_arterial],
                  ["Frec. cardíaca",   firmaModal.frecuencia_cardiaca ? firmaModal.frecuencia_cardiaca+" bpm" : null],
                  ["Saturación O₂",    firmaModal.saturacion_o2 ? firmaModal.saturacion_o2+"%" : null],
                  ["Temperatura",      firmaModal.temperatura ? firmaModal.temperatura+"°C" : null],
                  ["Peso",             firmaModal.peso ? firmaModal.peso+" kg" : null],
                  ["Dolor",            firmaModal.nivel_dolor !== undefined ? firmaModal.nivel_dolor+"/10" : null],
                ].map(([l,v])=>(
                  <div key={l} style={{background:"var(--surface2)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,marginBottom:2}}>{l}</div>
                    <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{v||"—"}</div>
                  </div>
                ))}
              </div>

              {/* Parámetros sesión */}
              <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Parámetros de sesión</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                {[
                  ["Estado general",   firmaModal.estado_general],
                  ["Presión ATA",      firmaModal.presion_indicada ? firmaModal.presion_indicada+" ATA" : null],
                  ["Duración",         firmaModal.duracion_minutos ? firmaModal.duracion_minutos+" min" : null],
                  ["Otitis",           firmaModal.otitis],
                  ["Claustrofobia",    firmaModal.claustrofobia],
                  ["Fiebre",           firmaModal.fiebre_activa],
                ].map(([l,v])=>(
                  <div key={l} style={{background:"var(--surface2)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,marginBottom:2}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:600,color:
                      ["Sí","Sí - contraindicado"].includes(v) ? "#F87171" :
                      v==="Sí - controlada" ? "#F59E0B" : "var(--text)"
                    }}>{v||"—"}</div>
                  </div>
                ))}
              </div>

              {/* Incidencias y observaciones */}
              {(firmaModal.incidencias || firmaModal.observaciones) && (
                <div style={{marginBottom:16}}>
                  {firmaModal.incidencias && firmaModal.incidencias !== "NINGUNO" && (
                    <div style={{background:"#F8717110",border:"0.5px solid #F8717140",borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                      <div style={{fontSize:10,color:"#F87171",fontWeight:700,marginBottom:4}}>⚠ INCIDENCIAS</div>
                      <div style={{fontSize:13,color:"var(--text)"}}>{firmaModal.incidencias}</div>
                    </div>
                  )}
                  {firmaModal.observaciones && firmaModal.observaciones !== "NINGUNO" && (
                    <div style={{background:"var(--surface2)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,marginBottom:4}}>OBSERVACIONES</div>
                      <div style={{fontSize:13,color:"var(--text)"}}>{firmaModal.observaciones}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Evolución médica y firma */}
              <div style={{borderTop:"0.5px solid var(--border)",paddingTop:14,marginTop:4}}>
                <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Nota de evolución médica</div>
                <textarea value={firmaModal.evolucionEdit||""} onChange={e=>setFirmaModal(m=>({...m,evolucionEdit:e.target.value}))}
                  placeholder="Evolución del paciente, respuesta al tratamiento, observaciones clínicas..."
                  rows={3}
                  style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                    color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",
                    resize:"vertical",boxSizing:"border-box",marginBottom:12}}/>
                <input value={firmaTexto} onChange={e=>setFirmaTexto(e.target.value)}
                  placeholder="Firma médica — Dr. Nombre Apellido"
                  style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                    color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
              </div>
            </div>

            {/* Footer */}
            <div style={{padding:"12px 20px",borderTop:"0.5px solid var(--border)",display:"flex",gap:10,justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:11,color:"var(--text3)"}}>
                {firmasPend.findIndex(e=>e.id===firmaModal.id)+1} de {firmasPend.length} pendientes
              </div>
              <div style={{display:"flex",gap:8}}>
                <Btn variant="ghost" onClick={()=>setFirmaModal(null)}>Cancelar</Btn>
                {/* Siguiente sin firmar */}
                {firmasPend.findIndex(e=>e.id===firmaModal.id) < firmasPend.length-1 && (
                  <Btn variant="ghost" onClick={()=>{
                    const idx = firmasPend.findIndex(e=>e.id===firmaModal.id);
                    abrirFirmaDash(firmasPend[idx+1]);
                  }}>Saltar →</Btn>
                )}
                <Btn onClick={confirmarFirmaDash} disabled={savingFirma||!firmaTexto.trim()} style={{background:"#7C6AF7"}}>
                  {savingFirma ? "Firmando..." : "✍ Firmar y siguiente"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DASHBOARD FINANCIERO — solo admin ────────────────────────
function BarChart({ data }) {
  // data: [{mes:"2026-04", val:3980}, ...]
  if(!data || data.length===0) return null;
  const max = Math.max(...data.map(d=>d.val), 1);
  const fmtMes = (m) => new Date(m+"-01T12:00:00").toLocaleDateString("es-PE",{month:"short"});
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,padding:"0 4px"}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <div style={{fontSize:10,color:"var(--text3)",fontWeight:600}}>
            S/{(d.val/1000).toFixed(1)}k
          </div>
          <div style={{
            width:"100%",
            height:`${Math.max((d.val/max)*80,4)}px`,
            background: i===data.length-1 ? "#00A896" : "#00A89640",
            borderRadius:"4px 4px 0 0",
            transition:"height 0.5s",
            minHeight:4,
          }}/>
          <div style={{fontSize:10,color:"var(--text3)",textTransform:"capitalize"}}>{fmtMes(d.mes)}</div>
        </div>
      ))}
    </div>
  );
}

function DashboardFinanciero() {
  const { data: resumen, loading } = useSupabaseQuery(
    () => supabase.from("vista_resumen_sedes").select("*"),
    [],
    "Dashboard:vista_resumen_sedes"
  );
  const filas = resumen || [];

  // Cargar histórico de ingresos últimos 6 meses
  const { data: historicoData } = useSupabaseQuery(
    () => supabase.from("compras_paciente")
      .select("fecha_compra,monto_pagado")
      .neq("estado","cancelado")
      .gte("fecha_compra", (() => {
        const d = new Date(); d.setMonth(d.getMonth()-5); return d.toISOString().slice(0,7)+"-01";
      })())
      .order("fecha_compra"),
    [],
    "Dashboard:historico"
  );

  // Agrupar histórico por mes
  const historico = (() => {
    const meses = {};
    (historicoData||[]).forEach(v => {
      const m = v.fecha_compra?.slice(0,7);
      if(m) meses[m] = (meses[m]||0) + Number(v.monto_pagado||0);
    });
    return Object.entries(meses).sort().map(([mes,val])=>({mes,val}));
  })();

  const totales = {
    pacientes: filas.reduce((a,s)=>a+Number(s.pacientes_activos||0),0),
    sesiones:  filas.reduce((a,s)=>a+Number(s.sesiones_mes||0),0),
    ingresos:  filas.reduce((a,s)=>a+Number(s.ingresos_mes||0),0),
    sesHoy:    filas.reduce((a,s)=>a+Number(s.sesiones_hoy||0),0),
  };

  if(loading) return <div style={{padding:32,color:"var(--text3)"}}>Cargando dashboard...</div>;

  return (
    <div>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:700,color:"var(--text)"}}>Dashboard</h1>
        <p style={{color:"var(--text3)",fontSize:14,marginTop:4}}>{new Date().toLocaleDateString("es-PE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Pacientes Activos", val:totales.pacientes, color:"#00A896", icon:(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.87"/></svg>)},
          {label:"Sesiones este mes",  val:totales.sesiones,  color:"#7C6AF7", icon:(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>)},
          {label:"Ingresos del mes",   val:`S/ ${totales.ingresos.toLocaleString()}`, color:"#10B981", icon:(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v2m0 8v2m-3-5c0 1.1 1.34 2 3 2s3-.9 3-2-1.34-2-3-2-3-.9-3-2 1.34-2 3-2 3 .9 3 2"/></svg>)},
          {label:"Sesiones hoy",       val:totales.sesHoy,   color:"#F59E0B", icon:(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>)},
        ].map((k,i)=>(
          <Card key={i} style={{minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{fontSize:12,color:"var(--text3)",fontWeight:500}}>{k.label}</div>
              <div style={{opacity:0.2,flexShrink:0}}>{k.icon}</div>
            </div>
            <div style={{fontSize:28,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}</div>
          </Card>
        ))}
      </div>
      <div style={{marginBottom:10,fontSize:13,fontWeight:700,color:"var(--text3)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Rendimiento por sede</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
        {filas.map(s=>(
          <Card key={s.sede_id} style={{borderTop:`3px solid ${getColor(s.sede)}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,color:"var(--text)"}}>{s.sede}</div>
              <Badge color="#10B981">Activa</Badge>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[
                {l:"Pac. activos", v:s.pacientes_activos, c:getColor(s.sede)},
                {l:"Ses. hoy",     v:s.sesiones_hoy,      c:"#7C6AF7"},
                {l:"Ingresos mes", v:`S/${Number(s.ingresos_mes||0).toLocaleString()}`, c:"#10B981"},
              ].map((it,j)=>(
                <div key={j} style={{background:"var(--surface)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700,color:it.c}}>{it.v}</div>
                  <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>{it.l}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Gráfico tendencia mensual */}
      {historico.length > 1 && (
        <Card style={{marginTop:16}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:16}}>
            Tendencia de ingresos — últimos {historico.length} meses
          </div>
          <BarChart data={historico}/>
          <div style={{marginTop:8,fontSize:12,color:"var(--text3)",textAlign:"right"}}>
            Total período: <strong style={{color:"#10B981"}}>S/ {historico.reduce((a,d)=>a+d.val,0).toLocaleString("es-PE")}</strong>
          </div>
        </Card>
      )}
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
  // Edición del paciente
  const [modalEditar, setModalEditar] = useState(false);
  const [formEditar, setFormEditar]   = useState({});
  const [savingEditar, setSavingEditar] = useState(false);

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

  const abrirEditar = (pac) => {
    setFormEditar({
      nombres: pac.nombres||"",
      apellidos: pac.apellidos||"",
      dni: pac.dni||"",
      telefono: pac.telefono||"",
      email: pac.email||"",
      genero: pac.genero||"",
      fecha_nacimiento: pac.fecha_nacimiento||"",
      total_sesiones_prescritas: pac.total_sesiones_prescritas||"",
      estado: pac.estado||"activo",
    });
    setModalEditar(true);
  };

  const guardarEdicion = async () => {
    setSavingEditar(true);
    const { error } = await safeQuery(()=>
      supabase.from("pacientes").update({
        nombres:   formEditar.nombres.trim().toUpperCase(),
        apellidos: formEditar.apellidos.trim().toUpperCase(),
        dni:       formEditar.dni,
        telefono:  formEditar.telefono||null,
        email:     formEditar.email||null,
        genero:    formEditar.genero||null,
        fecha_nacimiento: formEditar.fecha_nacimiento||null,
        total_sesiones_prescritas: parseInt(formEditar.total_sesiones_prescritas)||0,
        estado:    formEditar.estado,
      }).eq("id", pacSelec.id),
      "Pacientes:editar"
    );
    setSavingEditar(false);
    if(!error){
      setModalEditar(false);
      // Refrescar datos del perfil
      await abrirPerfil({...pacSelec, ...formEditar});
      load();
    }
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
      nombres:form.nombres.trim().toUpperCase(), apellidos:form.apellidos.trim().toUpperCase(), dni:form.dni,
      telefono:form.telefono, email:form.email, genero:form.genero||null,
      fecha_nacimiento:form.fecha_nacimiento||null,
      sede_principal_id:form.sede_principal_id,
      total_sesiones_prescritas:parseInt(form.total_sesiones_prescritas)||0,
      estado:"activo",
    }).select().single();
    if(!error && pac) {
      await supabase.from("historias_clinicas").insert({
        paciente_id:pac.id, sede_apertura_id:form.sede_principal_id,
        diagnostico_principal:form.diagnostico_hc,
      });
      await supabase.from("paciente_sedes").insert({paciente_id:pac.id, sede_id:form.sede_principal_id});
    }
    setSaving(false);
    setModal(false);
    setForm({nombres:"",apellidos:"",dni:"",telefono:"",email:"",genero:"",fecha_nacimiento:"",sede_principal_id:"",total_sesiones_prescritas:"",diagnostico_hc:""});
    setErr({});
    load();
  };

  const estadoColor = {activo:"#10B981",inactivo:"var(--text3)",completado:"#7C6AF7",pendiente:"#F59E0B",suspendido:"#F87171"};
  const fmtSol = (n) => `S/ ${Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // ── Vista perfil de paciente ──
  if(pacSelec) return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{ setPacSelec(null); setPacDetalle(null); setCompras([]); setUltimasSesiones([]); }}
            style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
            ← Volver
          </button>
          <div>
            <h1 style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:700,color:"var(--text)"}}>
              {pacSelec.nombres} {pacSelec.apellidos}
            </h1>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
              DNI {pacSelec.dni}
              {pacSelec.email && ` · ${pacSelec.email}`}
              {pacSelec.telefono && ` · ${pacSelec.telefono}`}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Badge color={estadoColor[pacSelec.estado]||"var(--text3)"}>{pacSelec.estado}</Badge>
          {f.puedeEditarPaciente && (
            <button onClick={()=>abrirEditar(pacSelec)}
              style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
              ✏ Editar
            </button>
          )}
        </div>
      </div>

      {loadingPerfil ? <div style={{color:"var(--text3)"}}>Cargando perfil...</div> : (
        <>
          {/* Datos generales + progreso */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <Card>
              <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Datos del paciente</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Sede",        pacSelec.sedes?.nombre],
                  ["Género",      pacDetalle?.genero],
                  ["Nacimiento",  pacDetalle?.fecha_nacimiento],
                  ["Diagnóstico", pacDetalle?.diagnostico_hc || "Ver HC"],
                ].filter(([,v])=>v).map(([k,v])=>(
                  <div key={k} style={{background:"var(--surface)",borderRadius:8,padding:"8px 12px"}}>
                    <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3}}>{k}</div>
                    <div style={{fontSize:13,color:"var(--text)"}}>{v}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Progreso de sesiones */}
            <Card>
              <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Progreso del tratamiento</div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="var(--border)" strokeWidth="8"/>
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#00A896" strokeWidth="8"
                      strokeDasharray={`${2*Math.PI*30}`}
                      strokeDashoffset={`${2*Math.PI*30*(1-(pacSelec.sesiones_realizadas||0)/(pacSelec.total_sesiones_prescritas||1))}`}
                      strokeLinecap="round" transform="rotate(-90 36 36)"/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:16,fontWeight:700,color:"#00A896"}}>{pacSelec.sesiones_realizadas||0}</div>
                    <div style={{fontSize:10,color:"var(--text3)"}}>/{pacSelec.total_sesiones_prescritas||0}</div>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:13,color:"var(--text)",fontWeight:600,marginBottom:4}}>
                    {pacSelec.sesiones_realizadas||0} de {pacSelec.total_sesiones_prescritas||0} sesiones
                  </div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>
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
            <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",fontSize:12,fontWeight:700,color:"#7C6AF7",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              Paquetes comprados
            </div>
            {compras.length===0
              ? <div style={{padding:"20px",textAlign:"center",color:"var(--text3)",fontSize:13}}>Sin compras registradas</div>
              : compras.map((c,i)=>{
                  const usadas    = c.sesiones_usadas||0;
                  const totales   = c.sesiones_totales||1;
                  const pct       = Math.round((usadas/totales)*100);
                  const estadoC   = c.estado==="activo"?"#10B981":c.estado==="agotado"?"var(--text3)":"#F87171";
                  return (
                    <div key={c.id} style={{padding:"12px 18px",borderBottom:i<compras.length-1?"0.5px solid var(--border)":"none",display:"flex",alignItems:"center",gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{c.paquetes?.nombre||"Paquete"}</span>
                          <Badge color={estadoC}>{c.estado}</Badge>
                        </div>
                        <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>
                          {c.fecha_compra} · {fmtSol(c.monto_pagado)} · {c.metodo_pago||""}
                          {c.fecha_vencimiento && ` · Vence: ${c.fecha_vencimiento}`}
                        </div>
                        {/* Barra de progreso */}
                        <div style={{height:4,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:pct>=100?"#10B981":"#00A896",borderRadius:2,transition:"width .3s"}}/>
                        </div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>{usadas}/{totales} sesiones usadas ({pct}%)</div>
                      </div>
                    </div>
                  );
                })
            }
          </Card>

          {/* Últimas sesiones */}
          <Card style={{padding:0,overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",fontSize:12,fontWeight:700,color:"#F59E0B",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              Últimas sesiones
            </div>
            {ultimasSesiones.length===0
              ? <div style={{padding:"20px",textAlign:"center",color:"var(--text3)",fontSize:13}}>Sin sesiones registradas</div>
              : ultimasSesiones.map((s,i)=>{
                  const ECOLOR = {programada:"#F59E0B",en_curso:"#00A896",completada:"#10B981",cancelada:"#F87171",no_asistio:"var(--text3)"};
                  return (
                    <div key={s.id} style={{padding:"10px 18px",borderBottom:i<ultimasSesiones.length-1?"0.5px solid var(--border)":"none",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:700,color:"#00A896",minWidth:44}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:"var(--text)"}}>Sesión #{s.numero_sesion} · {s.fecha}</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>{s.sedes?.nombre} · Cámara #{s.camaras?.numero||"—"} · {s.presion_aplicada} ATA · {s.duracion_minutos} min</div>
                      </div>
                      <Badge color={ECOLOR[s.estado]||"var(--text3)"}>{s.estado}</Badge>
                    </div>
                  );
                })
            }
          </Card>
        </>
      )}
      {/* Modal editar paciente */}
      {modalEditar && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,width:"100%",maxWidth:520,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.12)"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Editar Paciente</div>
              <button onClick={()=>setModalEditar(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Input label="Nombres (ej: JUAN CARLOS)" placeholder="Solo nombres propios" value={formEditar.nombres} onChange={v=>setFormEditar(f=>({...f,nombres:v.toUpperCase()}))} required/>
                <Input label="Apellidos (ej: GARCIA LOPEZ)" placeholder="Apellido paterno + materno" value={formEditar.apellidos} onChange={v=>setFormEditar(f=>({...f,apellidos:v.toUpperCase()}))} required/>
                <Input label="DNI" value={formEditar.dni} onChange={v=>setFormEditar(f=>({...f,dni:v}))} required/>
                <Input label="Teléfono" value={formEditar.telefono} onChange={v=>setFormEditar(f=>({...f,telefono:v}))}/>
                <Input label="Email" value={formEditar.email} onChange={v=>setFormEditar(f=>({...f,email:v}))} type="email"/>
                <Input label="Fecha Nacimiento" value={formEditar.fecha_nacimiento} onChange={v=>setFormEditar(f=>({...f,fecha_nacimiento:v}))} type="date"/>
              </div>
              <Select label="Género" value={formEditar.genero} onChange={v=>setFormEditar(f=>({...f,genero:v}))}
                options={[{value:"M",label:"Masculino"},{value:"F",label:"Femenino"},{value:"Otro",label:"Otro"}]}/>
              <Input label="Sesiones Prescritas" value={formEditar.total_sesiones_prescritas} onChange={v=>setFormEditar(f=>({...f,total_sesiones_prescritas:v}))} type="number"/>
              <Select label="Estado" value={formEditar.estado} onChange={v=>setFormEditar(f=>({...f,estado:v}))}
                options={[{value:"activo",label:"Activo"},{value:"inactivo",label:"Inactivo"},{value:"completado",label:"Completado"},{value:"suspendido",label:"Suspendido"}]}/>
            </div>
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setModalEditar(false)}>Cancelar</Btn>
              <Btn onClick={guardarEdicion} disabled={savingEditar}>{savingEditar?"Guardando...":"Guardar cambios"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Lista de pacientes ──
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)"}}>Pacientes</h1>
          <p style={{color:"var(--text3)",fontSize:14,marginTop:3}}>{filtrados.length} pacientes encontrados</p>
        </div>
        {f.puedeCrearPaciente && <Btn onClick={()=>setModal(true)}>+ Nuevo Paciente</Btn>}
      </div>
      <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar por nombre o DNI..."
        style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 16px",fontSize:14,fontFamily:"inherit",outline:"none",width:300,marginBottom:18}}/>
      {loading
        ? <div style={{color:"var(--text3)",padding:20}}>Cargando...</div>
        : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",padding:"0 18px 10px",fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Paciente</span><span>DNI</span><span>Sede</span><span>Sesiones</span><span>Estado</span>
            </div>
            {filtrados.map(p=>(
              <div key={p.id} onClick={()=>abrirPerfil(p)}
                style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"14px 18px",marginBottom:8,display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",alignItems:"center",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                <div>
                  <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>{p.nombres} {p.apellidos}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{p.email||"Sin email"}</div>
                </div>
                <div style={{fontSize:13,color:"var(--text2)"}}>{p.dni}</div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:getColor(p.sedes?.nombre),display:"inline-block",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--text)"}}>{p.sedes?.nombre||"—"}</span>
                </div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{p.sesiones_realizadas}<span style={{color:"var(--text3)",fontWeight:400}}>/{p.total_sesiones_prescritas}</span></div>
                <div><Badge color={estadoColor[p.estado]||"var(--text3)"}>{p.estado}</Badge></div>
                {p.canal_origen && (()=>{
                  const canalColor = {
                    whatsapp:  {bg:"#D1FAE5", color:"#065F46", label:"WhatsApp"},
                    referido:  {bg:"#DBEAFE", color:"#1E40AF", label:"Referido"},
                    instagram: {bg:"#FCE7F3", color:"#9D174D", label:"Instagram"},
                    facebook:  {bg:"#EDE9FE", color:"#5B21B6", label:"Facebook"},
                    directo:   {bg:"#F1F5F9", color:"#475569", label:"Directo"},
                    otro:      {bg:"#F1F5F9", color:"#475569", label:"Otro"},
                  }[p.canal_origen?.toLowerCase()] || {bg:"#F1F5F9", color:"#475569", label:p.canal_origen};
                  return (
                    <div style={{fontSize:11,fontWeight:600,background:canalColor.bg,color:canalColor.color,
                      borderRadius:6,padding:"2px 8px",display:"inline-block"}}>
                      {canalColor.label}
                    </div>
                  );
                })()}
              </div>
            ))}
            {filtrados.length===0 && <div style={{color:"var(--text3)",textAlign:"center",padding:"40px 0",fontSize:14}}>No se encontraron pacientes</div>}
          </>
        )
      }
      {modal && f.puedeCrearPaciente && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Nuevo Paciente</div>
              <button onClick={()=>setModal(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                <Input label="Nombres (ej: JUAN CARLOS)" placeholder="Solo nombres propios" value={form.nombres} onChange={v=>setF("nombres",v.toUpperCase())} required error={err.nombres}/>
                <Input label="Apellidos (ej: GARCIA LOPEZ)" placeholder="Apellido paterno + materno" value={form.apellidos} onChange={v=>setF("apellidos",v.toUpperCase())} required error={err.apellidos}/>
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
                <label style={{fontSize:12,color:err.diagnostico_hc?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Diagnóstico Principal <span style={{color:"#F87171"}}>*</span></label>
                <textarea value={form.diagnostico_hc} onChange={e=>setF("diagnostico_hc",e.target.value)} rows={3}
                  placeholder="Diagnóstico para la historia clínica..."
                  style={{width:"100%",background:"var(--surface2)",border:`1px solid ${err.diagnostico_hc?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                {err.diagnostico_hc && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{err.diagnostico_hc}</div>}
              </div>
            </div>
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"flex-end",gap:10}}>
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

  // Firma inline
  const [firmaModal, setFirmaModal] = useState(null); // eval que se está firmando
  const [firmaTexto, setFirmaTexto] = useState("");
  const [savingFirma, setSavingFirma] = useState(false);

  const dolorColor = (n) => parseInt(n)>=7?"#F87171":parseInt(n)>=4?"#F59E0B":"#10B981";
  const estColor   = (e) => ["Excelente","Bueno"].includes(e)?"#10B981":e==="Regular"?"#F59E0B":"#F87171";

  // ── Export PDF de HC ──
  const exportarPDF = async () => {
    await new Promise((res,rej)=>{
      if(window.jspdf) return res();
      const s = document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
    const { jsPDF } = window.jspdf;
    const norm = (str) => String(str==null?"":str)
      .replace(/á/g,"a").replace(/é/g,"e").replace(/í/g,"i").replace(/ó/g,"o").replace(/ú/g,"u")
      .replace(/Á/g,"A").replace(/É/g,"E").replace(/Í/g,"I").replace(/Ó/g,"O").replace(/Ú/g,"U")
      .replace(/ñ/g,"n").replace(/Ñ/g,"N").replace(/ü/g,"u").replace(/Ü/g,"U");

    const doc = new jsPDF();
    const pac = pacSelec.pacientes;
    const hc  = hcMaestra;
    const LOGO_B64 = "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";
    const PAGE_W = 210;
    const PAGE_H = 297;
    const MARGIN = 14;
    const CONTENT_W = PAGE_W - MARGIN*2;
    let y = 0;
    let pageNum = 1;

    const addHeader = () => {
      // Fondo header
      doc.setFillColor(0, 75, 140);
      doc.rect(0, 0, PAGE_W, 28, "F");
      // Logo
      try { doc.addImage(LOGO_B64, "PNG", MARGIN, 2, 22, 22); } catch(e) {}
      // Titulo
      doc.setFont("helvetica","bold");
      doc.setFontSize(11);
      doc.setTextColor(255,255,255);
      doc.text("HISTORIA CLINICA - OXIGENOTERAPIA HIPERBARICA", 40, 11);
      doc.setFont("helvetica","normal");
      doc.setFontSize(8);
      doc.text("Consorcio Estilo Medico S.A.C.  |  RUC: 20614901781", 40, 17);
      // Sede info
      const sedeNombre = (pacSelec.sedes?.nombre || "").toLowerCase();
      const sedeInfo = sedeNombre.includes("molisalud") || sedeNombre.includes("molina")
        ? "Molisalud: Av. Javier Prado 5998, La Molina  |  Tel: 987203017"
        : "Clinica San Miguel Arcangel: Jr. Las Gardenias 754, SJL  |  Tel: (01)387-5457";
      doc.text(sedeInfo, 40, 23);
      y = 34;
    };

    const addFooter = () => {
      doc.setDrawColor(200,200,200);
      doc.line(MARGIN, PAGE_H-14, PAGE_W-MARGIN, PAGE_H-14);
      doc.setFontSize(8);
      doc.setFont("helvetica","normal");
      doc.setTextColor(120,120,120);
      doc.text("Director Medico: Dr. Raul Aguado  |  CMP 028600  |  RNE 022132", MARGIN, PAGE_H-9);
      doc.text(`Pagina ${pageNum}  |  Emitido: ${new Date().toLocaleDateString("es-PE")} ${new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"})}`, PAGE_W-MARGIN, PAGE_H-9, {align:"right"});
    };

    const checkPage = (needed=20) => {
      if(y + needed > PAGE_H-20) {
        addFooter();
        doc.addPage();
        pageNum++;
        addHeader();
      }
    };

    const txt = (text, x, size=10, bold=false, color=[30,30,30]) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", bold?"bold":"normal");
      doc.setTextColor(...color);
      doc.text(String(text||""), x, y);
    };

    const nl = (h=6) => { y += h; };
    const line = (color=[220,220,220], x1=MARGIN, x2=PAGE_W-MARGIN) => {
      doc.setDrawColor(...color);
      doc.line(x1, y, x2, y);
      nl(5);
    };

    const sectionTitle = (title) => {
      checkPage(16);
      doc.setFillColor(0, 168, 150);
      doc.rect(MARGIN, y-4, CONTENT_W, 9, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      doc.setTextColor(255,255,255);
      doc.text(norm(title).toUpperCase(), MARGIN+3, y+1);
      nl(10);
    };

    // ── PÁGINA 1 ──────────────────────────────────────────
    addHeader();

    // Datos del paciente
    sectionTitle("Datos del Paciente");
    doc.setFillColor(245,248,255);
    doc.rect(MARGIN, y-2, CONTENT_W, 28, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica","bold");
    doc.setTextColor(0,75,140);
    doc.text(`${norm(pac?.apellidos||"")}  ${norm(pac?.nombres||"")}`, MARGIN+4, y+5);
    doc.setFontSize(9);
    doc.setFont("helvetica","normal");
    doc.setTextColor(60,60,60);
    doc.text(`DNI: ${pac?.dni||"-"}   |   Sede: ${norm(pacSelec.sedes?.nombre||"-")}   |   N° HC: ${norm(hc?.numero_hc||pacSelec.id?.slice(-6)||"-")}`, MARGIN+4, y+12);
    doc.text(`Sesiones: ${pac?.sesiones_realizadas||0} realizadas  /  ${pac?.total_sesiones_prescritas||0} prescritas   |   Apto HBOT: ${hc?.apto_hiperbarica!==false?"SI":"NO"}`, MARGIN+4, y+19);
    doc.text(`Fecha de emision: ${new Date().toLocaleDateString("es-PE")}`, MARGIN+4, y+25);
    nl(32);

    // HC Maestra
    sectionTitle("Historia Clinica Maestra - Antecedentes");
    const camposHC = [
      ["Diagnostico principal", hc?.diagnostico_principal],
      ["Antecedentes personales", hc?.antecedentes_personales],
      ["Antecedentes familiares", hc?.antecedentes_familiares],
      ["Alergias", hc?.alergias],
      ["Medicamentos habituales", hc?.medicamentos_habituales],
      ["Contraindicaciones", hc?.contraindicaciones],
      ["Observaciones generales", hc?.observaciones_generales],
    ];
    camposHC.forEach(([label, val]) => {
      if(!val) return;
      checkPage(14);
      doc.setFontSize(9);
      doc.setFont("helvetica","bold");
      doc.setTextColor(0,75,140);
      doc.text(norm(label)+":", MARGIN+2, y);
      doc.setFont("helvetica","normal");
      doc.setTextColor(50,50,50);
      const lines = doc.splitTextToSize(norm(val), CONTENT_W-30);
      doc.text(lines, MARGIN+45, y);
      nl(5 * Math.max(lines.length, 1) + 2);
    });

    // ── EVALUACIONES ──────────────────────────────────────
    nl(4);
    sectionTitle(`Evaluaciones por Sesion (${evals.length} registros)`);

    evals.forEach((ev, i) => {
      const isBorrador = ev.es_borrador || !ev.firma_medico;
      checkPage(50);

      // Card background
      const cardColor = isBorrador ? [255,251,240] : [240,255,250];
      doc.setFillColor(...cardColor);
      doc.setDrawColor(isBorrador ? 220 : 0, isBorrador ? 180 : 168, isBorrador ? 0 : 150);
      doc.roundedRect(MARGIN, y-2, CONTENT_W, 2, 2, 2, "FD");

      // Session header
      doc.setFillColor(isBorrador ? 245 : 0, isBorrador ? 245 : 168, isBorrador ? 245 : 150);
      doc.rect(MARGIN, y-2, CONTENT_W, 8, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      doc.setTextColor(isBorrador ? 100 : 255, isBorrador ? 80 : 255, isBorrador ? 0 : 255);
      doc.text(`Sesion #${ev.numero_sesion}  -  ${ev.fecha||"-"}  -  ${norm(ev.sedes?.nombre||"")}`, MARGIN+3, y+3);
      if(isBorrador) {
        doc.setFontSize(8);
        doc.setTextColor(180,120,0);
        doc.text("BORRADOR - pendiente firma medica", PAGE_W-MARGIN-3, y+3, {align:"right"});
      }
      nl(11);

      // PRE-SESION
      checkPage(12);
      doc.setFillColor(235,235,255);
      doc.rect(MARGIN+2, y-2, (CONTENT_W/2)-3, 10, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(8);
      doc.setTextColor(60,60,180);
      doc.text("PRE-SESION", MARGIN+4, y+2);
      doc.setFont("helvetica","normal");
      doc.setTextColor(50,50,50);
      const preData = [
        ev.presion_arterial_pre ? `PA: ${ev.presion_arterial_pre}` : null,
        ev.frecuencia_cardiaca ? `FC: ${ev.frecuencia_cardiaca}bpm` : null,
        ev.saturacion_o2_pre ? `SatO2: ${ev.saturacion_o2_pre}%` : null,
        ev.temperatura ? `T: ${ev.temperatura}C` : null,
        ev.peso ? `Peso: ${ev.peso}kg` : null,
      ].filter(Boolean).join("   ");
      doc.text(preData || "Sin datos PRE", MARGIN+4, y+7);
      nl(13);

      // POST-SESION
      checkPage(12);
      doc.setFillColor(225,245,240);
      doc.rect(MARGIN+2, y-2, (CONTENT_W/2)-3, 10, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(8);
      doc.setTextColor(0,120,100);
      doc.text("POST-SESION", MARGIN+4, y+2);
      doc.setFont("helvetica","normal");
      doc.setTextColor(50,50,50);
      const postData = [
        ev.presion_arterial ? `PA: ${ev.presion_arterial}` : null,
        ev.frecuencia_cardiaca_post ? `FC: ${ev.frecuencia_cardiaca_post}bpm` : null,
        ev.saturacion_o2 ? `SatO2: ${ev.saturacion_o2}%` : null,
        ev.nivel_dolor!=null ? `Dolor: ${ev.nivel_dolor}/10` : null,
        ev.estado_general ? `Estado: ${norm(ev.estado_general)}` : null,
        ev.tolerancia ? `Tolerancia: ${norm(ev.tolerancia)}` : null,
      ].filter(Boolean).join("   ");
      doc.text(postData || "Sin datos POST", MARGIN+4, y+7);
      nl(13);

      // Parametros sesion
      checkPage(8);
      doc.setFontSize(8);
      doc.setFont("helvetica","normal");
      doc.setTextColor(80,80,80);
      const params = [
        ev.presion_indicada ? `Presion: ${ev.presion_indicada}ATA` : null,
        ev.duracion_minutos ? `Duracion: ${ev.duracion_minutos}min` : null,
      ].filter(Boolean).join("   |   ");
      doc.text(params, MARGIN+4, y);
      nl(6);

      // Cuestionario resumen (solo los Si)
      const cpre = ev.cuestionario_pre || {};
      const alertasCpre = [
        cpre.resfriado && "Resfriado",
        cpre.dolor_oidos && "Dolor oidos",
        cpre.fiebre && "Fiebre",
        cpre.alcohol && "Alcohol",
        cpre.medicamento_nuevo && "Medicamento nuevo",
        cpre.sintoma_nuevo && "Sintoma nuevo",
      ].filter(Boolean);
      if(alertasCpre.length > 0) {
        checkPage(8);
        doc.setFontSize(8);
        doc.setFont("helvetica","bold");
        doc.setTextColor(200,80,0);
        doc.text(`Alertas pre-sesion: ${alertasCpre.join(", ")}`, MARGIN+4, y);
        nl(6);
      }

      // Observaciones
      if(ev.observaciones) {
        checkPage(10);
        doc.setFontSize(8);
        doc.setFont("helvetica","italic");
        doc.setTextColor(80,80,80);
        const obsLines = doc.splitTextToSize(`Obs: ${norm(ev.observaciones)}`, CONTENT_W-10);
        doc.text(obsLines, MARGIN+4, y);
        nl(5 * obsLines.length + 2);
      }

      // Evolucion medica
      if(ev.evolucion) {
        checkPage(10);
        doc.setFontSize(8);
        doc.setFont("helvetica","italic");
        doc.setTextColor(0,75,140);
        const evolLines = doc.splitTextToSize(`Evolucion: ${norm(ev.evolucion)}`, CONTENT_W-10);
        doc.text(evolLines, MARGIN+4, y);
        nl(5 * evolLines.length + 2);
      }

      // Firma
      checkPage(8);
      if(ev.firma_medico) {
        doc.setFontSize(8);
        doc.setFont("helvetica","bold");
        doc.setTextColor(0,120,80);
        doc.text(`Supervisado por: ${norm(ev.firma_medico)}`, MARGIN+4, y);
      } else {
        doc.setFontSize(8);
        doc.setFont("helvetica","italic");
        doc.setTextColor(180,120,0);
        doc.text("Pendiente firma medica", MARGIN+4, y);
      }
      nl(6);

      // Separador
      doc.setDrawColor(200,200,200);
      doc.line(MARGIN, y, PAGE_W-MARGIN, y);
      nl(6);
    });

    addFooter();
    const filename = `HC_${norm(pac?.apellidos||"pac")}_${norm(pac?.nombres||"")}_(${new Date().toISOString().slice(0,10)}).pdf`;
    doc.save(filename);
  };

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

      // Verificar si venimos desde Agenda con un paciente específico
      const pacienteId = localStorage.getItem("oxynatur-hc-paciente");
      if(pacienteId && mounted){
        localStorage.removeItem("oxynatur-hc-paciente");
        const { data: hcs } = await safeQuery(()=>
          supabase.from("historias_clinicas")
            .select("*, pacientes(id,nombres,apellidos,dni,estado,sesiones_realizadas,total_sesiones_prescritas), sedes!sede_apertura_id(nombre)")
            .eq("paciente_id", pacienteId)
            .limit(1).single(), "HC:open_from_agenda"
        );
        if(hcs && mounted) abrirPaciente(hcs);
      }
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
      contraindicaciones_screening: Object.keys(hc.contraindicaciones_screening||{}).length > 0 ? hc.contraindicaciones_screening : {"neumotorax":{presente:false},"epilepsia":{presente:false},"embarazo_ci":{presente:false},"claustrofobia_severa":{presente:false},"marcapasos":{presente:false},"infeccion_viral":{presente:false},"quimioterapia":{presente:false},"perforacion_timpanica":{presente:false},"insuf_cardiaca":{presente:false}},
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

    // Cargar evaluaciones médicas formales
    const { data: evalsData } = await safeQuery(()=>
      supabase.from("evaluaciones_medicas")
        .select("*, sedes(nombre), perfiles!medico_id(nombre), compras_paciente(id,fecha_compra,paquetes(nombre,cantidad_sesiones))")
        .eq("paciente_id", hc.paciente_id)
        .order("fecha",{ascending:false})
        .order("numero_sesion",{ascending:false}),
      "HC:evals"
    );

    // Cargar sesiones completadas que no tienen evaluacion_id (sin evaluación médica aún)
    const { data: sesionesData } = await safeQuery(()=>
      supabase.from("sesiones")
        .select("id,numero_sesion,fecha,hora_inicio,hora_inicio_real,hora_fin_real,duracion_minutos,presion_aplicada,presion_arterial,presion_arterial_pre,saturacion_o2,saturacion_o2_pre,frecuencia_cardiaca,temperatura,peso,nivel_dolor,estado_general,tolerancia,observaciones,requiere_atencion,compra_id,sede_id,hc_completada,sedes(nombre),cuestionario_pre")
        .eq("paciente_id", hc.paciente_id)
        .eq("estado", "completada")
        .is("evaluacion_id", null)
        .order("fecha",{ascending:false})
        .order("numero_sesion",{ascending:false}),
      "HC:sesiones"
    );

    // Convertir sesiones completadas al formato de evaluaciones (como borradores)
    const sesionesComoEvals = (sesionesData||[]).map(s => ({
      id: `sesion_${s.id}`,
      _es_sesion: true,
      _sesion_id: s.id,
      numero_sesion: s.numero_sesion,
      fecha: s.fecha,
      hora: s.hora_inicio_real || s.hora_inicio,
      presion_arterial: s.presion_arterial,
      presion_arterial_pre: s.presion_arterial_pre,
      saturacion_o2: s.saturacion_o2,
      saturacion_o2_pre: s.saturacion_o2_pre,
      frecuencia_cardiaca: s.frecuencia_cardiaca,
      temperatura: s.temperatura,
      peso: s.peso,
      nivel_dolor: s.nivel_dolor,
      estado_general: s.estado_general,
      tolerancia: s.tolerancia,
      observaciones: s.observaciones,
      requiere_atencion: s.requiere_atencion,
      presion_indicada: s.presion_aplicada,
      duracion_minutos: s.duracion_minutos,
      compra_id: s.compra_id,
      sede_id: s.sede_id,
      sedes: s.sedes,
      es_borrador: true,
      firma_medico: null,
      evolucion: null,
      cuestionario_pre: s.cuestionario_pre,
    }));

    // Deduplicar — no mostrar sesión si ya hay evaluación con misma fecha+numero_sesion
    const evalKeys = new Set((evalsData||[]).map(e=>`${e.fecha}_${e.numero_sesion}`).filter(Boolean));
    const sesionsFiltradas = sesionesComoEvals.filter(s=>!evalKeys.has(`${s.fecha}_${s.numero_sesion}`));

    // Combinar y ordenar por fecha + numero_sesion
    const combined = [...(evalsData||[]), ...sesionsFiltradas].sort((a,b)=>{
      if(b.fecha !== a.fecha) return b.fecha.localeCompare(a.fecha);
      return (b.numero_sesion||0) - (a.numero_sesion||0);
    });

    setEvals(combined);
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
        contraindicaciones_screening: formHC.contraindicaciones_screening || {},
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
        duracion_minutos:    [60,90,120].includes(parseInt(formEval.duracion_minutos)) ? parseInt(formEval.duracion_minutos) : 90,
        incidencias:         formEval.incidencias||'',
        observaciones:       formEval.observaciones||'',
        evolucion:           formEval.evolucion||'',
        firma_medico:        esMedFirmando
          ? formEval.firma_medico
          : '',
        es_borrador:         !esMedFirmando,
        compra_id:           formEval.compra_id || null,
      }),
      "HC:guardarEval"
    );
    setSavingEval(false);
    if(error){
      setErrEval({general: "Error al guardar: " + (error.message || JSON.stringify(error))});
      return;
    }
    setModalNuevaEval(false);
    setFormEval(evalInicial);
    setErrEval({});
    await abrirPaciente(pacSelec);
  };

  // Médico firma una evaluación borrador — inline sin prompt()
  const abrirFirma = (ev) => {
    setFirmaTexto(perfil?.nombre || "");
    setFirmaModal({...ev, evolucionEdit: ev.evolucion || ""});
  };

  const confirmarFirma = async () => {
    if(!firmaTexto.trim()) return;
    setSavingFirma(true);

    if(firmaModal._es_sesion) {
      // Crear evaluación médica desde sesión completada
      // Extraer cuestionario_pre si existe
      const cpre = firmaModal.cuestionario_pre || {};
      const { data: nuevaEval } = await safeQuery(()=>
        supabase.from("evaluaciones_medicas").insert({
          historia_id:       hcMaestra?.id || pacSelec.id,
          paciente_id:       pacSelec.paciente_id,
          sede_id:           firmaModal.sede_id,
          compra_id:         firmaModal.compra_id || null,
          numero_sesion:     firmaModal.numero_sesion || 1,
          fecha:             firmaModal.fecha || new Date().toISOString().slice(0,10),
          hora:              firmaModal.hora || new Date().toTimeString().slice(0,8),
          presion_arterial:  firmaModal.presion_arterial || "—",
          frecuencia_cardiaca: String(firmaModal.frecuencia_cardiaca || "—"),
          saturacion_o2:     String(firmaModal.saturacion_o2 || "—"),
          presion_arterial_pre: firmaModal.presion_arterial_pre || null,
          saturacion_o2_pre: firmaModal.saturacion_o2_pre ? Number(firmaModal.saturacion_o2_pre) : null,
          temperatura:       firmaModal.temperatura ? String(firmaModal.temperatura) : null,
          peso:              firmaModal.peso ? Number(firmaModal.peso) : null,
          nivel_dolor:       Number(firmaModal.nivel_dolor) || 0,
          estado_general:    firmaModal.estado_general || "Bueno",
          tolerancia:        firmaModal.tolerancia || null,
          observaciones:     firmaModal.observaciones || null,
          presion_indicada:  Number(firmaModal.presion_indicada || firmaModal.presion_aplicada) || 2.0,
          duracion_minutos:  Number(firmaModal.duracion_minutos) || 60,
          otitis:            cpre.dolor_oidos ? "Sí" : "No",
          claustrofobia:     cpre.claustrofobia ? "Sí" : "No",
          embarazo:          cpre.embarazo ? "Sí" : "No",
          fiebre_activa:     cpre.fiebre ? "Sí" : "No",
          requiere_atencion: firmaModal.requiere_atencion || false,
          evolucion:         firmaModal.evolucionEdit || "",
          firma_medico:      firmaTexto.trim(),
          medico_id:         perfil.id,
          es_borrador:       false,
        }).select().single(),
        "HC:firmar:crear"
      );
      if(nuevaEval) {
        await safeQuery(()=>
          supabase.from("sesiones").update({ evaluacion_id: nuevaEval.id }).eq("id", firmaModal._sesion_id),
          "HC:firmar:vincular"
        );
      }
    } else {
      await safeQuery(()=>
        supabase.from("evaluaciones_medicas").update({
          evolucion:    firmaModal.evolucionEdit || firmaModal.evolucion || "",
          firma_medico: firmaTexto.trim(),
          es_borrador:  false,
          medico_id:    perfil.id,
        }).eq("id", firmaModal.id),
        "HC:firmar"
      );
    }

    setSavingFirma(false);
    setFirmaModal(null);
    setFirmaTexto("");
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
            style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
            ← Volver
          </button>
          <div>
            <h1 style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:700,color:"var(--text)"}}>
              {pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}
            </h1>
            <div style={{fontSize:12,color:"var(--text3)"}}>
              DNI {pacSelec.pacientes?.dni} · {pacSelec.sedes?.nombre} · {pacSelec.pacientes?.sesiones_realizadas}/{pacSelec.pacientes?.total_sesiones_prescritas} sesiones
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" onClick={exportarPDF} style={{fontSize:12}}>
            ⬇ Exportar PDF
          </Btn>
          {/* Boton "Nueva evaluacion" eliminado: el flujo ahora es 100% automatico
              via Sesiones (PRE -> POST -> Firma medica) */}
        </div>
      </div>

      {/* HC MAESTRA */}
      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",display:"flex",alignItems:"center",gap:8}}>
            Historia Clínica Maestra
            {hcMaestra?.numero_hc && (
              <span style={{fontSize:10,color:"var(--text3)",fontWeight:500,background:"var(--surface2)",padding:"1px 8px",borderRadius:99,border:"0.5px solid var(--border)"}}>
                HC-{String(hcMaestra.numero_hc).padStart(3,"0")}
              </span>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Badge color={pacSelec.apto_hiperbarica!==false?"#10B981":"#F87171"}>
              {pacSelec.apto_hiperbarica!==false?"Apto HBOT":"No apto HBOT"}
            </Badge>
            {f.puedeEscribirProtocolo && !editandoHC && (
              <button onClick={()=>setEditandoHC(true)}
                style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
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
                  <label style={{fontSize:11,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
                  <textarea value={formHC[key]||""} onChange={e=>setFormHC(f=>({...f,[key]:e.target.value}))}
                    rows={2} style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 12px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                </div>
              ))}
            </div>
            <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface)",borderRadius:8}}>
              <input type="checkbox" checked={formHC.apto_hiperbarica!==false}
                onChange={e=>setFormHC(f=>({...f,apto_hiperbarica:e.target.checked}))}
                style={{width:16,height:16,accentColor:"#00A896"}}/>
              <span style={{fontSize:14,color:"var(--text)"}}>Paciente apto para terapia hiperbárica</span>
            </div>
            {/* Screening de contraindicaciones absolutas */}
            <div style={{marginBottom:16,border:"0.5px solid #F8717140",borderRadius:10,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",background:"#F8717108",borderBottom:"0.5px solid #F8717130",fontSize:11,fontWeight:700,color:"#F87171",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                Screening — Contraindicaciones absolutas para HBOT
              </div>
              <div style={{padding:"10px 14px"}}>
                {[
                  ["neumotorax","Neumotórax no tratado"],
                  ["epilepsia","Epilepsia o convulsiones sin tratamiento controlado"],
                  ["embarazo_ci","Embarazo (salvo riesgo vital)"],
                  ["claustrofobia_severa","Claustrofobia severa"],
                  ["marcapasos","Marcapasos u otro dispositivo eléctrico implantable"],
                  ["infeccion_viral","Infección viral respiratoria activa severa"],
                  ["quimioterapia","Uso reciente de bleomicina, doxorrubicina o cisplatino (últimos 3 meses)"],
                  ["perforacion_timpanica","Perforación timpánica activa no tratada"],
                  ["insuf_cardiaca","Insuficiencia cardíaca descompensada"],
                ].map(([key, label])=>{
                  const val = formHC.contraindicaciones_screening?.[key] || {};
                  return (
                    <div key={key} style={{marginBottom:10,paddingBottom:10,borderBottom:"0.5px solid var(--border)"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:val.presente ? 6 : 0}}>
                        <div style={{display:"flex",gap:16,flexShrink:0}}>
                          {[["si","Sí",true],["no","No",false]].map(([v,l,val_bool])=>(
                            <label key={v} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:13}}>
                              <input type="radio"
                                checked={val.presente===val_bool}
                                onChange={()=>setFormHC(f=>({...f,
                                  contraindicaciones_screening:{
                                    ...f.contraindicaciones_screening,
                                    [key]:{...val, presente:val_bool}
                                  }
                                }))}
                                style={{accentColor: val_bool?"#F87171":"#10B981"}}/>
                              <span style={{color:val.presente===val_bool?(val_bool?"#F87171":"#10B981"):"var(--text2)",fontWeight:val.presente===val_bool?700:400}}>{l}</span>
                            </label>
                          ))}
                        </div>
                        <span style={{fontSize:13,color:"var(--text)",flex:1}}>{label}</span>
                        {val.presente && <span style={{fontSize:10,background:"#F8717120",color:"#F87171",padding:"1px 8px",borderRadius:99,fontWeight:700,flexShrink:0}}>CONTRAINDICADO</span>}
                      </div>
                      {val.presente && (
                        <input value={val.observacion||""} placeholder="Observación..."
                          onChange={e=>setFormHC(f=>({...f,
                            contraindicaciones_screening:{
                              ...f.contraindicaciones_screening,
                              [key]:{...val, observacion:e.target.value}
                            }
                          }))}
                          style={{width:"100%",background:"var(--surface)",border:"0.5px solid #F8717140",borderRadius:8,
                            color:"var(--text)",padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setEditandoHC(false)}>Cancelar</Btn>
              <Btn onClick={guardarHCMaestra} disabled={savingHC}>{savingHC?"Guardando...":"Guardar HC"}</Btn>
            </div>
          </div>
        ) : (<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              ["Diagnóstico",         hcMaestra?.diagnostico_principal,    true],
              ["Antec. personales",   hcMaestra?.antecedentes_personales,   false],
              ["Antec. familiares",   hcMaestra?.antecedentes_familiares,   false],
              ["Alergias",            hcMaestra?.alergias,                  false],
              ["Medicamentos",        hcMaestra?.medicamentos_habituales,   false],
              ["Contraindicaciones",  hcMaestra?.contraindicaciones,        true],
            ].map(([label,val,full])=> val ? (
              <div key={label} style={{background:"var(--surface)",borderRadius:10,padding:"10px 14px",gridColumn:full?"1/-1":undefined}}>
                <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{label}</div>
                <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{val}</div>
              </div>
            ) : null)}
          </div>
            {/* Screening — vista de solo lectura */}
            {hcMaestra?.contraindicaciones_screening && Object.values(hcMaestra.contraindicaciones_screening).some(v=>v.presente) && (
              <div style={{marginTop:10,border:"0.5px solid #F8717140",borderRadius:10,overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"#F8717108",fontSize:11,fontWeight:700,color:"#F87171",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                  Contraindicaciones absolutas presentes
                </div>
                <div style={{padding:"10px 14px"}}>
                  {[
                    ["neumotorax","Neumotórax no tratado"],
                    ["epilepsia","Epilepsia o convulsiones sin tratamiento controlado"],
                    ["embarazo_ci","Embarazo (salvo riesgo vital)"],
                    ["claustrofobia_severa","Claustrofobia severa"],
                    ["marcapasos","Marcapasos u otro dispositivo eléctrico implantable"],
                    ["infeccion_viral","Infección viral respiratoria activa severa"],
                    ["quimioterapia","Uso reciente de bleomicina, doxorrubicina o cisplatino (últimos 3 meses)"],
                    ["perforacion_timpanica","Perforación timpánica activa no tratada"],
                    ["insuf_cardiaca","Insuficiencia cardíaca descompensada"],
                  ].filter(([key])=>hcMaestra.contraindicaciones_screening[key]?.presente).map(([key,label])=>{
                    const v = hcMaestra.contraindicaciones_screening[key];
                    return (
                      <div key={key} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
                        <span style={{color:"#F87171",fontWeight:700,flexShrink:0}}>✕</span>
                        <div>
                          <div style={{fontSize:13,color:"var(--text)",fontWeight:500}}>{label}</div>
                          {v.observacion && <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{v.observacion}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </>)}
      </Card>

      {/* EVALUACIONES POR SESIÓN */}
      <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
        Evaluaciones por sesión ({evals.length})
      </div>

      {loadingEvals
        ? <div style={{color:"var(--text3)"}}>Cargando evaluaciones...</div>
        : evals.length === 0
          ? <Card style={{textAlign:"center",padding:"30px",color:"var(--text3)"}}>Sin evaluaciones registradas aún</Card>
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
                      background: epIdx===0 ? "#00A89608" : "var(--surface2)",
                      border:`0.5px solid ${epIdx===0?"#00A89630":"var(--border)"}`,
                      borderRadius:12,marginBottom:8,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <div style={{
                          width:32,height:32,borderRadius:8,
                          background: epIdx===0?"linear-gradient(135deg,#00C4B4,#7C6AF7)":"var(--border)",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:13,fontWeight:700,color:"white",flexShrink:0,
                        }}>{epNum}</div>
                        <div>
                          <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"var(--text)"}}>
                            Episodio {epNum}
                            {ep.evals[0]?.compras_paciente?.paquetes?.nombre && (
                              <span style={{fontSize:12,color:"var(--text2)",fontWeight:400,marginLeft:8}}>
                                — {ep.evals[0].compras_paciente.paquetes.nombre}
                              </span>
                            )}
                            {epIdx===0 && <span style={{fontSize:11,color:"#00A896",marginLeft:8,fontWeight:400}}>● Activo</span>}
                          </div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>
                            {fechaInicio}{fechaFin && fechaFin!==fechaInicio ? ` → ${fechaFin}` : ""} · {evCount} sesiones
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        {borradores > 0 && <Badge color="#F59E0B">{borradores} pendiente{borradores>1?"s":""}</Badge>}
                        {completo && <Badge color="#10B981">✓ Completo</Badge>}
                        <span style={{fontSize:11,color:"var(--text3)"}}>{firmadas}/{evCount} firmadas</span>
                      </div>
                    </div>

                    {/* Evaluaciones del episodio */}
                    {ep.evals.map(ev=>(
                      <div key={ev.id} style={{
                        background:"var(--surface)",
                        border:`1px solid ${ev.es_borrador?"#F59E0B40":"var(--border)"}`,
                        borderLeft:`3px solid ${ev.es_borrador?"#F59E0B":ev.firma_medico?"#10B981":"#00A896"}`,
                        borderRadius:12,padding:"14px 18px",marginBottom:6,marginLeft:8,
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                              <span style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"var(--text)"}}>Sesión #{ev.numero_sesion}</span>
                              <span style={{fontSize:12,color:"var(--text3)"}}>{ev.fecha} · {ev.hora?.slice(0,5)}</span>
                              {ev.es_borrador && <Badge color="#F59E0B">Borrador</Badge>}
                              {!ev.es_borrador && ev.firma_medico && <Badge color="#10B981">✓ Firmado</Badge>}
                            </div>
                            {/* PRE y POST separados para sesiones, solo POST para evaluaciones */}
                            {ev._es_sesion && (ev.presion_arterial_pre || ev.saturacion_o2_pre) && (
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                                <div style={{background:"var(--surface2)",borderRadius:8,padding:"6px 10px"}}>
                                  <div style={{fontSize:10,color:"#7C6AF7",fontWeight:700,marginBottom:4}}>PRE-SESIÓN</div>
                                  <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12}}>
                                    {ev.presion_arterial_pre && <span><b>PA:</b> {ev.presion_arterial_pre}</span>}
                                    {ev.frecuencia_cardiaca && <span><b>FC:</b> {ev.frecuencia_cardiaca}</span>}
                                    {ev.saturacion_o2_pre && <span><b>SatO₂:</b> {ev.saturacion_o2_pre}%</span>}
                                    {ev.temperatura && <span><b>T°:</b> {ev.temperatura}°C</span>}
                                    {ev.peso && <span><b>Peso:</b> {ev.peso}kg</span>}
                                  </div>
                                </div>
                                <div style={{background:"var(--surface2)",borderRadius:8,padding:"6px 10px"}}>
                                  <div style={{fontSize:10,color:"#00A896",fontWeight:700,marginBottom:4}}>POST-SESIÓN</div>
                                  <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12}}>
                                    {ev.presion_arterial && <span><b>PA:</b> {ev.presion_arterial}</span>}
                                    {ev.frecuencia_cardiaca_post && <span><b>FC:</b> {ev.frecuencia_cardiaca_post} bpm</span>}
                                    {ev.saturacion_o2 && <span><b>SatO₂:</b> {ev.saturacion_o2}%</span>}
                                    {ev.nivel_dolor!=null && <span><b>Dolor:</b> {ev.nivel_dolor}/10</span>}
                                    {ev.estado_general && <span><b>Estado:</b> {ev.estado_general}</span>}
                                    {ev.tolerancia && <span><b>Tolerancia:</b> {ev.tolerancia}</span>}
                                  </div>
                                </div>
                              </div>
                            )}
                            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:ev.evolucion?8:0}}>
                              {[
                                ["PA",    ev._es_sesion ? null : ev.presion_arterial],
                                ["FC",    ev._es_sesion ? null : ev.frecuencia_cardiaca],
                                ["SatO₂", ev._es_sesion ? null : ev.saturacion_o2],
                                ["Dolor", ev._es_sesion ? null : (ev.nivel_dolor!=null?`${ev.nivel_dolor}/10`:null)],
                                ["Estado",ev._es_sesion ? null : ev.estado_general],
                              ].filter(([,v])=>v).map(([k,v])=>(
                                <div key={k} style={{background:"var(--surface)",borderRadius:8,padding:"5px 8px",textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase"}}>{k}</div>
                                  <div style={{fontSize:12,fontWeight:600,color:"var(--text)",marginTop:1}}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{fontSize:11,color:"var(--text3)",marginBottom:ev.evolucion?6:0}}>
                              {ev.presion_indicada} ATA · {ev.duracion_minutos} min
                              {ev.incidencias && <span style={{color:"#F59E0B"}}> · ⚠ {ev.incidencias}</span>}
                            </div>
                            {ev.evolucion && (
                              <div style={{background:"#7C6AF715",border:"1px solid #7C6AF730",borderRadius:8,padding:"7px 11px",marginBottom:4}}>
                                <div style={{fontSize:10,color:"#7C6AF7",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Evolución médica</div>
                                <div style={{fontSize:12,color:"var(--text)",lineHeight:1.5}}>{ev.evolucion}</div>
                              </div>
                            )}
                            {ev.firma_medico && (
                              <div style={{fontSize:11,color:"#10B981",marginTop:3}}>
                                ✓ Supervisado por: {ev.firma_medico}
                              </div>
                            )}
                          </div>
                          {(f.esMedico||f.esAdmin) && ev.es_borrador && (
                            <button onClick={()=>abrirFirma(ev)}
                              style={{background:"#7C6AF720",border:"1px solid #7C6AF740",color:"#7C6AF7",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,flexShrink:0}}>
                              ✍ Firmar
                            </button>
                          )}
                          {!ev.es_borrador && (
                            <button onClick={()=>setModalEval(ev)}
                              style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,flexShrink:0}}>
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
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:620,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#00A896",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Nueva Evaluación</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)"}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}</div>
              </div>
              <button onClick={()=>setModalNuevaEval(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>

              {errEval.general && <div style={{background:"#FEE2E2",border:"1px solid #F87171",borderRadius:10,padding:"10px 14px",color:"#F87171",fontSize:13,marginBottom:16}}>{errEval.general}</div>}

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
              <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:4,paddingBottom:8,borderBottom:"0.5px solid var(--border)"}}>
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
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:8}}>
                  Nivel de dolor pre-sesión: <span style={{color:dolorColor(formEval.nivel_dolor),fontWeight:700}}>{formEval.nivel_dolor}/10</span>
                </label>
                <input type="range" min="0" max="10" value={formEval.nivel_dolor}
                  onChange={e=>setFormEval(f=>({...f,nivel_dolor:parseInt(e.target.value)}))}
                  style={{width:"100%",accentColor:"#00A896"}}/>
              </div>

              <Select label="Estado general" value={formEval.estado_general}
                onChange={v=>setFormEval(f=>({...f,estado_general:v}))}
                options={["Excelente","Bueno","Regular","Malo"].map(v=>({value:v,label:v}))}/>

              {/* Contraindicaciones del día */}
              <div style={{fontSize:11,color:"#F59E0B",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"0.5px solid var(--border)"}}>
                ⚠ Contraindicaciones del día
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                {["otitis","embarazo","fiebre_activa"].map(campo=>(
                  <Select key={campo} label={campo.replace("_"," ").replace(/\b\w/g,l=>l.toUpperCase())} value={formEval[campo]}
                    onChange={v=>setFormEval(f=>({...f,[campo]:v}))}
                    options={[{value:"No",label:"No"},{value:"Sí",label:"Sí"}]}/>
                ))}
                <Select label="Claustrofobia" value={formEval.claustrofobia}
                  onChange={v=>setFormEval(f=>({...f,claustrofobia:v}))}
                  options={[{value:"No",label:"No"},{value:"Sí - controlada",label:"Sí - controlada"},{value:"Sí - contraindicado",label:"Sí - contraindicado"}]}/>
              </div>

              {/* Parámetros cámara */}
              <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"0.5px solid var(--border)"}}>
                🫁 Parámetros de sesión
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                <Input label="Presión indicada (ATA)" type="number" value={formEval.presion_indicada}
                  onChange={v=>setFormEval(f=>({...f,presion_indicada:v}))}/>
                <Select label="Duración (min)" value={String(formEval.duracion_minutos)}
                  onChange={v=>setFormEval(f=>({...f,duracion_minutos:v}))}
                  options={[{value:"60",label:"60 min"},{value:"90",label:"90 min"},{value:"120",label:"120 min"}]}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Incidencias</label>
                <textarea value={formEval.incidencias} onChange={e=>setFormEval(f=>({...f,incidencias:e.target.value}))}
                  placeholder="Describe cualquier incidencia durante la sesión..." rows={2}
                  style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Observaciones del operador</label>
                <textarea value={formEval.observaciones} onChange={e=>setFormEval(f=>({...f,observaciones:e.target.value}))}
                  placeholder="Observaciones post-sesión..." rows={2}
                  style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              </div>

              {/* SECCIÓN MÉDICO — solo si es médico o admin */}
              {(f.esMedico || f.esAdmin) && (
                <>
                  <div style={{fontSize:11,color:"#10B981",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:8,paddingBottom:8,borderBottom:"0.5px solid var(--border)"}}>
                    🩺 Sección médica
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Evolución clínica</label>
                    <textarea value={formEval.evolucion} onChange={e=>setFormEval(f=>({...f,evolucion:e.target.value}))}
                      placeholder="Evolución del paciente, respuesta al tratamiento, ajustes de protocolo..." rows={3}
                      style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,color:"var(--text3)"}}>
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
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:500,padding:28}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:4}}>Firmar evaluación — Sesión #{modalEval.numero_sesion}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos} · {modalEval.fecha}</div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Evolución clínica</label>
              <textarea defaultValue={modalEval.evolucion||""} id="evol-firma" rows={3}
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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

      {/* Modal firma inline — dentro del perfil del paciente */}
      {firmaModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:420,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.12)"}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:4}}>
              Firmar evaluación — Sesión #{firmaModal.numero_sesion}
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>
              {firmaModal.fecha} · {firmaModal.sedes?.nombre}
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>Nota de evolución médica</label>
              <textarea value={firmaModal.evolucionEdit||""} onChange={e=>setFirmaModal(m=>({...m,evolucionEdit:e.target.value}))}
                placeholder="Evolución del paciente, respuesta al tratamiento, observaciones clínicas..."
                rows={3}
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",
                  resize:"vertical",boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>Firma médica (nombre completo)</label>
              <input value={firmaTexto} onChange={e=>setFirmaTexto(e.target.value)}
                placeholder="Dr. Nombre Apellido"
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setFirmaModal(null)}>Cancelar</Btn>
              <Btn onClick={confirmarFirma} disabled={savingFirma||!firmaTexto.trim()} style={{background:"#7C6AF7"}}>
                {savingFirma?"Firmando...":"✍ Confirmar firma"}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal ver evaluación firmada */}
      {modalEval && !modalEval.es_borrador && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#10B981",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Evaluación Firmada · Sesión #{modalEval.numero_sesion}</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)"}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{modalEval.fecha} · {modalEval.hora?.slice(0,5)} · {modalEval.sedes?.nombre}</div>
              </div>
              <button onClick={()=>setModalEval(null)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {[
                {titulo:"Signos Vitales", color:"#00A896", campos:[
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
                  <div style={{fontSize:10,color:sec.color,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,paddingBottom:6,borderBottom:"0.5px solid var(--border)"}}>{sec.titulo}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {sec.campos.filter(([,v])=>v).map(([k,v])=>(
                      <div key={k} style={{background:"var(--surface)",borderRadius:8,padding:"8px 12px",gridColumn:["Evolución","Incidencias","Observaciones"].includes(k)?"1/-1":undefined}}>
                        <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3}}>{k}</div>
                        <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{v}</div>
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
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)"}}>Historias Clínicas</h1>
          <p style={{color:"var(--text3)",fontSize:14,marginTop:3}}>{filtrados.length} pacientes con HC</p>
        </div>
      </div>

      {/* Búsqueda */}
      <div style={{position:"relative",marginBottom:16}}>
        <svg style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"var(--text3)"}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input value={busq} onChange={e=>setBusq(e.target.value)}
          placeholder="Buscar por nombre, DNI o diagnóstico..."
          style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,
            color:"var(--text)",padding:"10px 16px 10px 38px",fontSize:14,fontFamily:"inherit",
            outline:"none",boxSizing:"border-box"}}/>
        {busq && (
          <button onClick={()=>setBusq("")}
            style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
              background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:18,padding:2}}>
            ×
          </button>
        )}
      </div>

      {/* Tabs sede */}
      {f.puedeVerTodasHC && sedes.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[{id:"todas",nombre:"Todas"},...sedes].map(s=>(
            <button key={s.id} onClick={()=>setSedeTab(s.id)}
              style={{padding:"6px 16px",borderRadius:20,border:"1px solid",fontSize:13,cursor:"pointer",fontFamily:"inherit",
                borderColor:sedeTab===s.id?"#00A896":"var(--border)",
                background:sedeTab===s.id?"#F0FDFB":"none",
                color:sedeTab===s.id?"#00A896":"var(--text3)"}}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {loading ? <div style={{color:"var(--text3)"}}>Cargando...</div>
        : filtrados.length === 0
          ? <Card style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>No hay historias clínicas registradas</Card>
          : filtrados.map(hc=>(
            <div key={hc.id} onClick={()=>abrirPaciente(hc)}
              style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"14px 18px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div>
                <div style={{fontWeight:600,fontSize:15,color:"var(--text)",marginBottom:4}}>
                  {hc.pacientes?.nombres} {hc.pacientes?.apellidos}
                </div>
                <div style={{fontSize:12,color:"var(--text3)"}}>
                  DNI {hc.pacientes?.dni} · {hc.sedes?.nombre} · {hc.pacientes?.sesiones_realizadas}/{hc.pacientes?.total_sesiones_prescritas} sesiones
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{hc.diagnostico_principal}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <Badge color={hc.apto_hiperbarica!==false?"#10B981":"#F87171"}>
                  {hc.apto_hiperbarica!==false?"Apto":"No apto"}
                </Badge>
                <span style={{color:"var(--text3)",fontSize:18}}>›</span>
              </div>
            </div>
          ))
      }

      {/* Modal firma inline */}
      {firmaModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:420,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.12)"}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:4}}>
              Firmar evaluación — Sesión #{firmaModal.numero_sesion}
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>
              {firmaModal.fecha} · {firmaModal.sedes?.nombre}
            </div>
            {/* Evolución médica */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>
                Nota de evolución médica
              </label>
              <textarea value={firmaModal.evolucionEdit||""} onChange={e=>setFirmaModal(m=>({...m,evolucionEdit:e.target.value}))}
                placeholder="Evolución del paciente, respuesta al tratamiento, observaciones clínicas..."
                rows={3}
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",
                  resize:"vertical",boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>
                Firma médica (nombre completo)
              </label>
              <input value={firmaTexto} onChange={e=>setFirmaTexto(e.target.value)}
                placeholder="Dr. Nombre Apellido"
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setFirmaModal(null)}>Cancelar</Btn>
              <Btn onClick={confirmarFirma} disabled={savingFirma||!firmaTexto.trim()}
                style={{background:"#7C6AF7"}}>
                {savingFirma?"Firmando...":"✍ Confirmar firma"}
              </Btn>
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

  if(loading) return <div style={{color:"var(--text3)",padding:20}}>Cargando...</div>;

  return (
    <div>
      <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:8}}>Sedes</h1>
      <p style={{color:"var(--text3)",fontSize:14,marginBottom:24}}>Gestión de las {sedes.length} sedes operativas</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16}}>
        {sedes.map(sede=>{
          const r = resumen.find(x=>x.sede_id===sede.id)||{};
          return (
            <Card key={sede.id} style={{borderTop:`3px solid ${getColor(sede.nombre)}`}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div style={{width:42,height:42,borderRadius:12,background:`${getColor(sede.nombre)}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🏥</div>
                <div>
                  <div style={{fontWeight:700,fontSize:16,color:"var(--text)"}}>OxyNatur {sede.nombre}</div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>{sede.direccion||"Sin dirección"}</div>
                </div>
                <span style={{marginLeft:"auto"}}><Badge color={sede.estado==="activa"?"#10B981":"#F87171"}>{sede.estado}</Badge></span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {[
                  {l:"Pac. activos", v:r.pacientes_activos||0, c:getColor(sede.nombre)},
                  {l:"Ses. hoy",     v:r.sesiones_hoy||0,     c:"#7C6AF7"},
                  {l:"Cámaras OK",  v:r.camaras_operativas||0,c:"#10B981"},
                ].map((it,j)=>(
                  <div key={j} style={{background:"var(--surface)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:20,fontWeight:700,color:it.c}}>{it.v}</div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>{it.l}</div>
                  </div>
                ))}
              </div>
              {sede.telefono && <div style={{marginTop:12,fontSize:12,color:"var(--text3)"}}>📞 {sede.telefono}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── FINANZAS ──────────────────────────────────────────────────
function Finanzas() {
  const hoy = fechaHoyLima();
  const mesActual = hoy.slice(0,7);
  const [mesSelec, setMesSelec] = useState(mesActual);
  const [ventas, setVentas]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [sedes, setSedes]       = useState([]);

  const load = async () => {
    setLoading(true);
    const mesInicio = mesSelec + "-01";
    const mesFin    = new Date(mesSelec + "-01T12:00:00");
    mesFin.setMonth(mesFin.getMonth()+1);
    const mesFInStr = mesFin.toISOString().slice(0,10);

    const [{ data: v }, { data: s }] = await Promise.all([
      safeQuery(()=> supabase.from("compras_paciente")
        .select("id,fecha_compra,monto_pagado,precio_sugerido,metodo_pago,estado,sede_id,sedes(nombre,color),paquetes(codigo,nombre),pacientes(nombres,apellidos)")
        .neq("estado","cancelado")
        .gte("fecha_compra", mesInicio)
        .lt("fecha_compra", mesFInStr)
        .order("fecha_compra",{ascending:false}), "Finanzas:ventas"),
      safeQuery(()=> supabase.from("sedes").select("id,nombre"), "Finanzas:sedes"),
    ]);
    setVentas(v||[]);
    setSedes(s||[]);
    setLoading(false);
  };

  useEffect(()=>{ load(); },[mesSelec]); // eslint-disable-line

  // KPIs globales del mes
  const totalIngresos  = ventas.reduce((a,v)=>a+Number(v.monto_pagado||0),0);
  const totalSugerido  = ventas.reduce((a,v)=>a+Number(v.precio_sugerido||0),0);
  const totalDescuento = Math.max(totalSugerido - totalIngresos, 0);
  const ticketPromedio = ventas.length ? totalIngresos/ventas.length : 0;
  const fmtSol = (n) => `S/ ${Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // KPIs por sede
  const porSede = sedes.map(s=>{
    const vs = ventas.filter(v=>v.sede_id===s.id);
    return {
      sede: s.nombre,
      ingresos: vs.reduce((a,v)=>a+Number(v.monto_pagado||0),0),
      ventas: vs.length,
      color: getColor(s.nombre),
    };
  }).filter(s=>s.ventas>0);

  // Desglose por método de pago
  const porMetodo = ["efectivo","transferencia","tarjeta","yape","plin","kiwi"].map(m=>{
    const vs = ventas.filter(v=>v.metodo_pago===m);
    const total = vs.reduce((a,v)=>a+Number(v.monto_pagado||0),0);
    return {metodo:m, total, count:vs.length};
  }).filter(m=>m.count>0);

  // Meses disponibles para el selector (últimos 12)
  const meses = Array.from({length:12},(_,i)=>{
    const d = new Date(hoy+"T12:00:00");
    d.setMonth(d.getMonth()-i);
    return d.toISOString().slice(0,7);
  });

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)"}}>Finanzas</h1>
          <p style={{color:"var(--text3)",fontSize:13,marginTop:3}}>Resumen financiero por sede y método de pago</p>
        </div>
        {/* Selector de mes */}
        <select value={mesSelec} onChange={e=>setMesSelec(e.target.value)}
          style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,
            color:"var(--text)",padding:"8px 14px",fontSize:14,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
          {meses.map(m=>(
            <option key={m} value={m}>
              {new Date(m+"-01T12:00:00").toLocaleDateString("es-PE",{month:"long",year:"numeric"})}
            </option>
          ))}
        </select>
      </div>

      {loading ? <div style={{color:"var(--text3)",padding:20}}>Cargando...</div> : <>

      {/* KPIs globales */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
        {[
          {label:"Ingresos del mes",  val:fmtSol(totalIngresos),  color:"#10B981", sub:`${ventas.length} ventas`},
          {label:"Descuentos",        val:fmtSol(totalDescuento), color:"#F59E0B", sub:"vs precio sugerido"},
          {label:"Ticket promedio",   val:fmtSol(ticketPromedio), color:"#7C6AF7", sub:"por venta"},
          {label:"Precio sugerido",   val:fmtSol(totalSugerido),  color:"#00A896", sub:"total sin descuento"},
        ].map((k,i)=>(
          <Card key={i} style={{borderTop:`3px solid ${k.color}`,paddingTop:16,minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:k.color,marginTop:6}}>
              {totalIngresos===0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{k.sub}</div>
          </Card>
        ))}
      </div>

      {ventas.length === 0
        ? <Card style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>Sin ventas registradas en este período</Card>
        : <>

        {/* KPIs por sede */}
        {porSede.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:`repeat(${porSede.length},1fr)`,gap:12,marginBottom:20}}>
            {porSede.map((s,i)=>(
              <Card key={i} style={{borderLeft:`3px solid ${s.color}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:12,color:"var(--text2)",fontWeight:600,marginBottom:6}}>{s.sede}</div>
                    <div style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:700,color:s.color}}>{fmtSol(s.ingresos)}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{s.ventas} ventas · {Math.round(s.ingresos/totalIngresos*100)}% del total</div>
                  </div>
                  <div style={{fontSize:28,opacity:0.15}}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                      <path d="M12 6v2m0 8v2m-3-5c0 1.1 1.34 2 3 2s3-.9 3-2-1.34-2-3-2-3-.9-3-2 1.34-2 3-2 3 .9 3 2"/>
                    </svg>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Desglose método de pago + tabla */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:16,marginBottom:0}}>

          {/* Métodos de pago */}
          <Card>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:14}}>Por método de pago</div>
            {porMetodo.map((m,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:13,color:"var(--text)",textTransform:"capitalize",fontWeight:500}}>{m.metodo}</span>
                  <span style={{fontSize:13,color:"var(--text2)"}}>{fmtSol(m.total)}</span>
                </div>
                <div style={{background:"var(--surface2)",borderRadius:4,height:6,overflow:"hidden"}}>
                  <div style={{background:"#00A896",height:6,borderRadius:4,width:`${Math.round(m.total/totalIngresos*100)}%`,transition:"width 0.5s"}}/>
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{m.count} ventas · {Math.round(m.total/totalIngresos*100)}%</div>
              </div>
            ))}
          </Card>

          {/* Tabla de ventas del mes */}
          <Card style={{padding:0,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:"0.5px solid var(--border)",fontSize:11,fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.06em"}}>
              Detalle de ventas — {ventas.length} registros
            </div>
            <div style={{maxHeight:320,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:"var(--surface2)"}}>
                    {["Fecha","Paciente","Paquete","Método","Sede","Monto"].map(h=>(
                      <th key={h} style={{padding:"8px 12px",fontSize:11,fontWeight:600,color:"var(--text3)",textAlign:"left"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ventas.map(v=>(
                    <tr key={v.id} style={{borderTop:"0.5px solid var(--border)"}}>
                      <td style={{padding:"9px 12px",fontSize:12,color:"var(--text3)"}}>{v.fecha_compra}</td>
                      <td style={{padding:"9px 12px",fontSize:12,color:"var(--text)",fontWeight:500}}>
                        {v.pacientes ? `${v.pacientes.apellidos} ${v.pacientes.nombres}`.slice(0,22) : "—"}
                      </td>
                      <td style={{padding:"9px 12px",fontSize:12,color:"var(--text2)"}}>{v.paquetes?.codigo||"—"}</td>
                      <td style={{padding:"9px 12px",fontSize:11,color:"var(--text2)",textTransform:"capitalize"}}>{v.metodo_pago||"—"}</td>
                      <td style={{padding:"9px 12px",fontSize:11}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:getColor(v.sedes?.nombre||""),display:"inline-block"}}/>
                          <span style={{color:"var(--text3)"}}>{(v.sedes?.nombre||"").split(" ")[0]}</span>
                        </span>
                      </td>
                      <td style={{padding:"9px 12px",fontSize:13,fontWeight:700,
                        color: Number(v.monto_pagado) < Number(v.precio_sugerido) ? "#F59E0B" : "#10B981"}}>
                        {fmtSol(v.monto_pagado)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Totales */}
            <div style={{padding:"10px 16px",borderTop:"0.5px solid var(--border)",background:"var(--surface2)",display:"flex",justifyContent:"flex-end",gap:24}}>
              <span style={{fontSize:12,color:"var(--text3)"}}>Total cobrado:</span>
              <span style={{fontSize:14,fontWeight:700,color:"#10B981",fontFamily:"Syne,sans-serif"}}>{fmtSol(totalIngresos)}</span>
            </div>
          </Card>
        </div>
      </>}
      </>}
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
  // Edición de usuario
  const [modalEdit, setModalEdit] = useState(null);
  const [formEdit, setFormEdit]   = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

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
    const sedeId = form.rol==="medico" && form.es_especialista ? null : (form.sede_id||null);
    // Llamar Edge Function (service_role corre en servidor — seguro)
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(EDGE_CREATE_USER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        email:          form.email,
        password:       form.password,
        nombres:        form.nombre,
        apellidos:      "",
        rol:            form.rol,
        sede_id:        sedeId,
        es_especialista: form.rol==="medico" ? form.es_especialista : false,
      }),
    });
    const result = await resp.json();
    if(!resp.ok){setMsg("Error: "+(result.error||resp.statusText));setSaving(false);return;}
    setSaving(false); setModal(false);
    setForm({email:"",password:"",nombre:"",rol:"enfermero",sede_id:"",es_especialista:false});
    setMsg(""); load();
  };

  const abrirEditUsuario = (u) => {
    setFormEdit({
      nombre: u.nombre||"",
      rol: u.rol||"enfermero",
      es_especialista: u.es_especialista||false,
      sede_id: u.sede_id||"",
      activo: u.activo !== false,
    });
    setModalEdit(u);
  };

  const guardarEditUsuario = async () => {
    setSavingEdit(true);
    await safeQuery(()=>
      supabase.from("perfiles").update({
        nombre:         formEdit.nombre,
        rol:            formEdit.rol,
        es_especialista: formEdit.rol==="medico" ? formEdit.es_especialista : false,
        sede_id:        (formEdit.rol==="medico" && formEdit.es_especialista) ? null : (formEdit.sede_id||null),
        activo:         formEdit.activo,
      }).eq("id", modalEdit.id),
      "Usuarios:editar"
    );
    setSavingEdit(false);
    setModalEdit(null);
    load();
  };

  const toggleActivo = async (u) => {
    const accion = u.activo !== false ? "desactivar" : "activar";
    if(!confirm(`¿${accion} al usuario ${u.nombre}?`)) return;
    await safeQuery(()=>
      supabase.from("perfiles").update({ activo: u.activo === false }).eq("id", u.id),
      "Usuarios:toggleActivo"
    );
    load();
  };

  const rolColor = {admin_general:"#00A896",admin_sede:"#7C6AF7",medico:"#F59E0B",enfermero:"#10B981"};
  const rolLabel = (u) => {
    if(u.rol === "medico" && u.es_especialista) return "Médico Especialista";
    if(u.rol === "medico") return "Médico";
    if(u.rol === "admin_general") return "Admin General";
    if(u.rol === "atc") return "ATC";
    if(u.rol === "enfermero") return "Enfermero";
    return u.rol;
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)"}}>Usuarios</h1>
          <p style={{color:"var(--text3)",fontSize:14,marginTop:3}}>{usuarios.length} usuarios registrados</p>
        </div>
        <Btn onClick={()=>setModal(true)}>+ Nuevo Usuario</Btn>
      </div>
      {loading ? <div style={{color:"var(--text3)"}}>Cargando...</div>
        : <Card>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1.2fr 1fr auto",padding:"0 0 12px",fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <span>Usuario</span><span>Email</span><span>Rol</span><span>Sede</span><span>Acciones</span>
            </div>
            {usuarios.map(u=>(
              <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1.2fr 1fr auto",padding:"12px 0",borderTop:"0.5px solid var(--border)",alignItems:"center",opacity:u.activo===false?0.5:1}}>
                <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>{u.nombre}</div>
                <div style={{fontSize:13,color:"var(--text2)"}}>{u.email}</div>
                <div><Badge color={rolColor[u.rol]||"var(--text3)"}>{rolLabel(u)}</Badge></div>
                <div style={{fontSize:13,color:"var(--text2)"}}>{u.sedes?.nombre||"Todas las sedes"}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button onClick={()=>abrirEditUsuario(u)}
                    style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:11}}>
                    ✏ Editar
                  </button>
                  <button onClick={()=>toggleActivo(u)}
                    style={{background:u.activo===false?"#10B98115":"#F8717115",border:u.activo===false?"1px solid #10B98130":"1px solid #F8717130",color:u.activo===false?"#10B981":"#F87171",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:11}}>
                    {u.activo===false?"Activar":"Desactivar"}
                  </button>
                </div>
              </div>
            ))}
          </Card>
      }
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:440,padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Nuevo Usuario</div>
              <button onClick={()=>setModal(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            {msg && <div style={{background:"#F8717115",border:"1px solid #F8717140",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:"#F87171"}}>{msg}</div>}
            <Input label="Nombre completo" value={form.nombre} onChange={v=>setF("nombre",v)} required/>
            <Input label="Email" value={form.email} onChange={v=>setF("email",v)} type="email" required/>
            <Input label="Contraseña temporal" value={form.password} onChange={v=>setF("password",v)} type="password" required/>
            <Select label="Rol" value={form.rol} onChange={v=>setF("rol",v)} required
              options={[{value:"admin_general",label:"Admin General"},{value:"medico",label:"Médico"},{value:"enfermero",label:"Enfermero"},{value:"atc",label:"ATC"},{value:"admin_sede",label:"Admin Sede"}]}/>
            {/* Si es médico, mostrar opción especialista */}
            {form.rol === "medico" && (
              <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,border:"1px solid #2A3550"}}>
                <input type="checkbox" id="esEsp" checked={form.es_especialista}
                  onChange={e=>setF("es_especialista",e.target.checked)}
                  style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="esEsp" style={{fontSize:14,color:"var(--text)",cursor:"pointer"}}>
                  Médico Especialista <span style={{fontSize:12,color:"var(--text3)"}}>(acceso cross-sede, sin sede fija)</span>
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
      {/* Modal editar usuario */}
      {modalEdit && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:440,padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Editar Usuario</div>
              <button onClick={()=>setModalEdit(null)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <Input label="Nombre completo" value={formEdit.nombre} onChange={v=>setFormEdit(f=>({...f,nombre:v}))} required/>
            <Select label="Rol" value={formEdit.rol} onChange={v=>setFormEdit(f=>({...f,rol:v}))}
              options={[{value:"admin_general",label:"Admin General"},{value:"medico",label:"Médico"},{value:"enfermero",label:"Enfermero"},{value:"atc",label:"ATC"},{value:"admin_sede",label:"Admin Sede"}]}/>
            {formEdit.rol==="medico" && (
              <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,border:"1px solid #2A3550"}}>
                <input type="checkbox" checked={formEdit.es_especialista}
                  onChange={e=>setFormEdit(f=>({...f,es_especialista:e.target.checked}))}
                  style={{width:16,height:16,cursor:"pointer"}}/>
                <label style={{fontSize:14,color:"var(--text)",cursor:"pointer"}}>Médico Especialista (cross-sede)</label>
              </div>
            )}
            {!(formEdit.rol==="medico" && formEdit.es_especialista) && (
              <Select label="Sede asignada" value={formEdit.sede_id} onChange={v=>setFormEdit(f=>({...f,sede_id:v}))}
                options={(sedes||[]).map(s=>({value:s.id,label:s.nombre}))}/>
            )}
            <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,border:"1px solid #2A3550"}}>
              <input type="checkbox" checked={formEdit.activo!==false}
                onChange={e=>setFormEdit(f=>({...f,activo:e.target.checked}))}
                style={{width:16,height:16,cursor:"pointer"}}/>
              <label style={{fontSize:14,color:"var(--text)",cursor:"pointer"}}>Usuario activo</label>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:8}}>
              <Btn variant="ghost" onClick={()=>setModalEdit(null)}>Cancelar</Btn>
              <Btn onClick={guardarEditUsuario} disabled={savingEdit}>{savingEdit?"Guardando...":"Guardar"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── MiniCal — Calendario visual compacto ─────────────────────
function MiniCal({ fecha, onChange, marcados=[] }) {
  // fecha: "YYYY-MM-DD", onChange: fn(fecha), marcados: ["YYYY-MM-DD",...]
  const [mesVista, setMesVista] = useState(()=> fecha ? fecha.slice(0,7) : fechaHoyLima().slice(0,7));
  const hoy = fechaHoyLima();

  const diasMes = () => {
    const [y,m] = mesVista.split("-").map(Number);
    const primero = new Date(y, m-1, 1);
    const ultimo  = new Date(y, m, 0).getDate();
    const offsetLunes = (primero.getDay()+6)%7; // 0=lunes
    const dias = [];
    for(let i=0; i<offsetLunes; i++) dias.push(null);
    for(let d=1; d<=ultimo; d++) dias.push(`${mesVista}-${String(d).padStart(2,"0")}`);
    return dias;
  };

  const navMes = (dir) => {
    const [y,m] = mesVista.split("-").map(Number);
    const d = new Date(y, m-1+dir, 1);
    setMesVista(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  const nombreMes = new Date(mesVista+"-01T12:00:00").toLocaleDateString("es-PE",{month:"long",year:"numeric"});

  return (
    <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,
      padding:14,boxShadow:"0 4px 20px rgba(0,0,0,0.08)",userSelect:"none",minWidth:220}}>
      {/* Header mes */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <button onClick={()=>navMes(-1)}
          style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px",borderRadius:6}}>‹</button>
        <div style={{fontSize:13,fontWeight:600,color:"var(--text)",textTransform:"capitalize"}}>{nombreMes}</div>
        <button onClick={()=>navMes(1)}
          style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px",borderRadius:6}}>›</button>
      </div>
      {/* Labels días */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
        {["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(d=>(
          <div key={d} style={{textAlign:"center",fontSize:10,color:"var(--text3)",fontWeight:600,padding:"2px 0"}}>{d}</div>
        ))}
      </div>
      {/* Días */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {diasMes().map((d,i)=>{
          if(!d) return <div key={i}/>;
          const esHoy     = d === hoy;
          const esSelec   = d === fecha;
          const tieneSes  = marcados.includes(d);
          return (
            <button key={d} onClick={()=>onChange(d)}
              style={{
                background: esSelec ? "#00A896" : esHoy ? "#00A89615" : "none",
                color:      esSelec ? "#fff" : esHoy ? "#00A896" : "var(--text)",
                border:     esHoy && !esSelec ? "0.5px solid #00A896" : "none",
                borderRadius:6, padding:"5px 2px", cursor:"pointer",
                fontFamily:"inherit", fontSize:12, fontWeight: esHoy||esSelec ? 700 : 400,
                position:"relative",
              }}>
              {d.split("-")[2].replace(/^0/,"")}
              {tieneSes && !esSelec && (
                <span style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",
                  width:4,height:4,borderRadius:"50%",background:"#00A896",display:"block"}}/>
              )}
            </button>
          );
        })}
      </div>
      {/* Botón hoy */}
      <div style={{marginTop:8,textAlign:"center"}}>
        <button onClick={()=>{ onChange(hoy); setMesVista(hoy.slice(0,7)); }}
          style={{background:"none",border:"none",color:"#00A896",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
          Ir a hoy
        </button>
      </div>
    </div>
  );
}

// ── AGENDA MÉDICO / ENFERMERO ─────────────────────────────────
function AgendaMedico({perfil, cambiarVista}) {
  const f = getRolFlags(perfil);

  const hoy = fechaHoyLima();
  const [fechaSelec, setFechaSelec] = useState(hoy);
  const [vistaMode, setVistaMode]   = useState("dia");    // "dia" | "semana"
  const [agenda, setAgenda]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [sedesData, setSedesData]   = useState([]);
  const [sedeTab, setSedeTab]       = useState("todas");
  const [prospectosCitas, setProspectosCitas] = useState([]);
  const [showCalAgenda, setShowCalAgenda] = useState(false);

  const ESTADO_COLOR = {programada:"#F59E0B",en_curso:"#00A896",completada:"#10B981",cancelada:"#F87171",no_asistio:"var(--text3)"};
  const ESTADO_LABEL = {programada:"Programada",en_curso:"En curso",completada:"Completada",cancelada:"Cancelada",no_asistio:"No asistió"};

  // Generar rango de fechas para vista semanal
  const getSemana = (fecha) => {
    const d = new Date(fecha+"T00:00:00");
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - (d.getDay()===0?6:d.getDay()-1));
    return Array.from({length:7},(_,i)=>{
      const dia = new Date(lunes);
      dia.setDate(lunes.getDate()+i);
      return dia.toLocaleDateString("en-CA",{timeZone:"America/Lima"});
    });
  };
  const semana = getSemana(fechaSelec);

  const load = async () => {
    setLoading(true);
    const fechas = vistaMode==="semana" ? semana : [fechaSelec];
    // Ajuste UTC-5 Lima: inicio del día Lima = T05:00Z, fin = día siguiente T04:59Z
    const fechaInicio = fechas[0] + "T05:00:00.000Z";
    const dFin = new Date(fechas[fechas.length-1] + "T05:00:00.000Z");
    dFin.setDate(dFin.getDate()+1);
    dFin.setSeconds(dFin.getSeconds()-1);
    const fechaFin = dFin.toISOString();

    const [{ data }, { data: prsp }] = await Promise.all([
      safeQuery(() => {
        let q = supabase.from("vista_agenda_hoy")
          .select("*")
          .in("fecha", fechas)
          .order("fecha")
          .order("hora_inicio");
        if(!f.esAdmin && !f.esMedicoEsp && perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
        return q;
      }, "Agenda:load"),
      safeQuery(() => supabase.from("prospectos")
        .select("id,nombre,telefono,canal,sede_id,motivo,estado,fecha_cita,sedes(nombre)")
        .eq("estado","evaluacion_agendada")
        .not("fecha_cita","is",null)
        .gte("fecha_cita", fechaInicio)
        .lte("fecha_cita", fechaFin), "Agenda:prospectos"),
    ]);
    setAgenda(data||[]);
    setProspectosCitas(prsp||[]);
    setLoading(false);
  };

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      await load();
      const { data: s } = await safeQuery(()=>supabase.from("sedes").select("id,nombre"), "Agenda:sedes");
      if(mounted) setSedesData(s||[]);
    })();
    return ()=>{ mounted=false; };
  },[fechaSelec, vistaMode]); // eslint-disable-line

  // Navegar días/semanas
  const navegar = (dir) => {
    const d = new Date(fechaSelec+"T12:00:00");
    d.setDate(d.getDate() + (vistaMode==="semana" ? dir*7 : dir));
    setFechaSelec(d.toLocaleDateString("en-CA",{timeZone:"America/Lima"}));
  };

  const fmtDia = (iso) => new Date(iso+"T00:00:00").toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"});
  const esHoy  = (iso) => iso === hoy;

  // Filtrar por sede
  const agendaFiltrada = sedeTab==="todas" ? agenda : agenda.filter(s=>s.sede_id===sedeTab);
  const prospectosFiltrados = sedeTab==="todas" ? prospectosCitas : prospectosCitas.filter(p=>p.sede_id===sedeTab);

  // KPIs — incluye evaluaciones de prospectos
  const evalHoy     = prospectosFiltrados.filter(p=>{
    const fc = new Date(p.fecha_cita).toLocaleDateString("en-CA",{timeZone:"America/Lima"});
    return fc === fechaSelec;
  }).length;
  const total       = agendaFiltrada.length + evalHoy;
  const completadas = agendaFiltrada.filter(s=>s.estado==="completada").length;
  const enCurso     = agendaFiltrada.filter(s=>s.estado==="en_curso").length;
  const pendientes  = agendaFiltrada.filter(s=>s.estado==="programada").length;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)"}}>Agenda</h1>
          <p style={{color:"var(--text3)",fontSize:14,marginTop:3}}>
            {vistaMode==="dia"
              ? new Date(fechaSelec+"T00:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long",year:"numeric"})
              : `${fmtDia(semana[0])} — ${fmtDia(semana[6])}`
            }
          </p>
        </div>
        {/* Controles de navegación */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* Toggle vista */}
          <div style={{display:"flex",background:"var(--surface2)",borderRadius:8,border:"1px solid #2A3550",overflow:"hidden"}}>
            {["dia","semana"].map(v=>(
              <button key={v} onClick={()=>setVistaMode(v)}
                style={{padding:"6px 14px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,
                  background:vistaMode===v?"var(--border)":"transparent",
                  color:vistaMode===v?"var(--text)":"var(--text3)",
                  fontWeight:vistaMode===v?600:400}}>
                {v==="dia"?"Día":"Semana"}
              </button>
            ))}
          </div>
          {/* Navegación */}
          <button onClick={()=>navegar(-1)} style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>‹</button>
          <button onClick={()=>setFechaSelec(hoy)} style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"#00A896",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>Hoy</button>
          <button onClick={()=>navegar(1)} style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>›</button>
          {/* Selector de fecha — MiniCal */}
          <div style={{position:"relative"}}>
            <button onClick={()=>setShowCalAgenda(c=>!c)}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text)",
                padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,
                display:"flex",alignItems:"center",gap:6}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              {new Date(fechaSelec+"T12:00:00").toLocaleDateString("es-PE",{day:"numeric",month:"short",year:"numeric"})}
            </button>
            {showCalAgenda && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:100}}
                onMouseLeave={()=>setShowCalAgenda(false)}>
                <MiniCal fecha={fechaSelec} onChange={d=>{ setFechaSelec(d); setShowCalAgenda(false); }}/>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {label:"Total",       val:total,       color:"var(--text)"},
          {label:"Completadas", val:completadas,  color:"#10B981"},
          {label:"En curso",    val:enCurso,     color:"#00A896"},
          {label:"Pendientes",  val:pendientes,  color:"#F59E0B"},
        ].map((k,i)=>(
          <div key={i} style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"12px 16px",minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:26,fontWeight:700,color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)",fontSize:22}}>—</span> : k.val}</div>
          </div>
        ))}
      </div>

      {/* Tabs sede — solo si ve varias */}
      {(f.esAdmin || f.esMedicoEsp) && sedesData.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[{id:"todas",nombre:"Todas"},...sedesData].map(s=>(
            <button key={s.id} onClick={()=>setSedeTab(s.id)}
              style={{padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:12,cursor:"pointer",fontFamily:"inherit",
                borderColor:sedeTab===s.id?"#00A896":"var(--border)",
                background:sedeTab===s.id?"#F0FDFB":"none",
                color:sedeTab===s.id?"#00A896":"var(--text3)"}}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {loading ? <div style={{color:"var(--text3)",padding:20}}>Cargando agenda...</div>

      /* Vista semanal */
      : vistaMode==="semana" ? (
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8}}>
          {semana.map(fecha=>{
            const sesiones = agendaFiltrada.filter(s=>s.fecha===fecha);
            return (
              <div key={fecha} style={{
                background: esHoy(fecha)?"var(--surface2)":"var(--bg)",
                border:`1px solid ${esHoy(fecha)?"#00C4B440":"var(--border)"}`,
                borderRadius:12, padding:"10px 8px", minHeight:120,
              }}>
                {/* Cabecera día */}
                <div style={{textAlign:"center",marginBottom:8}}>
                  <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                    {new Date(fecha+"T00:00:00").toLocaleDateString("es-PE",{weekday:"short"})}
                  </div>
                  <div style={{
                    fontSize:18,fontWeight:700,fontFamily:"Syne,sans-serif",
                    color:esHoy(fecha)?"#00A896":"var(--text)",
                    background:esHoy(fecha)?"#00C4B420":"none",
                    borderRadius:8,padding:"2px 6px",display:"inline-block",marginTop:2,
                  }}>
                    {new Date(fecha+"T00:00:00").getDate()}
                  </div>
                </div>
                {(() => {
                  const evalsDia = prospectosFiltrados.filter(p=>
                    new Date(p.fecha_cita).toLocaleDateString("en-CA",{timeZone:"America/Lima"}) === fecha
                  );
                  const total = sesiones.length + evalsDia.length;
                  return total===0
                    ? <div style={{textAlign:"center",color:"var(--border)",fontSize:11,marginTop:8}}>—</div>
                    : <>
                      {evalsDia.map(p=>(
                        <div key={p.id} style={{
                          background:"#7C6AF720",border:"1px solid #7C6AF740",
                          borderRadius:6,padding:"4px 6px",marginBottom:4,
                        }}>
                          <div style={{fontSize:11,fontWeight:600,color:"#7C6AF7",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre.split(" ")[0]}</div>
                          <div style={{fontSize:10,color:"var(--text3)"}}>
                            {new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Lima"})} · Eval.
                          </div>
                          <div style={{width:6,height:6,borderRadius:"50%",background:"#7C6AF7",display:"inline-block",marginTop:2}}/>
                        </div>
                      ))}
                      {sesiones.map(s=>(
                        <div key={s.id} style={{
                          background:`${ESTADO_COLOR[s.estado]||"var(--border2)"}20`,
                          border:`1px solid ${ESTADO_COLOR[s.estado]||"var(--border2)"}40`,
                          borderRadius:6,padding:"4px 6px",marginBottom:4,
                        }}>
                          <div style={{fontSize:11,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.paciente?.split(" ")[0]}</div>
                          <div style={{fontSize:10,color:"var(--text3)"}}>{s.hora_inicio?.slice(0,5)} · #{s.numero_sesion}</div>
                          <div style={{width:6,height:6,borderRadius:"50%",background:ESTADO_COLOR[s.estado],display:"inline-block",marginTop:2}}/>
                        </div>
                      ))}
                    </>;
                })()}
              </div>
            );
          })}
        </div>

      /* Vista día */
      ) : agendaFiltrada.length===0 && prospectosFiltrados.length===0
        ? <div style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"50px",textAlign:"center"}}>
            <div style={{fontSize:36,opacity:.3,marginBottom:12}}>📅</div>
            <div style={{color:"var(--text3)"}}>Sin sesiones para este día</div>
          </div>
        : <>
          {/* Citas de evaluación de prospectos */}
          {prospectosFiltrados.filter(p=>{
            const fechaCita = new Date(p.fecha_cita).toLocaleDateString("en-CA",{timeZone:"America/Lima"});
            return fechaCita === fechaSelec;
          }).map(p=>(
            <div key={p.id} style={{
              background:"#7C6AF710",
              border:"0.5px solid #7C6AF740",
              borderLeft:"3px solid #7C6AF7",
              borderRadius:12,padding:"14px 18px",marginBottom:8,
              display:"grid",gridTemplateColumns:"70px 2fr 1fr 1fr auto",
              alignItems:"center",gap:12,
            }}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:700,color:"#7C6AF7",fontFamily:"Syne,sans-serif"}}>
                  {new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Lima"})}
                </div>
                <div style={{fontSize:10,color:"var(--text3)"}}>Eval.</div>
              </div>
              <div>
                <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>{p.nombre}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {p.telefono} · {p.motivo||"Sin motivo registrado"}
                </div>
              </div>
              <div style={{fontSize:13,color:"var(--text2)"}}>
                <div style={{fontSize:11,color:"var(--text3)"}}>Canal: {p.canal}</div>
              </div>
              {(f.esAdmin||f.esMedicoEsp) && (
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"#7C6AF7",display:"inline-block"}}/>
                  <span style={{fontSize:12,color:"var(--text2)"}}>{p.sedes?.nombre||"—"}</span>
                </div>
              )}
              <div>
                <Badge color="#7C6AF7">Evaluación</Badge>
              </div>
            </div>
          ))}
          {/* Sesiones */}
          {agendaFiltrada.map(s=>(
          <div key={s.id} style={{
            background:"var(--surface)",
            border:`0.5px solid #E2E8F0`,
            borderLeft:`3px solid ${ESTADO_COLOR[s.estado]||"var(--border2)"}`,
            borderRadius:12,padding:"14px 18px",marginBottom:8,
            display:"grid",gridTemplateColumns:"70px 2fr 1fr 1fr auto",
            alignItems:"center",gap:12,
          }}>
            {/* Hora */}
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#00A896",fontFamily:"Syne,sans-serif"}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{s.hora_fin?.slice(0,5)||""}</div>
            </div>
            {/* Paciente */}
            <div>
              <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>{s.paciente}</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                DNI {s.dni} · Sesión #{s.numero_sesion}
                {s.sesiones_restantes != null && (
                  <span style={{color:s.sesiones_restantes<=2?"#F87171":"var(--text3)"}}> · {s.sesiones_restantes} restantes</span>
                )}
              </div>
            </div>
            {/* Cámara + parámetros */}
            <div style={{fontSize:13,color:"var(--text2)"}}>
              {s.camara_numero ? `Cámara #${s.camara_numero}` : "—"}
              <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.presion_aplicada} ATA · {s.duracion_minutos} min</div>
            </div>
            {/* Sede — solo si ve varias */}
            {(f.esAdmin||f.esMedicoEsp) && (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:getColor(s.sede_nombre),display:"inline-block"}}/>
                <span style={{fontSize:12,color:"var(--text2)"}}>{s.sede_nombre}</span>
              </div>
            )}
            {/* Estado + Ver HC */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              <Badge color={ESTADO_COLOR[s.estado]||"var(--text3)"}>{ESTADO_LABEL[s.estado]||s.estado}</Badge>
              {!s.hc_completada && s.estado==="completada" && <Badge color="#F59E0B">⚠ Sin HC</Badge>}
              {s.paciente_id && cambiarVista && (
                <button onClick={()=>{
                  localStorage.setItem("oxynatur-hc-paciente", s.paciente_id);
                  cambiarVista("historias");
                }}
                  style={{background:"none",border:"none",color:"#00A896",fontSize:11,fontWeight:600,cursor:"pointer",padding:"2px 0",fontFamily:"inherit"}}>
                  Ver HC →
                </button>
              )}
            </div>
          </div>
        ))}
        </>
      }
    </div>
  );
}

// ── VENTAS ────────────────────────────────────────────────────
function Ventas({perfil}) {
  const f = getRolFlags(perfil);
  // Enfermero solo ve su sede; admin ve todo
  const sedeFija = f.ventasSoloSuSede ? perfil?.sede_id : null;
  // Buscador de paciente en Nueva Venta
  const [busqPac, setBusqPac] = useState("");
  const [abiertoDropPac, setAbiertoDropPac] = useState(false);

  const { data: pacientesData } = useSupabaseQuery(
    () => {
      let q = supabase.from("pacientes").select("id,nombres,apellidos,dni").order("apellidos");
      if(sedeFija) q = q.eq("sede_principal_id", sedeFija);
      return q;
    },
    [], "Ventas:pacientes"
  );
  const { data: paquetesData } = useSupabaseQuery(
    () => supabase.from("paquetes")
      .select("*, paquetes_precios(sede_id, precio, sesiones_incluidas, activo, incluye_evaluacion, descripcion_sede, segmento)")
      .eq("activo", true).order("cantidad_sesiones"),
    [], "Ventas:paquetes"
  );
  const { data: sedesData } = useSupabaseQuery(
    () => {
      let q = supabase.from("sedes").select("id,nombre");
      if(sedeFija) q = q.eq("id", sedeFija);
      return q;
    },
    [], "Ventas:sedes"
  );

  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(true);
  const [filtroSede, setFiltroSede] = useState("todas");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [busqVenta, setBusqVenta] = useState("");
  const [paginaVentas, setPaginaVentas] = useState(0);
  const [totalVentas, setTotalVentas] = useState(0);
  const PAGE_SIZE = 20;

  const loadVentas = async (sedeId, pagina = 0, desde, hasta) => {
    setLoadingVentas(true);
    const sedeActiva = sedeId !== undefined ? sedeId : filtroSede;
    const from = pagina * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data } = await safeQuery(() => {
      let q = supabase.from("compras_paciente")
        .select(`
          id, fecha_compra, monto_pagado, precio_sugerido, descuento_pct,
          estado, promo_aplicada, metodo_pago, notas, numero_comprobante, comprobante_url,
          pacientes(nombres,apellidos,dni),
          paquetes(codigo,nombre),
          sedes(nombre,color)
        `, { count: "exact" })
        .order("fecha_compra", {ascending:false})
        .range(from, to);
      if(sedeFija) q = q.eq("sede_id", sedeFija);
      else if(sedeActiva !== "todas") q = q.eq("sede_id", sedeActiva);
      const d = desde !== undefined ? desde : filtroDesde;
      const h = hasta !== undefined ? hasta : filtroHasta;
      if(d) q = q.gte("fecha_compra", d);
      if(h) q = q.lte("fecha_compra", h);
      return q;
    }, "Ventas:loadVentas");
    setVentas(data || []);
    if(data?.count !== undefined) setTotalVentas(data.count);
    setLoadingVentas(false);
  };

  useEffect(()=>{ loadVentas(); }, []); // eslint-disable-line

  const anularVenta = async (venta) => {
    if(!confirm(`¿Anular venta de ${venta.paquetes?.nombre||"paquete"} por ${fmtSol(venta.monto_pagado)}? Esta acción no se puede deshacer.`)) return;
    await safeQuery(()=>
      supabase.from("compras_paciente").update({ estado:"cancelado" }).eq("id", venta.id),
      "Ventas:anular"
    );
    loadVentas();
  };

  const formInicial = {
    paciente_id:"", sede_id: sedeFija || "", paquete_id:"",
    monto_pagado:"", metodo_pago:"efectivo", notas:"", segmento: "regular",
    numero_comprobante:"", fotoFile: null, fotoPreview: null,
    fecha_compra: new Date().toISOString().slice(0,10),
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
          p_sede_id: form.sede_id || null,
          p_segmento: form.segmento || "regular",
        }), "Ventas:calcular_precio"
      );
      if(!mounted) return;
      const desglose = Array.isArray(data) && data[0] ? data[0] : null;
      setCalculo(desglose);
      if(desglose) setForm(f=>({...f, monto_pagado: String(desglose.precio_final)}));
      setCalculando(false);
    })();
    return ()=>{ mounted = false; };
  // Recalcular precio cuando cambia paquete O sede (precios varían por sede)
  }, [form.paquete_id, form.sede_id]);

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
      fecha_compra:       form.fecha_compra || new Date().toISOString().slice(0,10),
      monto_pagado:       Number(form.monto_pagado),
      precio_sugerido:    calculo?.precio_final ? Number(calculo.precio_final) : null,
      promo_aplicada:     calculo?.promo_aplicada || null,
      descuento_pct:      calculo?.descuento_pct ? Number(calculo.descuento_pct) : 0,
      metodo_pago:        form.metodo_pago,
      sesiones_totales:   calculo?.sesiones_incluidas || paquete?.cantidad_sesiones || 1,
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

  // Ciclos de facturación por sede
  // Molisalud: 26 del mes anterior → 25 del mes actual
  // SMA:       16 del mes anterior → 15 del mes actual
  const SEDE_MOLISALUD = "ba7ebacd-eeca-46a8-aea4-48cad115ac37";
  const SEDE_SMA       = "355ee0bb-594d-4f7a-9a41-650588697fb1";

  const calcCiclo = (sedeId) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    if(sedeId === SEDE_MOLISALUD) {
      // Ciclo 26 → 25
      const desde = new Date(y, m-1, 26);
      const hasta = new Date(y, m, 25);
      return {
        desde: desde.toISOString().slice(0,10),
        hasta: hasta.toISOString().slice(0,10),
        label: `26 ${desde.toLocaleDateString("es-PE",{month:"short"})} → 25 ${hasta.toLocaleDateString("es-PE",{month:"short",year:"numeric"})}`,
      };
    } else if(sedeId === SEDE_SMA) {
      // Ciclo 16 → 15
      const desde = new Date(y, m-1, 16);
      const hasta = new Date(y, m, 15);
      return {
        desde: desde.toISOString().slice(0,10),
        hasta: hasta.toISOString().slice(0,10),
        label: `16 ${desde.toLocaleDateString("es-PE",{month:"short"})} → 15 ${hasta.toLocaleDateString("es-PE",{month:"short",year:"numeric"})}`,
      };
    } else {
      // Todas las sedes → mes calendario
      const desde = new Date(y, m, 1);
      const hasta = new Date(y, m+1, 0);
      return {
        desde: desde.toISOString().slice(0,10),
        hasta: hasta.toISOString().slice(0,10),
        label: now.toLocaleDateString("es-PE",{month:"long",year:"numeric"}),
      };
    }
  };

  const cicloActual = calcCiclo(sedeFija || (filtroSede === "todas" ? null : filtroSede));

  // Stats del ciclo — query independiente para no depender de paginación
  const [statsMes, setStatsMes] = useState({ total: 0, descuentos: 0, cantidad: 0 });
  useEffect(() => {
    const calcStats = async () => {
      const primerDia = cicloActual.desde;
      const ultimoDia = cicloActual.hasta;
      const { data } = await safeQuery(() => {
        let q = supabase.from("compras_paciente")
          .select("monto_pagado, precio_sugerido, estado")
          .gte("fecha_compra", primerDia)
          .lte("fecha_compra", ultimoDia)
          .neq("estado", "cancelado");
        if(sedeFija) q = q.eq("sede_id", sedeFija);
        else if(filtroSede !== "todas") q = q.eq("sede_id", filtroSede);
        return q;
      }, "Ventas:statsMes");
      if(data) {
        const total = data.reduce((a,v)=>a+Number(v.monto_pagado||0), 0);
        const descuentos = data.reduce((a,v)=>a+Math.max(Number(v.precio_sugerido||0)-Number(v.monto_pagado||0),0), 0);
        setStatsMes({ total, descuentos, cantidad: data.length });
      }
    };
    calcStats();
  }, [hoyMes, filtroSede]); // eslint-disable-line

  const totalMes    = statsMes.total;
  const descuentosMes = statsMes.descuentos;
  const ventasMes   = { length: statsMes.cantidad };
  const fmtSol = (n) => `S/ ${Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // ── Modal exportar Excel ──
  const hoy         = new Date().toISOString().slice(0,10);
  const primerDiaMes = `${hoyMes}-01`;
  const [modalExport, setModalExport] = useState(false);
  const [exportDesde, setExportDesde] = useState(primerDiaMes);
  const [exportHasta, setExportHasta] = useState(hoy);
  const [exportando,  setExportando]  = useState(false);

  const exportarExcel = async () => {
    setExportando(true);
    const { data: rows } = await safeQuery(() => {
      let q = supabase.from("compras_paciente")
        .select(`
          fecha_compra, numero_comprobante,
          pacientes(nombres,apellidos,dni),
          paquetes(codigo,nombre),
          monto_pagado, precio_sugerido,
          metodo_pago, sedes(nombre), estado
        `)
        .gte("fecha_compra", exportDesde)
        .lte("fecha_compra", exportHasta)
        .order("fecha_compra", {ascending:true});
      if(sedeFija)                    q = q.eq("sede_id", sedeFija);
      else if(filtroSede !== "todas") q = q.eq("sede_id", filtroSede);
      return q;
    }, "Ventas:exportar");

    if(!rows || rows.length === 0) {
      alert("No hay ventas en ese rango de fechas.");
      setExportando(false);
      return;
    }

    const nombreSede = sedeFija
      ? (sedesData?.[0]?.nombre || "sede")
      : filtroSede === "todas"
        ? "Todas las sedes"
        : sedesData?.find(s=>s.id===filtroSede)?.nombre || "sede";

    await new Promise((res, rej) => {
      if(window.XLSX) return res();
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    const XLSX = window.XLSX;

    const filas = rows.map(v => ({
      "Fecha":           v.fecha_compra || "",
      "Comprobante":     v.numero_comprobante || "",
      "Paciente":        v.pacientes ? `${v.pacientes.apellidos} ${v.pacientes.nombres}` : "",
      "DNI":             v.pacientes?.dni || "",
      "Paquete":         v.paquetes ? `${v.paquetes.codigo} - ${v.paquetes.nombre}` : "",
      "Monto Pagado":    Number(v.monto_pagado || 0),
      "Precio Sugerido": Number(v.precio_sugerido || 0),
      "Descuento":       Math.max(Number(v.precio_sugerido||0) - Number(v.monto_pagado||0), 0),
      "Método Pago":     v.metodo_pago || "",
      "Sede":            v.sedes?.nombre || "",
      "Estado":          v.estado || "",
    }));

    const totalPagado    = filas.reduce((a,r)=>a+r["Monto Pagado"],0);
    const totalSugerido  = filas.reduce((a,r)=>a+r["Precio Sugerido"],0);
    const totalDescuento = filas.reduce((a,r)=>a+r["Descuento"],0);
    filas.push({
      "Fecha": "TOTAL", "Comprobante": "",
      "Paciente": `${filas.length} ventas`, "DNI": "", "Paquete": "",
      "Monto Pagado": totalPagado, "Precio Sugerido": totalSugerido,
      "Descuento": totalDescuento, "Método Pago": "",
      "Sede": nombreSede, "Estado": "",
    });

    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [
      {wch:12},{wch:16},{wch:28},{wch:12},{wch:30},
      {wch:14},{wch:16},{wch:12},{wch:14},{wch:26},{wch:12}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventas");
    const filename = `OxyNatur_Ventas_${nombreSede.replace(/\s/g,"_")}_${exportDesde}_${exportHasta}.xlsx`;
    XLSX.writeFile(wb, filename);
    setExportando(false);
    setModalExport(false);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:4}}>Ventas</h1>
          <p style={{color:"var(--text3)",fontSize:13}}>
            {sedeFija ? `Ventas de tu sede` : "Registro de paquetes y sesiones vendidas"}
          </p>
        </div>
        <div style={{display:"flex",gap:10}}>
          <Btn variant="ghost" onClick={()=>setModalExport(true)}>📊 Exportar Excel</Btn>
          <Btn onClick={openModal}>+ Nueva venta</Btn>
        </div>
      </div>

      {/* Filtro por sede — solo admin */}
      {!sedeFija && sedesData && sedesData.length >= 1 && (
        <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
          {[{id:"todas",nombre:"Todas las sedes"}, ...sedesData].map(s=>(
            <button key={s.id} onClick={()=>{
                const ciclo = calcCiclo(s.id === "todas" ? null : s.id);
                setFiltroSede(s.id);
                setFiltroDesde(ciclo.desde);
                setFiltroHasta(ciclo.hasta);
                loadVentas(s.id, 0, ciclo.desde, ciclo.hasta);
              }}
              style={{padding:"6px 14px",borderRadius:20,border:"1px solid",fontSize:12,fontWeight:600,cursor:"pointer",
                borderColor: filtroSede===s.id ? "#00A896" : "var(--border)",
                background:  filtroSede===s.id ? "#F0FDFB" : "none",
                color:       filtroSede===s.id ? "#00A896" : "var(--text3)"}}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
        <Card style={{borderTop:"3px solid #00A896",paddingTop:16}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>Período activo</div>
          <div style={{fontSize:11,color:"var(--text2)",fontWeight:600,marginTop:4,marginBottom:4}}>{cicloActual.label}</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#00A896",marginTop:4}}>{fmtSol(totalMes)}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{statsMes.cantidad} ventas en el período</div>
        </Card>
        <Card style={{borderTop:"3px solid #F59E0B",paddingTop:16}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>Descuentos otorgados</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#F59E0B",marginTop:8}}>{fmtSol(descuentosMes)}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>diferencia sugerido vs cobrado</div>
        </Card>
        <Card style={{borderTop:"3px solid #7C6AF7",paddingTop:16}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>Total registrado</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#7C6AF7",marginTop:8}}>{ventas.length}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>últimos 50 movimientos</div>
        </Card>
      </div>

      {/* Filtro por fecha + buscador */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"var(--text3)",fontWeight:600}}>Período:</span>
        <input type="date" value={filtroDesde}
          onChange={e=>{ setFiltroDesde(e.target.value); loadVentas(undefined,0,e.target.value,filtroHasta); }}
          style={{padding:"6px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}}/>
        <span style={{fontSize:12,color:"var(--text3)"}}>→</span>
        <input type="date" value={filtroHasta}
          onChange={e=>{ setFiltroHasta(e.target.value); loadVentas(undefined,0,filtroDesde,e.target.value); }}
          style={{padding:"6px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}}/>
        <button onClick={()=>{ setFiltroDesde(""); setFiltroHasta(""); loadVentas(undefined,0,"",""); }}
          style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"none",color:"var(--text3)",fontSize:12,cursor:"pointer"}}>
          Limpiar
        </button>
        </div>
        {/* Buscador */}
        <input
          type="text"
          placeholder="🔍 Buscar paciente o comprobante..."
          value={busqVenta}
          onChange={e=>setBusqVenta(e.target.value)}
          style={{padding:"7px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,fontFamily:"inherit",minWidth:260,outline:"none"}}
        />
      </div>

      {/* Tabla */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"0.5px solid #E2E8F0",fontSize:12,fontWeight:600,color:"var(--text2)",letterSpacing:"0.02em"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Ventas {totalVentas > 0 && <span style={{fontWeight:400,color:"var(--text3)",marginLeft:6}}>({totalVentas} total)</span>}</span>
            {totalVentas > PAGE_SIZE && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>{ const p=paginaVentas-1; setPaginaVentas(p); loadVentas(undefined,p); }}
                  disabled={paginaVentas===0}
                  style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:6,
                    padding:"3px 10px",cursor:"pointer",color:"var(--text)",fontSize:13,
                    opacity:paginaVentas===0?0.4:1}}>←</button>
                <span style={{fontSize:12,color:"var(--text2)"}}>{paginaVentas+1}/{Math.ceil(totalVentas/PAGE_SIZE)}</span>
                <button onClick={()=>{ const p=paginaVentas+1; setPaginaVentas(p); loadVentas(undefined,p); }}
                  disabled={(paginaVentas+1)*PAGE_SIZE>=totalVentas}
                  style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:6,
                    padding:"3px 10px",cursor:"pointer",color:"var(--text)",fontSize:13,
                    opacity:(paginaVentas+1)*PAGE_SIZE>=totalVentas?0.4:1}}>→</button>
              </div>
            )}
          </div>
        </div>
        {loadingVentas ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>Cargando...</div>
        ) : ventas.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>No hay ventas registradas</div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"var(--surface)"}}>
                  {["Fecha","Comprobante","Paciente","Paquete","Pagado","Método","Doc",""].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"11px 14px",fontSize:11,fontWeight:700,color:"var(--text3)",letterSpacing:"0.05em",textTransform:"none",letterSpacing:"0"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ventas.filter(v=>{
                  if(!busqVenta) return true;
                  const q = busqVenta.toLowerCase();
                  const nombre = `${v.pacientes?.nombres||""} ${v.pacientes?.apellidos||""}`.toLowerCase();
                  const comp = (v.numero_comprobante||"").toLowerCase();
                  const dni = (v.pacientes?.dni||"").toLowerCase();
                  return nombre.includes(q) || comp.includes(q) || dni.includes(q);
                }).map(v=>{
                  const sug = Number(v.precio_sugerido||0);
                  const pag = Number(v.monto_pagado||0);
                  const conDesc = sug > 0 && pag < sug;
                  const anulada = v.estado === "cancelado";
                  return (
                    <tr key={v.id} style={{borderTop:"0.5px solid var(--border)",opacity:anulada?0.5:1,background:anulada?"var(--surface)":"transparent"}}>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text2)"}}>{v.fecha_compra}</td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text)",fontWeight:600}}>
                        {v.numero_comprobante || <span style={{color:"var(--text3)"}}>—</span>}
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text)"}}>
                        {v.pacientes ? `${v.pacientes.apellidos}, ${v.pacientes.nombres}` : "—"}
                        {v.pacientes?.dni && <div style={{fontSize:11,color:"var(--text3)"}}>DNI {v.pacientes.dni}</div>}
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text)"}}>
                        {v.paquetes?.codigo || "—"}
                        <div style={{fontSize:11,color:"var(--text3)"}}>{v.paquetes?.nombre}</div>
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,fontWeight:600,color:conDesc?"#F59E0B":"#00A896"}}>{fmtSol(pag)}</td>
                      <td style={{padding:"11px 14px",fontSize:12,color:"var(--text3)"}}>{v.metodo_pago}</td>
                      <td style={{padding:"11px 14px"}}>
                        {v.comprobante_url
                          ? <a href={v.comprobante_url} target="_blank" rel="noreferrer"
                              style={{fontSize:12,color:"#00A896",textDecoration:"none"}}>Ver 📎</a>
                          : <span style={{fontSize:12,color:"var(--border2)"}}>—</span>
                        }
                      </td>
                      <td style={{padding:"11px 14px"}}>
                        {v.estado === "cancelado"
                          ? <span style={{fontSize:11,fontWeight:600,color:"#9CA3AF",background:"var(--surface2)",padding:"3px 8px",borderRadius:6}}>Anulada</span>
                          : f.esAdmin && (
                          <button onClick={()=>anularVenta(v)}
                            style={{background:"none",border:"none",color:"#EF4444",padding:"4px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,textDecoration:"underline",textDecorationColor:"#FECACA"}}>
                            Anular
                          </button>
                        )}
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
          <div style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:14,maxWidth:540,boxShadow:"0 20px 60px rgba(0,0,0,0.12)",width:"100%",maxHeight:"92vh",overflowY:"auto",padding:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:700,color:"var(--text)"}}>Nueva venta</div>
              <button onClick={()=>setModal(false)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            {/* Buscador de paciente con filtro */}
            {(()=>{
              const pacFiltrados = (pacientesData||[]).filter(p=>{
                if(!busqPac) return true;
                const q = busqPac.toLowerCase();
                return (p.apellidos+" "+p.nombres+" "+(p.dni||"")).toLowerCase().includes(q);
              }).slice(0,40);
              const selPac = (pacientesData||[]).find(p=>p.id===form.paciente_id);
              return (
                <div style={{marginBottom:14,position:"relative"}}>
                  <label style={{fontSize:12,color:err.paciente_id?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Paciente <span style={{color:"#F87171"}}>*</span></label>
                  <input
                    value={abiertoDropPac ? busqPac : (selPac ? `${selPac.apellidos}, ${selPac.nombres}` : "")}
                    onFocus={()=>{ setAbiertoDropPac(true); setBusqPac(""); }}
                    onChange={e=>{ setBusqPac(e.target.value); setAbiertoDropPac(true); }}
                    placeholder="Buscar por nombre o DNI..."
                    style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${err.paciente_id?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                  />
                  {abiertoDropPac && (
                    <>
                      <div style={{position:"fixed",inset:0,zIndex:199}} onMouseDown={()=>setAbiertoDropPac(false)}/>
                      <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,zIndex:200,maxHeight:220,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.15)"}}>
                        {pacFiltrados.length === 0
                          ? <div style={{padding:"10px 14px",fontSize:13,color:"var(--text3)"}}>Sin resultados</div>
                          : pacFiltrados.map(p=>(
                            <div key={p.id}
                              onMouseDown={(e)=>{ e.preventDefault(); setForm(fm=>({...fm,paciente_id:p.id})); setAbiertoDropPac(false); setBusqPac(""); }}
                              style={{padding:"9px 14px",fontSize:13,color:"var(--text)",cursor:"pointer",borderBottom:"0.5px solid var(--border)"}}
                              onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"}
                              onMouseLeave={e=>e.currentTarget.style.background=""}
                            >
                              <span style={{fontWeight:600}}>{p.apellidos}, {p.nombres}</span>
                              {p.dni && <span style={{color:"var(--text3)",marginLeft:8,fontSize:12}}>DNI {p.dni}</span>}
                            </div>
                          ))
                        }
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {err.paciente_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.paciente_id}</div>}

            {/* Sede: fija para enfermero, seleccionable para admin */}
            {sedeFija
              ? <div style={{marginBottom:14,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,fontSize:14,color:"var(--text2)"}}>
                  Sede: <strong style={{color:"var(--text)"}}>{sedesData?.[0]?.nombre || "Tu sede"}</strong>
                </div>
              : <>
                  <Select label="Sede" value={form.sede_id} onChange={v=>setForm({...form,sede_id:v})}
                    options={(sedesData||[]).map(s=>({value:s.id,label:s.nombre}))} required/>
                  {err.sede_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.sede_id}</div>}
                </>
            }

            <Select label="Paquete" value={form.paquete_id} onChange={v=>setForm({...form,paquete_id:v})}
              options={(paquetesData||[])
                .filter(p => {
                  if(!form.sede_id) return true;
                  const precioSede = p.paquetes_precios?.find(pp=>
                    pp.sede_id===form.sede_id && (pp.segmento||"regular")===(form.segmento||"regular")
                  ) || p.paquetes_precios?.find(pp=>pp.sede_id===form.sede_id);
                  if(!precioSede) return false;
                  if(precioSede.activo === false) return false;
                  return true;
                })
                .map(p=>{
                  const precioSede = p.paquetes_precios?.find(pp=>
                    pp.sede_id===form.sede_id && (pp.segmento||"regular")===(form.segmento||"regular")
                  ) || p.paquetes_precios?.find(pp=>pp.sede_id===form.sede_id);
                  const precio = precioSede ? precioSede.precio : p.precio_total;
                  const extra = precioSede?.incluye_evaluacion ? " (inc. evaluación)" : "";
                  return {value:p.id, label:`${p.codigo} — ${p.nombre}${extra} — ${fmtSol(precio)}`};
                })} required/>
            {err.paquete_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{err.paquete_id}</div>}

            {calculando && <div style={{padding:14,background:"var(--bg)",borderRadius:10,fontSize:13,color:"var(--text3)",marginBottom:14}}>Calculando precio...</div>}
            {calculo && !calculando && (
              <div style={{padding:14,background:"var(--bg)",border:"0.5px solid var(--border)",borderRadius:10,marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--text2)",marginBottom:6}}>
                  <span>Precio base</span><span>{fmtSol(calculo.precio_base)}</span>
                </div>
                {calculo.promo_aplicada && (
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#7C6AF7",marginBottom:6}}>
                    <span>{calculo.promo_aplicada} (-{calculo.descuento_pct}%)</span>
                    <span>-{fmtSol(Number(calculo.precio_base)-Number(calculo.precio_final))}</span>
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,color:"#00A896",borderTop:"0.5px solid #E2E8F0",paddingTop:8,marginTop:8}}>
                  <span>Sugerido</span><span>{fmtSol(calculo.precio_final)}</span>
                </div>
              </div>
            )}

            <Input label="Monto cobrado (S/)" type="number" value={form.monto_pagado}
              onChange={v=>setForm({...form,monto_pagado:v})} placeholder="0.00" required error={err.monto_pagado}/>
            {calculo && form.monto_pagado && Number(form.monto_pagado) !== Number(calculo.precio_final) && (
              <div style={{padding:"8px 12px",background:Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B20":"#00C4B420",border:`1px solid ${Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B40":"#00C4B440"}`,borderRadius:8,fontSize:12,color:"var(--text)",marginBottom:14}}>
                {Number(form.monto_pagado)<Number(calculo.precio_final)
                  ?`Cobrando ${fmtSol(Number(calculo.precio_final)-Number(form.monto_pagado))} menos del sugerido. Anota la razón abajo.`
                  :`Cobrando ${fmtSol(Number(form.monto_pagado)-Number(calculo.precio_final))} más del sugerido.`}
              </div>
            )}

            <Select label="Método de pago" value={form.metodo_pago} onChange={v=>setForm({...form,metodo_pago:v})}
              options={[{value:"efectivo",label:"Efectivo"},{value:"transferencia",label:"Transferencia"},{value:"tarjeta",label:"Tarjeta"},{value:"yape",label:"Yape / Plin"},{value:"kiwi",label:"Kiwi (financiamiento)"},{value:"otro",label:"Otro"}]}/>

            {/* Nota Kiwi: monto neto después de comisión 5% */}
            {form.metodo_pago === "kiwi" && form.monto_pagado && Number(form.monto_pagado) > 0 && (
              <div style={{padding:"10px 14px",background:"#7C6AF715",border:"0.5px solid #7C6AF740",borderRadius:10,fontSize:12,color:"var(--text2)",marginBottom:14}}>
                <div style={{fontWeight:700,color:"#7C6AF7",marginBottom:4}}>Financiamiento Kiwi</div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span>Monto al paciente</span>
                  <span>{fmtSol(Number(form.monto_pagado))}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span>Comisión Kiwi (5%)</span>
                  <span style={{color:"#F87171"}}>-{fmtSol(Number(form.monto_pagado)*0.05)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,borderTop:"0.5px solid #7C6AF740",paddingTop:6,marginTop:4}}>
                  <span>Neto a recibir</span>
                  <span style={{color:"#7C6AF7"}}>{fmtSol(Number(form.monto_pagado)*0.95)}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Desembolso al día hábil siguiente</div>
              </div>
            )}

            {/* Tarifa vecino La Molina — solo si la sede es Molisalud */}
            {form.sede_id === "ba7ebacd-eeca-46a8-aea4-48cad115ac37" && (
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>
                  Tipo de tarifa
                </label>
                <div style={{display:"flex",gap:8}}>
                  {[
                    {value:"regular", label:"Regular", desc:"Precio estándar"},
                    {value:"vecino",  label:"🏠 Vecino La Molina", desc:"Requiere DNI domicilio La Molina"},
                  ].map(s=>(
                    <button key={s.value} type="button"
                      onClick={()=>setForm(f=>({...f,segmento:s.value,paquete_id:""}))}
                      style={{flex:1,padding:"8px 12px",borderRadius:10,border:`1.5px solid ${form.segmento===s.value?"#00A896":"var(--border)"}`,
                        background:form.segmento===s.value?"#00A89610":"var(--surface)",
                        color:form.segmento===s.value?"#00A896":"var(--text2)",
                        cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                      <div style={{fontSize:13,fontWeight:600}}>{s.label}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fecha de venta */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                Fecha de venta <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>(por defecto hoy)</span>
              </label>
              <input type="date" value={form.fecha_compra}
                onChange={e=>setForm({...form,fecha_compra:e.target.value})}
                max={new Date().toISOString().slice(0,10)}
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            </div>

            {/* Número de comprobante — OBLIGATORIO */}
            <Input label="N° de comprobante (boleta/factura)" value={form.numero_comprobante}
              onChange={v=>setForm({...form,numero_comprobante:v})}
              placeholder="Ej: B001-00123" required error={err.numero_comprobante}/>

            {/* Upload foto del comprobante — OPCIONAL */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                Foto del comprobante <span style={{color:"var(--text3)",fontWeight:400}}>(opcional)</span>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,cursor:"pointer"}}>
                <span style={{fontSize:18}}>📷</span>
                <span style={{fontSize:13,color:"var(--text3)"}}>
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
              <label style={{fontSize:12,color:err.notas?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                Notas {calculo&&form.monto_pagado&&Number(form.monto_pagado)<Number(calculo.precio_final)&&<span style={{color:"#F87171"}}> *</span>}
              </label>
              <textarea value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})}
                placeholder="Razón del descuento, paciente referido, observaciones..."
                style={{width:"100%",background:"var(--surface2)",border:`1px solid ${err.notas?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",minHeight:60,resize:"vertical"}}/>
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

      {/* Modal exportar Excel */}
      {modalExport && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}>
          <div style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:14,maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.12)",width:"100%",padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:700,color:"var(--text)"}}>Exportar ventas</div>
              <button onClick={()=>setModalExport(false)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            {/* Sede que se va a exportar */}
            <div style={{marginBottom:18,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,fontSize:13,color:"var(--text2)"}}>
              Sede: <strong style={{color:"#00A896"}}>
                {sedeFija
                  ? (sedesData?.[0]?.nombre || "Tu sede")
                  : filtroSede === "todas"
                    ? "Todas las sedes"
                    : sedesData?.find(s=>s.id===filtroSede)?.nombre || "Todas las sedes"}
              </strong>
            </div>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Desde</label>
              <input type="date" value={exportDesde} onChange={e=>setExportDesde(e.target.value)}
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{marginBottom:22}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Hasta</label>
              <input type="date" value={exportHasta} onChange={e=>setExportHasta(e.target.value)}
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>

            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setModalExport(false)} disabled={exportando}>Cancelar</Btn>
              <Btn onClick={exportarExcel} disabled={exportando}>
                {exportando ? "Generando..." : "⬇ Descargar Excel"}
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
// ── DASHBOARD SEDE (admin_sede — solo lectura producción) ─────────────────
function DashboardSede({perfil}) {
  const sedeId = perfil?.sede_id;

  // Calcular período de liquidación: del 16 del mes anterior al 15 del mes actual
  const calcPeriodo = (offset = 0) => {
    const now = new Date();
    now.setMonth(now.getMonth() + offset);
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    // Período: 16 del mes anterior → 15 del mes actual
    const desde = new Date(y, m - 1, 16);
    const hasta = new Date(y, m, 15);
    return {
      desde: desde.toISOString().slice(0,10),
      hasta: hasta.toISOString().slice(0,10),
      label: `16 ${desde.toLocaleDateString("es-PE",{month:"long"})} → 15 ${hasta.toLocaleDateString("es-PE",{month:"long",year:"numeric"})}`,
    };
  };

  const [periodoOffset, setPeriodoOffset] = useState(0);
  const periodo = calcPeriodo(periodoOffset);
  const hoy = new Date().toISOString().slice(0,10);

  const { data: sesionesHoy } = useSupabaseQuery(
    () => supabase.from("vista_agenda_hoy").select("*").eq("sede_id", sedeId).eq("fecha", hoy),
    [sedeId, hoy], "DashboardSede:hoy"
  );
  const { data: sesionesPeriodo, loading } = useSupabaseQuery(
    () => supabase.from("sesiones")
      .select("id, estado, fecha, hora_inicio, paciente_id, pacientes(nombres,apellidos), compras_paciente(monto_pagado,sesiones_totales)")
      .eq("sede_id", sedeId)
      .gte("fecha", periodo.desde)
      .lte("fecha", periodo.hasta)
      .order("fecha", { ascending: false }),
    [sedeId, periodo.desde, periodo.hasta], "DashboardSede:periodo"
  );
  const { data: ventasPeriodo } = useSupabaseQuery(
    () => supabase.from("compras_paciente")
      .select("id, monto_pagado, fecha_compra, pacientes(nombres,apellidos)")
      .eq("sede_id", sedeId)
      .gte("fecha_compra", periodo.desde)
      .lte("fecha_compra", periodo.hasta),
    [sedeId, periodo.desde, periodo.hasta], "DashboardSede:ventas"
  );
  const { data: sedeData } = useSupabaseQuery(
    () => supabase.from("sedes").select("nombre").eq("id", sedeId).single(),
    [sedeId], "DashboardSede:sede"
  );

  const completadas    = (sesionesPeriodo||[]).filter(s => s.estado === "completada").length;
  const enCurso        = (sesionesHoy||[]).filter(s => s.estado === "en_curso").length;
  const programadasHoy = (sesionesHoy||[]).filter(s => s.estado === "programada").length;
  const pacientesUnicos = new Set((sesionesPeriodo||[]).map(s => s.paciente_id)).size;
  const ingresoBruto   = (ventasPeriodo||[]).reduce((acc, v) => acc + Number(v.monto_pagado||0), 0);
  const parteOxynatur  = ingresoBruto * 0.5;
  const parteSede      = ingresoBruto * 0.5;

  const estadoLabel = (e) => ({
    completada: "Completada", en_curso: "En curso",
    programada: "Programada", cancelada: "Cancelada"
  }[e] || e);

  const estadoStyle = (e) => ({
    padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600,
    background: e==="completada"?"#D1FAE5":e==="en_curso"?"#FEF3C7":e==="cancelada"?"#FEE2E2":"#F1F5F9",
    color:      e==="completada"?"#065F46":e==="en_curso"?"#92400E":e==="cancelada"?"#991B1B":"#64748B",
  });

  const fmtS = (n) => `S/ ${Number(n).toLocaleString("es-PE",{minimumFractionDigits:2})}`;

  // Export CSV liquidación completo
  const exportarLiquidacion = () => {
    const rows = [
      ["REPORTE DE LIQUIDACION - OXYNATUR"],
      [`Sede: ${sedeData?.nombre||""}`],
      [`Periodo: ${periodo.label}`],
      [`Generado: ${new Date().toLocaleDateString("es-PE")}`],
      [""],
      ["RESUMEN"],
      ["Concepto","Monto"],
      ["Ingreso bruto del período", fmtS(ingresoBruto)],
      ["50% Oxynatur", fmtS(parteOxynatur)],
      ["50% Sede", fmtS(parteSede)],
      [""],
      ["DETALLE DE SESIONES"],
      ["Fecha","Paciente","Hora","Estado"],
      ...(sesionesPeriodo||[]).map(s => [
        s.fecha||"",
        s.pacientes ? `${s.pacientes.apellidos}, ${s.pacientes.nombres}` : "",
        s.hora_inicio?.slice(0,5)||"",
        estadoLabel(s.estado),
      ]),
      [""],
      ["DETALLE DE VENTAS"],
      ["Fecha","Paciente","Monto cobrado"],
      ...(ventasPeriodo||[]).map(v => [
        v.fecha_compra||"",
        v.pacientes ? `${v.pacientes.apellidos}, ${v.pacientes.nombres}` : "",
        fmtS(v.monto_pagado),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `Oxynatur_Liquidacion_${(sedeData?.nombre||"sede").replace(/ /g,"_")}_${periodo.desde}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const kpi = (label, val, color="#00A896", sub="") => (
    <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,padding:"18px 20px",textAlign:"center"}}>
      <div style={{fontSize:28,fontWeight:700,color,lineHeight:1}}>{val ?? "—"}</div>
      {sub && <div style={{fontSize:11,color,marginTop:2}}>{sub}</div>}
      <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>{label}</div>
    </div>
  );

  return (
    <div style={{padding:24,maxWidth:960,margin:"0 auto"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:"var(--text)",fontFamily:"Syne,sans-serif"}}>
            {sedeData?.nombre || "Mi Sede"}
          </div>
          <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>Panel de producción — solo lectura</div>
        </div>
        <button onClick={exportarLiquidacion}
          style={{background:"#00A896",color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
          ↓ Exportar liquidación
        </button>
      </div>

      {/* Selector de período */}
      <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:600,color:"var(--text2)"}}>PERÍODO DE LIQUIDACIÓN:</span>
        <button onClick={()=>setPeriodoOffset(o=>o-1)}
          style={{background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:6,padding:"4px 10px",cursor:"pointer",color:"var(--text)"}}>←</button>
        <span style={{fontSize:13,fontWeight:600,color:"var(--text)",minWidth:260,textAlign:"center"}}>{periodo.label}</span>
        <button onClick={()=>setPeriodoOffset(o=>Math.min(0,o+1))}
          disabled={periodoOffset===0}
          style={{background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:6,padding:"4px 10px",cursor:"pointer",color:"var(--text)",opacity:periodoOffset===0?0.4:1}}>→</button>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
        {kpi("Sesiones completadas", completadas, "#00A896")}
        {kpi("Pacientes atendidos", pacientesUnicos, "#6366F1")}
        {kpi("Ingreso bruto", fmtS(ingresoBruto), "#059669")}
        {kpi("En curso hoy", enCurso, "#F59E0B")}
        {kpi("Programadas hoy", programadasHoy, "#64748B")}
      </div>

      {/* Resumen liquidación */}
      <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,padding:20,marginBottom:20}}>
        <div style={{fontWeight:600,fontSize:14,color:"var(--text)",marginBottom:14}}>Resumen de liquidación</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          {[
            {label:"Ingreso bruto período",val:fmtS(ingresoBruto),color:"#1F2937"},
            {label:"50% Oxynatur",val:fmtS(parteOxynatur),color:"#00A896"},
            {label:"50% "+( sedeData?.nombre||"Sede"),val:fmtS(parteSede),color:"#6366F1"},
          ].map(({label,val,color})=>(
            <div key={label} style={{background:"var(--surface2)",borderRadius:8,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>{label}</div>
              <div style={{fontSize:20,fontWeight:700,color}}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:12,fontSize:11,color:"var(--text3)"}}>
          * Distribución 50/50 sobre ingresos brutos del período. No incluye descuento de costos operativos.
        </div>
      </div>

      {/* Tabla sesiones */}
      <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:16}}>
        <div style={{padding:"12px 20px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>Detalle de sesiones del período</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>{(sesionesPeriodo||[]).length} registros</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:"var(--surface2)"}}>
                {["Fecha","Paciente","Hora","Estado"].map(h=>(
                  <th key={h} style={{padding:"9px 16px",textAlign:"left",fontWeight:600,color:"var(--text2)",fontSize:12}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(sesionesPeriodo||[]).slice(0,60).map((s,i)=>(
                <tr key={s.id} style={{borderTop:"0.5px solid var(--border)",background:i%2===0?"":"var(--surface2)"}}>
                  <td style={{padding:"9px 16px",color:"var(--text2)",fontSize:12}}>{s.fecha||"—"}</td>
                  <td style={{padding:"9px 16px",color:"var(--text)",fontWeight:500}}>
                    {s.pacientes?`${s.pacientes.apellidos}, ${s.pacientes.nombres}`:"—"}
                  </td>
                  <td style={{padding:"9px 16px",color:"var(--text2)"}}>{s.hora_inicio?.slice(0,5)||"—"}</td>
                  <td style={{padding:"9px 16px"}}>
                    <span style={estadoStyle(s.estado)}>{estadoLabel(s.estado)}</span>
                  </td>
                </tr>
              ))}
              {!(sesionesPeriodo||[]).length && (
                <tr><td colSpan={4} style={{padding:24,textAlign:"center",color:"var(--text3)"}}>Sin sesiones en este período</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>
        Vista de solo lectura — Oxynatur {new Date().getFullYear()} · Los costos operativos se descuentan en la liquidación final firmada
      </div>
    </div>
  );
}


function Sesiones({perfil}) {
  const f = getRolFlags(perfil);

  const ESTADO_COLOR = {
    programada:"#F59E0B", en_curso:"#00A896",
    completada:"#10B981", cancelada:"#F87171", no_asistio:"var(--text3)"
  };
  const ESTADO_LABEL = {
    programada:"Programada", en_curso:"En curso",
    completada:"Completada", cancelada:"Cancelada", no_asistio:"No asistió"
  };

  // Fecha seleccionada — default hoy
  const hoy = fechaHoyLima();
  const [fecha, setFecha]       = useState(hoy);
  const [sesiones, setSesiones] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [verSesion, setVerSesion] = useState(null);  // modal detalle/completar
  const [modalNueva, setModalNueva] = useState(false);
  const [busqPacSes, setBusqPacSes] = useState("");
  const [abiertoDropPacSes, setAbiertoDropPacSes] = useState(false);
  const [showCal, setShowCal] = useState(false);

  // Checklist de cámara — paso previo al cuestionario pre
  const [modalChecklist, setModalChecklist] = useState(null);
  const [checklist, setChecklist]           = useState({});

  const CHECKLIST_CAMARA = [
    {key:"limpieza",       label:"La cámara está limpia y desinfectada"},
    {key:"oxigeno",        label:"El suministro de oxígeno está conectado y con presión suficiente"},
    {key:"comunicacion",   label:"El sistema de comunicación interior funciona correctamente"},
    {key:"valvula",        label:"La válvula de seguridad está operativa"},
    {key:"visor",          label:"El visor/ventana está libre de daños visibles"},
    {key:"presurizacion",  label:"El sistema de presurización responde correctamente"},
    {key:"ropa_paciente",  label:"El paciente tiene ropa de algodón 100%"},
    {key:"objetos",        label:"El paciente retiró todos los objetos metálicos y electrónicos"},
    {key:"senal_salida",   label:"El paciente conoce la señal para pedir salida"},
    {key:"area_libre",     label:"El área alrededor de la cámara está libre de materiales inflamables"},
  ];

  // Modal iniciar — cuestionario pre + signos pre
  const [modalIniciar, setModalIniciar]   = useState(null);
  const [cuestionarioPre, setCuestionarioPre] = useState({});
  const [signosPre, setSignosPre]         = useState({presion_arterial_pre:"",saturacion_o2_pre:"",frecuencia_cardiaca:"",temperatura:"",peso:"",nivel_dolor:0});
  const [savingIniciar, setSavingIniciar] = useState(false);
  const [errIniciar, setErrIniciar] = useState("");

  const CUESTIONARIO_PRE = [
    {key:"resfriado",        label:"¿Está resfriado o con congestión nasal?",                  accion:"Suspender. Llamar médico.", invertido:false},
    {key:"dolor_oidos",      label:"¿Tiene dolor de oídos o sinusal en este momento?",          accion:"Suspender. Llamar médico.", invertido:false},
    {key:"fiebre",           label:"¿Tiene fiebre hoy?",                                        accion:"Suspender. Llamar médico.", invertido:false},
    {key:"alcohol",          label:"¿Consumió alcohol en las últimas 12 horas?",                accion:"Suspender. Llamar médico.", invertido:false},
    {key:"medicamento_nuevo",label:"¿Tomó algún medicamento nuevo desde la última sesión?",     accion:"Llamar médico antes de iniciar.", invertido:false},
    {key:"sintoma_nuevo",    label:"¿Tiene algún síntoma nuevo o cambio en su estado?",         accion:"Llamar médico antes de iniciar.", invertido:false},
    {key:"comio",            label:"¿Comió al menos 2 horas antes de la sesión?",              accion:"Informar al médico (hipoglucemia).", invertido:true},
  ];

  const hayAlertaPre = CUESTIONARIO_PRE.some(q=>{
    const resp = cuestionarioPre[q.key];
    return q.invertido ? resp===false : resp===true;
  });

  // Validar rangos de signos vitales — retorna array de alertas
  const validarSignosPre = () => {
    const alertas = [];
    const fc = Number(signosPre.frecuencia_cardiaca);
    const sat = Number(signosPre.saturacion_o2_pre);
    const temp = Number(signosPre.temperatura);
    const dolor = Number(signosPre.nivel_dolor);

    // Presión arterial — parsear sistólica/diastólica
    if(signosPre.presion_arterial_pre) {
      const partes = signosPre.presion_arterial_pre.split("/");
      if(partes.length === 2) {
        const sist = Number(partes[0]);
        const diast = Number(partes[1]);
        if(sist < 90 || sist > 140 || diast < 60 || diast > 90)
          alertas.push(`Presión arterial ${signosPre.presion_arterial_pre} fuera de rango normal (90/60 – 140/90)`);
      }
    }
    if(signosPre.frecuencia_cardiaca && (fc < 60 || fc > 100))
      alertas.push(`Frecuencia cardíaca ${fc} bpm fuera de rango normal (60–100 bpm)`);
    if(signosPre.saturacion_o2_pre && sat < 94)
      alertas.push(`Saturación O₂ ${sat}% por debajo del mínimo requerido (≥94%)`);
    if(signosPre.temperatura && (temp < 36.0 || temp > 37.5))
      alertas.push(`Temperatura ${temp}°C fuera de rango normal (36.0–37.5°C)`);
    if(dolor > 5)
      alertas.push(`Nivel de dolor ${dolor}/10 elevado — consultar con médico`);
    return alertas;
  };

  const confirmarIniciar = async () => {
    setSavingIniciar(true);
    setErrIniciar("");

    // Validar rangos de signos vitales
    const alertasSignos = validarSignosPre();
    if(alertasSignos.length > 0) {
      const msg = "ATENCION: Se detectaron valores fuera de rango:\n\n" +
        alertasSignos.map(a => "• " + a).join("\n") +
        "\n\nSegún el protocolo, debe llamar al médico on-call antes de iniciar.\n\n¿Continuar de todas formas?";
      const ok = window.confirm(msg);
      if(!ok) { setSavingIniciar(false); return; }
    }

    const { error } = await safeQuery(()=> supabase.from("sesiones").update({
      estado:              "en_curso",
      hora_inicio_real:    new Date().toTimeString().slice(0,5),
      cuestionario_pre:    cuestionarioPre,
      presion_arterial_pre: signosPre.presion_arterial_pre||null,
      saturacion_o2_pre:   signosPre.saturacion_o2_pre ? Number(signosPre.saturacion_o2_pre) : null,
      frecuencia_cardiaca: signosPre.frecuencia_cardiaca ? Number(signosPre.frecuencia_cardiaca) : null,
      temperatura:         signosPre.temperatura ? Number(signosPre.temperatura) : null,
      peso:                signosPre.peso ? Number(signosPre.peso) : null,
      nivel_dolor:         Number(signosPre.nivel_dolor)||0,
    }).eq("id", modalIniciar.id), "Sesiones:iniciar");
    setSavingIniciar(false);
    if(error) {
      setErrIniciar(`Error al iniciar: ${error?.message || error?.code || JSON.stringify(error)}`);
      return;
    }
    setModalIniciar(null);
    setCuestionarioPre({});
    setSignosPre({presion_arterial_pre:"",saturacion_o2_pre:"",frecuencia_cardiaca:"",temperatura:"",peso:"",nivel_dolor:0});
    load();
  };

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
    presion_arterial:"", saturacion_o2:"", frecuencia_cardiaca_post:"",
    observaciones:"", requiere_atencion:false,
  });
  const [savingCompletar, setSavingCompletar] = useState(false);

  // Registro de llamada al médico on-call
  const [showLlamada, setShowLlamada]   = useState(false);
  const [formLlamada, setFormLlamada]   = useState({hora:"", motivo:"", respuesta:""});
  const [llamadasSesion, setLlamadasSesion] = useState([]);
  const MOTIVOS_LLAMADA = [
    "Primer sesión del paciente",
    "Síntoma nuevo reportado",
    "Signo vital fuera de rango",
    "Paciente solicitó salir de cámara",
    "Anomalía técnica del equipo",
    "Paciente con comorbilidad",
    "Medicamento nuevo",
    "Otro motivo",
  ];

  const programar = async () => {
    const e = {};
    if(!formNueva.paciente_id) e.paciente_id = "Requerido";
    if(!formNueva.camara_id)   e.camara_id   = "Requerido";
    if(!formNueva.fecha)       e.fecha       = "Requerido";
    if(!formNueva.hora_inicio) e.hora_inicio = "Requerido";
    // Validar que el paciente tenga paquete con sesiones disponibles
    if(formNueva.paciente_id && comprasDelPaciente(formNueva.paciente_id).length === 0) {
      e.paciente_id = "Este paciente no tiene sesiones disponibles. Debe adquirir un paquete primero.";
    }
    // numero_sesion se calcula automáticamente si hay compra_id
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
      numero_sesion:     (() => { const c = comprasData?.find(x=>x.id===formNueva.compra_id) || comprasDelPaciente(formNueva.paciente_id)[0]; return c ? c.sesiones_usadas+1 : 1; })(),
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
      llamadas_oncall:   llamadasSesion.length > 0 ? llamadasSesion : null,
      nivel_dolor:       formCompletar.nivel_dolor,
      estado_general:    formCompletar.estado_general,
      presion_arterial:  formCompletar.presion_arterial||null,
      saturacion_o2:     formCompletar.saturacion_o2 ? Number(formCompletar.saturacion_o2) : null,
      frecuencia_cardiaca_post: formCompletar.frecuencia_cardiaca_post ? Number(formCompletar.frecuencia_cardiaca_post) : null,
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
    if(!window.confirm("¿Cancelar esta sesión?")) return;
    await safeQuery(() => supabase.from("sesiones").update({ estado:"cancelada" }).eq("id", sesion.id), "Sesiones:cancelar");
    load();
  };

  const [modalReprog, setModalReprog] = useState(null);
  const [formReprog, setFormReprog]   = useState({fecha:"", hora_inicio:"", hora_fin:""});
  const [savingReprog, setSavingReprog] = useState(false);

  const reprogramar = async () => {
    if(!formReprog.fecha || !formReprog.hora_inicio) return;
    setSavingReprog(true);
    await safeQuery(()=>
      supabase.from("sesiones").update({
        fecha:       formReprog.fecha,
        hora_inicio: formReprog.hora_inicio,
        hora_fin:    formReprog.hora_fin||null,
        estado:      "programada",
      }).eq("id", modalReprog.id),
      "Sesiones:reprogramar"
    );
    setSavingReprog(false);
    setModalReprog(null);
    // Si la nueva fecha es diferente a la seleccionada, ir a esa fecha
    setFecha(formReprog.fecha);
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
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:4}}>Sesiones</h1>
          <p style={{color:"var(--text3)",fontSize:14}}>Agenda de sesiones hiperbáricas</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>{ const d=new Date(fecha+"T12:00:00"); d.setDate(d.getDate()-1); setFecha(d.toLocaleDateString("en-CA",{timeZone:"America/Lima"})); }}
            style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"7px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:16,lineHeight:1}}>‹</button>
          <div style={{position:"relative"}}>
            <button onClick={()=>setShowCal(c=>!c)}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text)",
                padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,
                display:"flex",alignItems:"center",gap:6}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              {new Date(fecha+"T12:00:00").toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"})}
            </button>
            {showCal && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:100}}
                onMouseLeave={()=>setShowCal(false)}>
                <MiniCal fecha={fecha} onChange={d=>{ setFecha(d); setShowCal(false); }}/>
              </div>
            )}
          </div>
          <button onClick={()=>{ const d=new Date(fecha+"T12:00:00"); d.setDate(d.getDate()+1); setFecha(d.toLocaleDateString("en-CA",{timeZone:"America/Lima"})); }}
            style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"7px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:16,lineHeight:1}}>›</button>
          {(f.esAdmin || f.esMedico || f.esEnfermero) && (
            <Btn onClick={()=>setModalNueva(true)}>+ Programar sesión</Btn>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Total del día",  val:total,      color:"var(--text)"},
          {label:"En curso",       val:enCurso,    color:"#00A896"},
          {label:"Completadas",    val:completadas, color:"#10B981"},
          {label:"Pendientes",     val:pendientes, color:"#F59E0B"},
        ].map((k,i)=>(
          <Card key={i} style={{minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}</div>
          </Card>
        ))}
      </div>

      {/* Lista sesiones */}
      {loading
        ? <div style={{color:"var(--text3)",padding:20}}>Cargando agenda...</div>
        : sesiones.length === 0
          ? <Card style={{textAlign:"center",padding:"50px"}}>
              <div style={{fontSize:36,opacity:.3,marginBottom:12}}>⚡</div>
              <div style={{color:"var(--text3)"}}>No hay sesiones para esta fecha</div>
            </Card>
          : sesiones.map(s => (
            <div key={s.id} style={{
              background:"var(--surface)", border:"0.5px solid var(--border)",
              borderLeft:`3px solid ${ESTADO_COLOR[s.estado]||"var(--border2)"}`,
              borderRadius:12, padding:"14px 18px", marginBottom:8,
              display:"grid", gridTemplateColumns:"80px 2fr 1fr 1fr 1fr auto",
              alignItems:"center", gap:12,
            }}>
              {/* Hora */}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:700,color:"#00A896",fontFamily:"Syne,sans-serif"}}>{s.hora_inicio?.slice(0,5)||"--:--"}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{s.hora_fin?.slice(0,5)||""}</div>
              </div>

              {/* Paciente */}
              <div>
                <div style={{fontWeight:600,fontSize:14,color:"var(--text)"}}>{s.paciente}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  DNI {s.dni} · Sesión #{s.numero_sesion}
                  {s.sesiones_restantes != null && (
                    <span style={{color: s.sesiones_restantes <= 2 ? "#F87171" : "var(--text3)"}}>
                      {" "}· {s.sesiones_restantes} restantes
                    </span>
                  )}
                </div>
              </div>

              {/* Cámara */}
              <div style={{fontSize:13,color:"var(--text2)"}}>
                {s.camara_numero ? `Cámara #${s.camara_numero}` : "—"}
                <div style={{fontSize:11,color:"var(--text3)"}}>{s.presion_aplicada} ATA · {s.duracion_minutos} min</div>
              </div>

              {/* Sede */}
              <div style={{fontSize:13,color:"var(--text2)"}}>{s.sede_nombre}</div>

              {/* Estado */}
              <Badge color={ESTADO_COLOR[s.estado]||"var(--text3)"}>{ESTADO_LABEL[s.estado]||s.estado}</Badge>

              {/* Acciones */}
              <div style={{display:"flex",gap:6}}>
                {s.estado === "programada" && (
                  <>
                    <button onClick={(e)=>{ e.stopPropagation(); setModalChecklist(s); setChecklist({}); }}
                      style={{background:"#00A89620",border:"0.5px solid #00A89640",color:"#00A896",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                      ▶ Iniciar
                    </button>
                    <button onClick={()=>cancelar(s)}
                      style={{background:"#F8717115",border:"1px solid #F8717130",color:"#F87171",padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                      ✕
                    </button>
                  </>
                )}
                {s.estado === "en_curso" && (
                  <button onClick={()=>{ setVerSesion(s); setFormCompletar({hora_inicio_real:s.hora_inicio_real||s.hora_inicio?.slice(0,5)||"",hora_fin_real:new Date().toTimeString().slice(0,5),nivel_dolor:0,estado_general:"Bueno",tolerancia:"Buena",observaciones:"",requiere_atencion:false,presion_arterial:"",saturacion_o2:""}); }}
                    style={{background:"#10B98120",border:"1px solid #10B98140",color:"#10B981",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                    ✓ Completar
                  </button>
                )}
                {s.estado === "cancelada" && (f.esAdmin || f.esEnfermero || f.esMedico) && (
                  <button onClick={()=>{ setModalReprog(s); setFormReprog({fecha:fecha,hora_inicio:s.hora_inicio?.slice(0,5)||"08:00",hora_fin:s.hora_fin?.slice(0,5)||"09:30"}); }}
                    style={{background:"#7C6AF720",border:"1px solid #7C6AF740",color:"#7C6AF7",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                    📅 Reprogramar
                  </button>
                )}
                {s.estado === "completada" && (
                  <button onClick={()=>setVerSesion(s)}
                    style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",color:"var(--text2)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
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
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:520,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Programar Sesión</div>
              <button onClick={()=>setModalNueva(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {/* Buscador de paciente */}
              <div style={{marginBottom:14,position:"relative"}}>
                <label style={{fontSize:12,color:errNueva.paciente_id?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                  Paciente <span style={{color:"#F87171"}}>*</span>
                </label>
                <div style={{position:"relative"}}>
                  <input
                    type="text"
                    placeholder="Buscar por nombre o DNI..."
                    value={abiertoDropPacSes
                      ? busqPacSes
                      : (() => { const p = (pacientesData||[]).find(x=>x.id===formNueva.paciente_id); return p ? `${p.apellidos}, ${p.nombres} — DNI ${p.dni}` : ""; })()
                    }
                    onFocus={()=>{ setAbiertoDropPacSes(true); setBusqPacSes(""); }}
                    onChange={e=>{ setBusqPacSes(e.target.value); setAbiertoDropPacSes(true); }}
                    style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${errNueva.paciente_id?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                  />
                  {abiertoDropPacSes && (
                    <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,zIndex:9999,maxHeight:200,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.3)"}}>
                      {(pacientesData||[])
                        .filter(p => {
                          const q = busqPacSes.toLowerCase();
                          return !q || `${p.nombres} ${p.apellidos} ${p.dni}`.toLowerCase().includes(q);
                        })
                        .slice(0,20)
                        .map(p => (
                          <div key={p.id}
                            onMouseDown={e=>{ e.preventDefault(); setFormNueva(f=>({...f,paciente_id:p.id,compra_id:""})); setAbiertoDropPacSes(false); setBusqPacSes(""); }}
                            style={{padding:"10px 14px",fontSize:13,color:"var(--text)",cursor:"pointer",borderBottom:"0.5px solid var(--border)"}}
                            onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                          >
                            <span style={{fontWeight:600}}>{p.apellidos}, {p.nombres}</span>
                            <span style={{color:"var(--text2)",marginLeft:8,fontSize:12}}>DNI {p.dni}</span>
                          </div>
                        ))
                      }
                      {(pacientesData||[]).filter(p=>{ const q=busqPacSes.toLowerCase(); return !q||`${p.nombres} ${p.apellidos} ${p.dni}`.toLowerCase().includes(q); }).length===0 && (
                        <div style={{padding:"10px 14px",fontSize:13,color:"var(--text2)"}}>No se encontraron pacientes</div>
                      )}
                    </div>
                  )}
                </div>
                {abiertoDropPacSes && <div style={{position:"fixed",inset:0,zIndex:9998}} onClick={()=>setAbiertoDropPacSes(false)}/>}
              </div>
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

              {/* Aviso sin paquete */}
              {formNueva.paciente_id && comprasDelPaciente(formNueva.paciente_id).length === 0 && (
                <div style={{background:"rgba(248,113,113,0.12)",border:"1px solid rgba(248,113,113,0.5)",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>🚫</span>
                  <span style={{fontSize:13,color:"#F87171",fontWeight:600}}>Sin paquete activo. Registra una venta antes de programar sesión.</span>
                </div>
              )}

              <Select label="Cámara" value={formNueva.camara_id}
                onChange={v=>setFormNueva(f=>({...f,camara_id:v}))}
                options={(camarasData||[]).map(c=>({value:c.id,label:`Cámara #${c.numero} — ${c.modelo}`}))} required/>
              {errNueva.camara_id && <div style={{fontSize:11,color:"#F87171",marginTop:-10,marginBottom:10}}>{errNueva.camara_id}</div>}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Input label="Fecha" type="date" value={formNueva.fecha}
                  onChange={v=>setFormNueva(f=>({...f,fecha:v}))} required error={errNueva.fecha}/>
                {/* N° de sesión — calculado automáticamente, solo lectura */}
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                    N° de sesión <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(automático)</span>
                  </label>
                  <div style={{padding:"10px 14px",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,fontSize:14,color:"var(--text)",fontWeight:600}}>
                    {formNueva.compra_id
                      ? (() => { const c = comprasData?.find(x=>x.id===formNueva.compra_id); return c ? `#${c.sesiones_usadas+1} de ${c.sesiones_totales}` : "—"; })()
                      : formNueva.paciente_id
                        ? (() => { const c = comprasDelPaciente(formNueva.paciente_id)[0]; return c ? `#${c.sesiones_usadas+1} de ${c.sesiones_totales}` : "—"; })()
                        : <span style={{color:"var(--text3)",fontWeight:400}}>Selecciona paciente y paquete</span>
                    }
                  </div>
                </div>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"flex-end",gap:10}}>
              <Btn variant="ghost" onClick={()=>setModalNueva(false)}>Cancelar</Btn>
              <Btn onClick={programar} disabled={savingNueva}>{savingNueva?"Guardando...":"Programar"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal reprogramar sesión */}
      {modalReprog && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:420,padding:28}}>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:4}}>Reprogramar Sesión</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>{modalReprog.paciente} · Sesión #{modalReprog.numero_sesion}</div>
            <Input label="Nueva fecha" type="date" value={formReprog.fecha} onChange={v=>setFormReprog(f=>({...f,fecha:v}))} required/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Input label="Hora inicio" type="time" value={formReprog.hora_inicio} onChange={v=>setFormReprog(f=>({...f,hora_inicio:v}))} required/>
              <Input label="Hora fin estimada" type="time" value={formReprog.hora_fin} onChange={v=>setFormReprog(f=>({...f,hora_fin:v}))}/>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:8}}>
              <Btn variant="ghost" onClick={()=>setModalReprog(null)}>Cancelar</Btn>
              <Btn onClick={reprogramar} disabled={savingReprog||!formReprog.fecha||!formReprog.hora_inicio}>
                {savingReprog?"Guardando...":"Reprogramar"}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal completar / ver sesión */}
      {verSesion && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:10,color:"#00A896",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>
                  Sesión #{verSesion.numero_sesion} · {verSesion.camara_numero ? `Cámara #${verSesion.camara_numero}` : ""}
                </div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>{verSesion.paciente}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>
                  {verSesion.sede_nombre} · {verSesion.fecha} · {verSesion.presion_aplicada} ATA · {verSesion.duracion_minutos} min
                </div>
              </div>
              <button onClick={()=>setVerSesion(null)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>

              {/* Si completada — mostrar registro */}
              {verSesion.estado === "completada" ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[
                    ["Hora inicio real", verSesion.hora_inicio_real?.slice(0,5)],
                    ["Hora fin real",    verSesion.hora_fin_real?.slice(0,5)],
                    ["PA post",          verSesion.presion_arterial],
                    ["FC post",          verSesion.frecuencia_cardiaca_post ? `${verSesion.frecuencia_cardiaca_post} bpm` : null],
                    ["SatO₂ post",       verSesion.saturacion_o2 ? `${verSesion.saturacion_o2}%` : null],
                    ["Nivel de dolor",   verSesion.nivel_dolor != null ? `${verSesion.nivel_dolor}/10` : null],
                    ["Estado general",   verSesion.estado_general],
                    ["Tolerancia",       verSesion.tolerancia],
                    ["Observaciones",    verSesion.observaciones],
                  ].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} style={{background:"var(--surface)",borderRadius:10,padding:"10px 14px",gridColumn:k==="Observaciones"?"1/-1":undefined}}>
                      <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{k}</div>
                      <div style={{fontSize:14,color:"var(--text)"}}>{v}</div>
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
                  {/* Horario */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                    <Input label="Hora inicio real" type="time" value={formCompletar.hora_inicio_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_inicio_real:v}))}/>
                    <Input label="Hora fin real" type="time" value={formCompletar.hora_fin_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_fin_real:v}))}/>
                  </div>

                  {/* Sección F — Signos vitales POST */}
                  <div style={{marginBottom:16,border:"0.5px solid #00A89640",borderRadius:10,overflow:"hidden"}}>
                    <div style={{padding:"8px 14px",background:"#00A89608",fontSize:11,fontWeight:700,color:"#00A896",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                      F. Signos vitales post-sesión — Al salir de cámara
                    </div>
                    <div style={{padding:"12px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div>
                        <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>Presión arterial</label>
                        <input type="text" value={formCompletar.presion_arterial||""} placeholder="120/80"
                          onChange={e=>setFormCompletar(f=>({...f,presion_arterial:e.target.value}))}
                          style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      </div>
                      <div>
                        <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>Frec. cardíaca post (bpm)</label>
                        <input type="number" value={formCompletar.frecuencia_cardiaca_post||""} placeholder="72"
                          onChange={e=>setFormCompletar(f=>({...f,frecuencia_cardiaca_post:e.target.value}))}
                          style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      </div>
                      <div>
                        <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>Saturación O₂ (%)</label>
                        <input type="number" value={formCompletar.saturacion_o2||""} placeholder="98"
                          onChange={e=>setFormCompletar(f=>({...f,saturacion_o2:e.target.value}))}
                          style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      </div>
                      <div style={{gridColumn:"1/-1"}}>
                        <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:6}}>
                          Nivel de dolor post: <span style={{color:formCompletar.nivel_dolor>=7?"#F87171":formCompletar.nivel_dolor>=4?"#F59E0B":"#10B981",fontWeight:700}}>{formCompletar.nivel_dolor}/10</span>
                        </label>
                        <input type="range" min="0" max="10" value={formCompletar.nivel_dolor}
                          onChange={e=>setFormCompletar(f=>({...f,nivel_dolor:parseInt(e.target.value)}))}
                          style={{width:"100%",accentColor:"#00A896"}}/>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:2}}>
                          <span>Sin dolor</span><span>Dolor máximo</span>
                        </div>
                      </div>
                    </div>
                    {formCompletar.saturacion_o2 && Number(formCompletar.saturacion_o2) < 92 && (
                      <div style={{margin:"0 14px 12px",padding:"8px 12px",background:"#F8717110",border:"0.5px solid #F8717140",borderRadius:8,fontSize:12,color:"#F87171",fontWeight:600}}>
                        ⚠ SatO₂ post &lt; 92% — Llamar al médico on-call. No dar de alta al paciente.
                      </div>
                    )}
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
                    <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Observaciones</label>
                    <textarea value={formCompletar.observaciones}
                      onChange={e=>setFormCompletar(f=>({...f,observaciones:e.target.value}))}
                      placeholder="Incidencias, reacciones, notas del operador..."
                      rows={3}
                      style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
                  </div>

                  {/* Flag alerta */}
                  <div style={{padding:"12px 14px",background:"var(--surface2)",borderRadius:10,border:"1px solid #2A3550",display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <input type="checkbox" id="reqAtencion" checked={formCompletar.requiere_atencion}
                      onChange={e=>setFormCompletar(f=>({...f,requiere_atencion:e.target.checked}))}
                      style={{width:16,height:16,cursor:"pointer",accentColor:"#F87171"}}/>
                    <label htmlFor="reqAtencion" style={{fontSize:14,color:"var(--text)",cursor:"pointer"}}>
                      🔔 Requiere atención médica
                      <span style={{fontSize:12,color:"var(--text3)",display:"block"}}>Genera alerta automática al especialista y médico de sede</span>
                    </label>
                  </div>

                  {/* ── REGISTRO DE LLAMADA AL MÉDICO ON-CALL ── */}
                  <div style={{marginTop:16,border:"0.5px solid #F59E0B40",borderRadius:10,overflow:"hidden"}}>
                    <div style={{background:"#FEF3C7",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#92400E"}}>Llamadas al médico on-call {llamadasSesion.length > 0 && <span style={{background:"#F59E0B",color:"white",borderRadius:10,padding:"1px 7px",marginLeft:6,fontSize:11}}>{llamadasSesion.length}</span>}</div>
                      <button onClick={()=>setShowLlamada(v=>!v)}
                        style={{fontSize:11,background:"#F59E0B",color:"white",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>
                        {showLlamada ? "Cerrar" : "+ Registrar llamada"}
                      </button>
                    </div>

                    {showLlamada && (
                      <div style={{padding:"12px 14px",background:"var(--surface2)",borderTop:"0.5px solid #F59E0B40"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                          <div>
                            <label style={{fontSize:11,fontWeight:600,color:"var(--text2)",display:"block",marginBottom:4}}>Hora de llamada *</label>
                            <input type="time" value={formLlamada.hora}
                              onChange={e=>setFormLlamada(f=>({...f,hora:e.target.value}))}
                              style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                          </div>
                          <div>
                            <label style={{fontSize:11,fontWeight:600,color:"var(--text2)",display:"block",marginBottom:4}}>Motivo *</label>
                            <select value={formLlamada.motivo}
                              onChange={e=>setFormLlamada(f=>({...f,motivo:e.target.value}))}
                              style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                              <option value="">Seleccionar motivo</option>
                              {MOTIVOS_LLAMADA.map(m=><option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{marginBottom:10}}>
                          <label style={{fontSize:11,fontWeight:600,color:"var(--text2)",display:"block",marginBottom:4}}>Indicación del médico</label>
                          <textarea value={formLlamada.respuesta}
                            onChange={e=>setFormLlamada(f=>({...f,respuesta:e.target.value}))}
                            placeholder="Ej: Médico indicó continuar sesión, monitorear cada 10 min..."
                            rows={2}
                            style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
                        </div>
                        <button
                          disabled={!formLlamada.hora || !formLlamada.motivo}
                          onClick={()=>{
                            if(!formLlamada.hora || !formLlamada.motivo) return;
                            setLlamadasSesion(l=>[...l,{...formLlamada, registrada_en: new Date().toISOString()}]);
                            setFormLlamada({hora:"",motivo:"",respuesta:""});
                            setShowLlamada(false);
                          }}
                          style={{background:"#F59E0B",color:"white",border:"none",borderRadius:8,padding:"7px 16px",fontSize:13,fontWeight:600,cursor:"pointer",opacity:(!formLlamada.hora||!formLlamada.motivo)?0.5:1}}>
                          Guardar llamada
                        </button>
                      </div>
                    )}

                    {llamadasSesion.length > 0 && (
                      <div style={{padding:"8px 14px"}}>
                        {llamadasSesion.map((ll,i)=>(
                          <div key={i} style={{fontSize:12,color:"var(--text)",padding:"6px 0",borderTop:i>0?"0.5px solid var(--border)":"none",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div>
                              <span style={{fontWeight:600,color:"#92400E"}}>{ll.hora}</span>
                              <span style={{color:"var(--text2)",marginLeft:8}}>{ll.motivo}</span>
                              {ll.respuesta && <div style={{color:"var(--text3)",marginTop:2,fontSize:11}}>{ll.respuesta}</div>}
                            </div>
                            <button onClick={()=>setLlamadasSesion(l=>l.filter((_,j)=>j!==i))}
                              style={{background:"none",border:"none",color:"#F87171",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {llamadasSesion.length === 0 && !showLlamada && (
                      <div style={{padding:"10px 14px",fontSize:12,color:"var(--text3)"}}>
                        Sin llamadas registradas en esta sesión
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"flex-end",gap:10}}>
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

      {/* ── CHECKLIST DE CÁMARA — paso 1 antes del cuestionario pre ── */}
      {modalChecklist && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--surface)",borderRadius:16,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            {/* Header */}
            <div style={{padding:"20px 24px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#00A896",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Checklist de cámara</div>
                <div style={{fontSize:18,fontWeight:700,color:"var(--text)",fontFamily:"Syne,sans-serif"}}>
                  {modalChecklist.paciente}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  Sesión #{modalChecklist.numero_sesion} · {modalChecklist.sede_nombre}
                </div>
              </div>
              <button onClick={()=>setModalChecklist(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18,padding:4}}>×</button>
            </div>

            {/* Body */}
            <div style={{padding:"16px 24px"}}>
              <div style={{fontSize:12,color:"var(--text2)",marginBottom:16,background:"#FEF3C7",border:"0.5px solid #FCD34D",borderRadius:8,padding:"8px 12px"}}>
                Verifica cada punto antes de proceder. Todos deben estar confirmados.
              </div>
              {CHECKLIST_CAMARA.map((item, i) => {
                const checked = checklist[item.key] === true;
                return (
                  <div key={item.key} onClick={()=>setChecklist(c=>({...c,[item.key]:!c[item.key]}))}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderRadius:10,marginBottom:6,cursor:"pointer",
                      background: checked ? "#ECFDF5" : "var(--surface2)",
                      border: `0.5px solid ${checked ? "#6EE7B7" : "var(--border)"}`,
                      transition:"all 0.15s"}}>
                    <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${checked?"#00A896":"var(--border)"}`,
                      background:checked?"#00A896":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                      {checked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>}
                    </div>
                    <span style={{fontSize:13,color:checked?"#065F46":"var(--text)",fontWeight:checked?500:400}}>
                      {i+1}. {item.label}
                    </span>
                  </div>
                );
              })}

              {/* Contador */}
              <div style={{marginTop:12,fontSize:12,color:"var(--text3)",textAlign:"center"}}>
                {Object.values(checklist).filter(Boolean).length} de {CHECKLIST_CAMARA.length} verificados
              </div>
            </div>

            {/* Footer */}
            <div style={{padding:"12px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <button onClick={()=>setModalChecklist(null)}
                style={{background:"var(--surface2)",color:"var(--text2)",border:"0.5px solid var(--border)",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer"}}>
                Cancelar
              </button>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {Object.values(checklist).filter(Boolean).length < CHECKLIST_CAMARA.length && (
                  <span style={{fontSize:11,color:"#F59E0B"}}>
                    Faltan {CHECKLIST_CAMARA.length - Object.values(checklist).filter(Boolean).length} ítems
                  </span>
                )}
                <button
                  onClick={()=>{
                    setModalChecklist(null);
                    setModalIniciar(modalChecklist);
                    setCuestionarioPre({});
                    setSignosPre({presion_arterial_pre:"",saturacion_o2_pre:"",frecuencia_cardiaca:"",temperatura:"",peso:"",nivel_dolor:0});
                  }}
                  disabled={Object.values(checklist).filter(Boolean).length < CHECKLIST_CAMARA.length}
                  style={{background:"#00A896",color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer",
                    opacity: Object.values(checklist).filter(Boolean).length < CHECKLIST_CAMARA.length ? 0.5 : 1}}>
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Iniciar — Cuestionario pre + Signos vitales pre */}
      {modalIniciar && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:560,width:"100%",
            boxShadow:"0 20px 60px rgba(0,0,0,0.15)",maxHeight:"92vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* Header */}
            <div style={{padding:"16px 20px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexShrink:0}}>
              <div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)"}}>
                  Iniciar sesión — #{modalIniciar.numero_sesion}
                  {modalIniciar.sesiones_totales > 0 && (
                    <span style={{fontSize:12,fontWeight:400,color:"var(--text3)",marginLeft:8}}>
                      de {modalIniciar.sesiones_totales}
                    </span>
                  )}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {modalIniciar.paciente} · {modalIniciar.sede_nombre}
                </div>
                {modalIniciar.sesiones_totales > 0 && (()=>{
                  const completadas = modalIniciar.numero_sesion - 1;
                  const restantes = modalIniciar.sesiones_totales - completadas;
                  const pct = Math.min(100, (completadas / modalIniciar.sesiones_totales) * 100);
                  return (
                    <div style={{marginTop:8}}>
                      <div style={{background:"var(--border)",borderRadius:4,height:4,width:"100%",overflow:"hidden"}}>
                        <div style={{background:"#00A896",height:"100%",borderRadius:4,width:`${pct}%`,transition:"width 0.3s"}}/>
                      </div>
                      <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>
                        {completadas} de {modalIniciar.sesiones_totales} completadas
                        <span style={{color:restantes<=2?"#F87171":"var(--text3)",marginLeft:6}}>
                          · {restantes} restantes
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <button onClick={()=>setModalIniciar(null)}
                style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:20}}>×</button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>

              {/* Sección B — Cuestionario pre-sesión */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:11,color:"#7C6AF7",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
                  B. Cuestionario pre-sesión
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,padding:"8px 12px",background:"var(--surface2)",borderRadius:8}}>
                  Completar ANTES de que el paciente ingrese a cámara. <strong style={{color:"#F87171"}}>Cualquier Sí → suspender y llamar al médico.</strong>
                </div>

                {CUESTIONARIO_PRE.map((q,i)=>{
                  const resp = cuestionarioPre[q.key];
                  const esAlerta = q.invertido ? resp===false : resp===true;
                  return (
                    <div key={q.key} style={{
                      marginBottom:8,padding:"10px 12px",borderRadius:8,
                      background: esAlerta ? "#F8717108" : "var(--surface2)",
                      border: `0.5px solid ${esAlerta?"#F8717140":"var(--border)"}`,
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{display:"flex",gap:12,flexShrink:0}}>
                          {[["si","Sí",true],["no","No",false]].map(([v,l,val])=>(
                            <label key={v} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:13}}>
                              <input type="radio"
                                checked={resp===val}
                                onChange={()=>setCuestionarioPre(p=>({...p,[q.key]:val}))}
                                style={{accentColor: val?"#F87171":"#10B981"}}/>
                              <span style={{fontWeight:resp===val?700:400,color:resp===val?(val?"#F87171":"#10B981"):"var(--text2)"}}>{l}</span>
                            </label>
                          ))}
                        </div>
                        <span style={{fontSize:13,color:"var(--text)",flex:1}}>{q.label}</span>
                        {i+1 === CUESTIONARIO_PRE.length && <span style={{fontSize:10,color:"var(--text3)"}}>(Sí = normal)</span>}
                      </div>
                      {esAlerta && (
                        <div style={{marginTop:6,fontSize:11,color:"#F87171",fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
                          ⚠ {q.accion}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Alerta general */}
                {hayAlertaPre && (
                  <div style={{marginTop:10,padding:"12px 14px",background:"#F8717110",border:"1px solid #F8717140",borderRadius:10}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#F87171",marginBottom:4}}>⚠ Alerta de seguridad</div>
                    <div style={{fontSize:12,color:"#F87171"}}>
                      El paciente tiene respuestas que requieren evaluación médica antes de ingresar a cámara.
                      Llamar al médico on-call antes de proceder.
                    </div>
                  </div>
                )}
              </div>

              {/* Sección C — Signos vitales pre */}
              <div>
                <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
                  C. Signos vitales pre-sesión — Antes de ingresar a cámara
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  {[
                    {key:"presion_arterial_pre", label:"Presión arterial", placeholder:"120/80", type:"text"},
                    {key:"frecuencia_cardiaca",  label:"Frec. cardíaca (bpm)", placeholder:"72", type:"number"},
                    {key:"saturacion_o2_pre",    label:"Saturación O₂ (%)", placeholder:"98", type:"number"},
                    {key:"temperatura",          label:"Temperatura (°C)", placeholder:"36.5", type:"number"},
                    {key:"peso",                 label:"Peso (kg)", placeholder:"70", type:"number"},
                    {key:"nivel_dolor",          label:"Dolor (0–10)", placeholder:"0", type:"number"},
                  ].map(f=>{
                    // Determinar si el valor está fuera de rango
                    const val = signosPre[f.key];
                    let enAlerta = false;
                    if(val) {
                      if(f.key === "frecuencia_cardiaca") enAlerta = Number(val) < 60 || Number(val) > 100;
                      if(f.key === "saturacion_o2_pre")   enAlerta = Number(val) < 94;
                      if(f.key === "temperatura")          enAlerta = Number(val) < 36.0 || Number(val) > 37.5;
                      if(f.key === "nivel_dolor")          enAlerta = Number(val) > 5;
                      if(f.key === "presion_arterial_pre") {
                        const p = val.split("/");
                        if(p.length===2) enAlerta = Number(p[0])<90||Number(p[0])>140||Number(p[1])<60||Number(p[1])>90;
                      }
                    }
                    return (
                    <div key={f.key}>
                      <label style={{fontSize:11,color:enAlerta?"#F59E0B":"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>
                        {f.label}{enAlerta && " ⚠"}
                      </label>
                      <input type={f.type} value={signosPre[f.key]||""} placeholder={f.placeholder}
                        onChange={e=>setSignosPre(p=>({...p,[f.key]:e.target.value}))}
                        style={{width:"100%",background:"var(--surface2)",
                          border:`0.5px solid ${enAlerta?"#F59E0B":"var(--border)"}`,
                          borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      {enAlerta && <div style={{fontSize:10,color:"#F59E0B",marginTop:2}}>Fuera de rango — llamar al médico</div>}
                    </div>
                    );
                  })}
                </div>
                <div style={{marginTop:8,fontSize:11,color:"var(--text3)",padding:"6px 10px",background:"var(--surface2)",borderRadius:6}}>
                  Rangos normales: PA 90/60–140/90 · FC 60–100 lpm · SatO₂ ≥94% · T° ≤37.5°C
                </div>
              </div>
            </div>

            {/* Footer */}
            {errIniciar && (
              <div style={{margin:"0 20px 8px",padding:"8px 12px",background:"#F8717115",border:"1px solid #F8717140",borderRadius:8,fontSize:12,color:"#F87171"}}>
                {errIniciar}
              </div>
            )}
            <div style={{padding:"12px 20px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{fontSize:11,color:"var(--text3)"}}>
                {Object.keys(cuestionarioPre).length}/7 preguntas respondidas
              </div>
              <div style={{display:"flex",gap:8}}>
                <Btn variant="ghost" onClick={()=>setModalIniciar(null)}>Cancelar</Btn>
                <Btn onClick={confirmarIniciar} disabled={savingIniciar||Object.keys(cuestionarioPre).length<7}
                  style={{background: hayAlertaPre?"#F59E0B":"#00A896"}}>
                  {savingIniciar ? "Iniciando..." : hayAlertaPre ? "⚠ Iniciar con alerta" : "▶ Iniciar sesión"}
                </Btn>
              </div>
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
      <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12,paddingTop:20,borderTop:"0.5px solid #E2E8F0"}}>
        Mis observaciones registradas
      </div>
      {obs.map(o=>(
        <div key={o.id} style={{
          background:"var(--bg)",border:"0.5px solid var(--border)",
          borderLeft:`3px solid ${ESTADO_COLOR[o.estado]}`,
          borderRadius:12,padding:"12px 16px",marginBottom:8,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={{fontSize:14}}>{ESTADO_ICON[o.estado]}</span>
                <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>
                  {o.pacientes?.nombres} {o.pacientes?.apellidos}
                </span>
                <span style={{fontSize:11,color:"var(--text3)"}}>
                  · {new Date(o.created_at).toLocaleDateString("es-PE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}
                </span>
              </div>
              <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.5,marginBottom:o.respuesta?8:0}}>
                {o.mensaje.length>100 ? o.mensaje.slice(0,100)+"..." : o.mensaje}
              </div>
              {o.respuesta && (
                <div style={{background:"#10B98115",border:"1px solid #10B98130",borderRadius:8,padding:"8px 12px",marginTop:6}}>
                  <div style={{fontSize:10,color:"#10B981",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Respuesta médica</div>
                  <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{o.respuesta}</div>
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

  const PRIORIDAD_COLOR = { alta:"#F87171", media:"#F59E0B", baja:"var(--text3)" };
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
      if(!f.esAdmin && !f.esMedicoEsp && perfil?.sede_id) q = q.eq("sede_id", perfil.sede_id);
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
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:4}}>
            Alertas Clínicas
          </h1>
          <p style={{color:"var(--text3)",fontSize:14}}>
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
          <Card key={i} style={{minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}</div>
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
              borderColor:filtroEstado===f.id?"#00A896":"var(--border)",
              background:filtroEstado===f.id?"#F0FDFB":"none",
              color:filtroEstado===f.id?"#00A896":"var(--text3)"}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de alertas */}
      {loading
        ? <div style={{color:"var(--text3)",padding:20}}>Cargando alertas...</div>
        : alertasFiltradas.length === 0
          ? <Card style={{textAlign:"center",padding:"50px"}}>
              <div style={{fontSize:36,marginBottom:12,opacity:.3}}>🔔</div>
              <div style={{color:"var(--text3)"}}>No hay alertas {filtroEstado === "pendientes" ? "pendientes" : ""}</div>
            </Card>
          : alertasFiltradas.map(alerta => (
            <div key={alerta.id}
              onClick={()=>abrirAlerta(alerta)}
              style={{
                background:"var(--surface)",
                border:`0.5px solid ${alerta.estado==="nueva"?"#F8717140":"var(--border)"}`,
                borderLeft:`3px solid ${PRIORIDAD_COLOR[alerta.prioridad]}`,
                borderRadius:12, padding:"14px 18px", marginBottom:8,
                cursor:"pointer", transition:"border-color .2s",
                display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:16,
              }}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#00C4B440"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=alerta.estado==="nueva"?"#F8717140":"var(--border)"}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Badge color={PRIORIDAD_COLOR[alerta.prioridad]}>{alerta.prioridad}</Badge>
                  <span style={{fontSize:12,color:"var(--text3)"}}>{TIPO_LABEL[alerta.tipo]}</span>
                  {alerta.estado==="nueva" && (
                    <span style={{background:"#F87171",color:"white",borderRadius:99,fontSize:10,fontWeight:700,padding:"1px 8px"}}>NUEVA</span>
                  )}
                </div>
                <div style={{fontWeight:600,fontSize:14,color:"var(--text)",marginBottom:4}}>
                  {alerta.pacientes?.nombres} {alerta.pacientes?.apellidos}
                  <span style={{fontWeight:400,color:"var(--text3)",fontSize:12,marginLeft:8}}>DNI {alerta.pacientes?.dni}</span>
                </div>
                <div style={{fontSize:13,color:"var(--text2)",marginBottom:4,lineHeight:1.5}}>
                  {alerta.mensaje.length > 120 ? alerta.mensaje.slice(0,120)+"..." : alerta.mensaje}
                </div>
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  {alerta.sedes?.nombre} · {fmtFecha(alerta.created_at)}
                  {alerta.generada_por_perfil?.nombre && ` · Por: ${alerta.generada_por_perfil.nombre}`}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                <Badge color={ESTADO_COLOR[alerta.estado]}>{alerta.estado}</Badge>
                {alerta.respondida_por_perfil?.nombre && (
                  <div style={{fontSize:11,color:"var(--text3)"}}>✓ {alerta.respondida_por_perfil.nombre}</div>
                )}
              </div>
            </div>
          ))
      }

      {/* Modal ver/responder alerta */}
      {verAlerta && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:580,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            {/* Header modal */}
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Badge color={PRIORIDAD_COLOR[verAlerta.prioridad]}>{verAlerta.prioridad}</Badge>
                  <Badge color={ESTADO_COLOR[verAlerta.estado]}>{verAlerta.estado}</Badge>
                  <span style={{fontSize:12,color:"var(--text3)"}}>{TIPO_LABEL[verAlerta.tipo]}</span>
                </div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>
                  {verAlerta.pacientes?.nombres} {verAlerta.pacientes?.apellidos}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>
                  DNI {verAlerta.pacientes?.dni} · {verAlerta.sedes?.nombre} · {fmtFecha(verAlerta.created_at)}
                </div>
              </div>
              <button onClick={()=>setVerAlerta(null)}
                style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {/* Mensaje original */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:11,color:"#00A896",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                  Observación registrada
                </div>
                <div style={{background:"var(--surface)",borderRadius:10,padding:"14px 16px",fontSize:14,color:"var(--text)",lineHeight:1.6}}>
                  {verAlerta.mensaje}
                </div>
                {verAlerta.generada_por_perfil?.nombre && (
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
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
                  <div style={{background:"#10B98115",border:"1px solid #10B98130",borderRadius:10,padding:"14px 16px",fontSize:14,color:"var(--text)",lineHeight:1.6}}>
                    {verAlerta.respuesta}
                  </div>
                  {verAlerta.respondida_por_perfil?.nombre && (
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
                      Respondida por: {verAlerta.respondida_por_perfil.nombre} · {fmtFecha(verAlerta.respondida_at)}
                    </div>
                  )}
                </div>
              )}

              {/* Botón Meet/Zoom — solo especialista */}
              {f.esMedicoEsp && (
                <div style={{marginBottom:20,padding:"12px 16px",background:"var(--surface2)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>Consulta por videollamada</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>Coordinar sesión con el médico de sede</div>
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
                    style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}
                  />
                </div>
              )}
            </div>

            {/* Footer modal */}
            <div style={{padding:"14px 24px",borderTop:"0.5px solid #E2E8F0",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div style={{fontSize:12,color:"var(--text3)"}}>
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
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:500,padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Nueva Alerta Clínica</div>
              <button onClick={()=>setModalNueva(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
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
              <label style={{fontSize:12,color:errNueva.mensaje?"#F87171":"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>
                Mensaje <span style={{color:"#F87171"}}>*</span>
              </label>
              <textarea value={formNueva.mensaje}
                onChange={e=>setFormNueva(f=>({...f,mensaje:e.target.value}))}
                placeholder="Describe la observación o consulta clínica..."
                rows={4}
                style={{width:"100%",background:"var(--surface2)",border:`1px solid ${errNueva.mensaje?"#F87171":"var(--border)"}`,borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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

// ── PROSPECTOS ────────────────────────────────────────────────
function Prospectos({perfil}) {
  const f = getRolFlags(perfil);
  const CANALES = ["whatsapp","instagram","facebook","referido","google","tiktok","otro"];
  // "convertido" no aparece en dropdown — solo se activa via flujo de conversión con DNI
  const ESTADOS = ["nuevo","contactado","evaluacion_agendada","perdido"];
  const ESTADO_LABEL = {
    nuevo:"Nuevo", contactado:"Contactado",
    evaluacion_agendada:"Eval. Agendada", convertido:"Convertido", perdido:"Perdido"
  };
  const ESTADO_COLOR = {
    nuevo:"#7C6AF7", contactado:"#00A896",
    evaluacion_agendada:"#F59E0B", convertido:"#10B981", perdido:"#F87171"
  };
  const CANAL_LABEL = {
    whatsapp:"WhatsApp", instagram:"Instagram", facebook:"Facebook",
    referido:"Referido", google:"Google", tiktok:"TikTok", otro:"Otro"
  };

  const [prospectos, setProspectos] = useState([]);
  const [sedes, setSedes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [modal, setModal]           = useState(false);
  const [modalVer, setModalVer]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState({});
  const [editFecha, setEditFecha]   = useState("");
  const [savingFecha, setSavingFecha] = useState(false);
  const [convirtiendo, setConvirtiendo] = useState(false);
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertForm, setConvertForm] = useState({nombres:"", apellidos:"", dni:""});
  const [convertErr, setConvertErr] = useState({});
  const [notaTimeline, setNotaTimeline] = useState("");
  const [tipoNota, setTipoNota] = useState("nota");
  const [actividades, setActividades] = useState([]);
  const [loadingAct, setLoadingAct] = useState(false);

  // Formatear fecha UTC → datetime-local (Lima UTC-5)
  const toLocalInput = (iso) => {
    if(!iso) return "";
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,16);
  };

  const guardarFecha = async () => {
    setSavingFecha(true);
    const { error } = await safeQuery(() =>
      supabase.from("prospectos").update({
        fecha_cita: editFecha ? new Date(editFecha).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", modalVer.id), "Prospectos:updateFecha"
    );
    setSavingFecha(false);
    if(!error){
      setModalVer(p=>({...p, fecha_cita: editFecha ? new Date(editFecha).toISOString() : null}));
      load();
    }
  };

  const formInicial = {
    nombre:"", telefono:"", email:"", canal:"whatsapp",
    sede_id:"", motivo:"", notas:"", estado:"nuevo", fecha_cita:""
  };
  const [form, setForm] = useState(formInicial);

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: s }] = await Promise.all([
      safeQuery(() => {
        let q = supabase.from("prospectos")
          .select("*, sedes(nombre)")
          .order("created_at", {ascending:false});
        // Enfermeros y admin_sede solo ven prospectos de su sede
        if((f.esEnfermero || f.esAdminSede) && perfil.sede_id) {
          q = q.eq("sede_id", perfil.sede_id);
        }
        return q;
      }, "Prospectos:load"),
      safeQuery(() => supabase.from("sedes").select("id,nombre"), "Prospectos:sedes"),
    ]);
    setProspectos(p || []);
    setSedes(s || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const guardar = async () => {
    const e = {};
    if(!form.nombre.trim())    e.nombre    = "Requerido";
    if(!form.telefono.trim())  e.telefono  = "Requerido";
    if(!form.canal)            e.canal     = "Requerido";
    if(Object.keys(e).length){ setErr(e); return; }
    setSaving(true);
    const { error } = await safeQuery(() =>
      supabase.from("prospectos").insert({
        nombre: form.nombre?.trim() || ((form.nombres||"")+" "+(form.apellidos||"")).trim(),
        nombres: (form.nombres||"").trim() || null,
        apellidos: (form.apellidos||"").trim() || null,
        telefono: form.telefono.trim(),
        email: form.email.trim() || null,
        canal: form.canal,
        sede_id: form.sede_id || null,
        motivo: form.motivo.trim() || null,
        notas: form.notas.trim() || null,
        estado: form.estado,
        fecha_ultimo_contacto: new Date().toISOString(),
        fecha_cita: form.fecha_cita ? new Date(form.fecha_cita).toISOString() : null,
      }), "Prospectos:insert"
    );
    setSaving(false);
    if(error){ setErr({general:"Error al guardar"}); return; }
    setModal(false);
    setForm(formInicial);
    setErr({});
    load();
  };

  const abrirConvertForm = () => {
    // Usar nombres/apellidos separados si existen, sino parsear nombre completo
    let nombres = "", apellidos = "";
    if(modalVer.nombres && modalVer.apellidos) {
      nombres = modalVer.nombres;
      apellidos = modalVer.apellidos;
    } else {
      const partes = (modalVer.nombre||"").trim().split(" ");
      if(partes.length === 1) { nombres = partes[0]; apellidos = ""; }
      else if(partes.length === 2) { nombres = partes[0]; apellidos = partes[1]; }
      else if(partes.length === 3) { nombres = partes[0]; apellidos = partes.slice(1).join(" "); }
      else { nombres = partes.slice(0,2).join(" "); apellidos = partes.slice(2).join(" "); }
    }
    setConvertForm({nombres, apellidos, dni:""});
    setConvertErr({});
    setShowConvertForm(true);
  };

  const convertirAPaciente = async () => {
    const e = {};
    if(!convertForm.nombres.trim())  e.nombres  = "Requerido";
    if(!convertForm.apellidos.trim()) e.apellidos = "Requerido";
    if(!convertForm.dni.trim())      e.dni      = "DNI obligatorio";
    else if(!/^\d{8}$/.test(convertForm.dni.trim())) e.dni = "DNI debe tener 8 dígitos";
    if(Object.keys(e).length){ setConvertErr(e); return; }

    setConvirtiendo(true);
    const { data: pac, error } = await safeQuery(() =>
      supabase.from("pacientes").insert({
        nombres:           convertForm.nombres.trim(),
        apellidos:         convertForm.apellidos.trim(),
        dni:               convertForm.dni.trim(),
        telefono:          modalVer.telefono || "",
        email:             modalVer.email || "",
        sede_principal_id: modalVer.sede_id || null,
        canal_origen:      modalVer.canal || "otro",
        estado:            "activo",
      }).select().single(), "Prospectos:convertir"
    );

    let pacienteId = pac?.id;

    if(error || !pac) {
      // Si el error es DNI duplicado, buscar el paciente existente y vincularlo
      if(error?.code === "23505") {
        const { data: pacExistente } = await safeQuery(() =>
          supabase.from("pacientes").select("id").eq("dni", convertForm.dni.trim()).single(),
          "Prospectos:buscarDuplicado"
        );
        if(pacExistente?.id) {
          pacienteId = pacExistente.id;
        } else {
          setConvertErr({general: "El DNI ya está registrado pero no se pudo vincular. Contacta al administrador."});
          setConvirtiendo(false);
          return;
        }
      } else {
        setConvertErr({general: "Error al crear el paciente. Verificá que el DNI no esté duplicado."});
        setConvirtiendo(false);
        return;
      }
    }

    // Crear HC maestra vacía y vincular sede (solo si no existe ya)
    await safeQuery(() =>
      supabase.from("historias_clinicas").insert({
        paciente_id:          pacienteId,
        sede_apertura_id:     modalVer.sede_id || null,
        diagnostico_principal: modalVer.motivo || "",
      }), "Prospectos:crearHC"
    );
    await safeQuery(() =>
      supabase.from("paciente_sedes").upsert({
        paciente_id: pacienteId,
        sede_id:     modalVer.sede_id || null,
      }, { onConflict: "paciente_id,sede_id", ignoreDuplicates: true }), "Prospectos:pacienteSede"
    );

    await safeQuery(() =>
      supabase.from("prospectos").update({
        estado: "convertido",
        convertido_paciente_id: pacienteId,
        updated_at: new Date().toISOString(),
      }).eq("id", modalVer.id), "Prospectos:vincular"
    );

    setConvirtiendo(false);
    setShowConvertForm(false);
    setModalVer(null);
    load();
    alert(`${convertForm.nombres} ${convertForm.apellidos} fue vinculado como paciente. Ya podes agendar sus sesiones.`);
  };

  // Cargar actividades del prospecto
  const cargarActividades = async (prospectoId) => {
    setLoadingAct(true);
    const { data } = await safeQuery(
      () => supabase.from("prospectos_actividad")
        .select("*")
        .eq("prospecto_id", prospectoId)
        .order("created_at", {ascending: false})
        .limit(20),
      "Prospectos:actividades"
    );
    setActividades(data || []);
    setLoadingAct(false);
  };

  // Guardar actividad
  const guardarActividad = async (prospectoId, tipo, descripcion) => {
    if(!descripcion.trim()) return;
    const nueva = {
      prospecto_id: prospectoId,
      tipo,
      descripcion: descripcion.trim(),
      usuario_id: perfil?.id || null,
      usuario_nombre: perfil?.nombre || "Usuario",
    };
    await safeQuery(
      () => supabase.from("prospectos_actividad").insert(nueva),
      "Prospectos:insertActividad"
    );
    setActividades(prev => [{...nueva, created_at: new Date().toISOString(), id: Date.now()}, ...prev]);
  };

  const cambiarEstado = async (id, nuevoEstado) => {
    await safeQuery(() =>
      supabase.from("prospectos").update({
        estado: nuevoEstado,
        fecha_ultimo_contacto: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id), "Prospectos:update"
    );
    // Registrar en actividad
    guardarActividad(id, "cambio_estado", `Estado: ${ESTADO_LABEL[nuevoEstado]||nuevoEstado}`);
    load();
    if(modalVer?.id === id) setModalVer(p => ({...p, estado: nuevoEstado}));
  };

  const prospectosFiltrados = filtroEstado === "todos"
    ? prospectos
    : prospectos.filter(p => p.estado === filtroEstado);

  // KPIs
  const kpis = [
    { label:"Total",        val: prospectos.length,                                          color:"#7C6AF7" },
    { label:"Nuevos",       val: prospectos.filter(p=>p.estado==="nuevo").length,             color:"#00A896" },
    { label:"En seguimiento", val: prospectos.filter(p=>["contactado","evaluacion_agendada"].includes(p.estado)).length, color:"#F59E0B" },
    { label:"Convertidos",  val: prospectos.filter(p=>p.estado==="convertido").length,        color:"#10B981" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:4}}>Prospectos</h1>
          <p style={{color:"var(--text3)",fontSize:13}}>Gestión de leads y seguimiento comercial</p>
        </div>
        <Btn onClick={()=>{ setForm(formInicial); setErr({}); setModal(true); }}>+ Nuevo prospecto</Btn>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
        {kpis.map((k,i)=>(
          <Card key={i} style={{minHeight:80,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:26,fontWeight:700,color:k.color,marginTop:6}}>
              {k.val === 0 ? <span style={{color:"var(--border2)"}}>—</span> : k.val}
            </div>
          </Card>
        ))}
      </div>

      {/* Filtros de estado */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[{id:"todos",label:"Todos"},...ESTADOS.map(e=>({id:e,label:ESTADO_LABEL[e]}))].map(e=>(
          <button key={e.id} onClick={()=>setFiltroEstado(e.id)}
            style={{padding:"5px 14px",borderRadius:20,border:"0.5px solid",fontSize:12,fontWeight:600,cursor:"pointer",
              borderColor: filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"#00A896") : "var(--border)",
              background:  filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"#00A896")+"15" : "none",
              color:       filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"#00A896") : "var(--text3)"}}>
            {e.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}><Spinner/></div> : (
        <Card style={{padding:0,overflow:"hidden"}}>
          {prospectosFiltrados.length === 0 ? (
            <div style={{padding:"50px 20px",textAlign:"center",color:"var(--text3)",fontSize:14}}>
              No hay prospectos {filtroEstado !== "todos" ? `con estado "${ESTADO_LABEL[filtroEstado]}"` : "registrados aún"}
            </div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"var(--surface2)"}}>
                  {["Nombre","Teléfono","Canal","Sede","Motivo","Estado","Último contacto",""].map(h=>(
                    <th key={h} style={{padding:"10px 14px",fontSize:11,fontWeight:600,color:"var(--text3)",textAlign:"left"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prospectosFiltrados.map(p=>(
                  <tr key={p.id} style={{borderTop:"0.5px solid var(--border)"}}>
                    <td style={{padding:"11px 14px"}}>
                      <div style={{fontWeight:600,color:"var(--text)",fontSize:13}}>{p.nombre}</div>
                      {p.email && <div style={{fontSize:11,color:"var(--text3)"}}>{p.email}</div>}
                    </td>
                    <td style={{padding:"11px 14px",fontSize:13,color:"var(--text2)"}}>{p.telefono}</td>
                    <td style={{padding:"11px 14px"}}>
                      <span style={{fontSize:11,fontWeight:600,color:"var(--text2)",background:"var(--surface2)",padding:"2px 8px",borderRadius:20,border:"0.5px solid var(--border)"}}>
                        {CANAL_LABEL[p.canal]||p.canal}
                      </span>
                    </td>
                    <td style={{padding:"11px 14px",fontSize:12,color:"var(--text3)"}}>{p.sedes?.nombre||"—"}</td>
                    <td style={{padding:"11px 14px",fontSize:12,color:"var(--text2)",maxWidth:180}}>
                      <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.motivo||"—"}</div>
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      {p.estado === "convertido" ? (
                        <span style={{background:"#10B98115",border:"0.5px solid #10B981",
                          color:"#10B981",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>
                          Convertido ✓
                        </span>
                      ) : (
                      <select value={p.estado} onChange={e=>cambiarEstado(p.id, e.target.value)}
                        style={{background:ESTADO_COLOR[p.estado]+"15",border:`0.5px solid ${ESTADO_COLOR[p.estado]}`,
                          color:ESTADO_COLOR[p.estado],borderRadius:20,padding:"3px 10px",fontSize:11,
                          fontWeight:600,cursor:"pointer",fontFamily:"inherit",outline:"none"}}>
                        {ESTADOS.map(e=>(
                          <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
                        ))}
                      </select>
                      )}
                    </td>
                    <td style={{padding:"11px 14px",fontSize:11,color:"var(--text3)"}}>
                      {p.estado === "evaluacion_agendada" && p.fecha_cita
                        ? <span style={{color:"#F59E0B",fontWeight:600}}>
                            📅 {new Date(p.fecha_cita).toLocaleDateString("es-PE",{timeZone:"America/Lima"})} {new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Lima"})}
                          </span>
                        : p.fecha_ultimo_contacto ? new Date(p.fecha_ultimo_contacto).toLocaleDateString("es-PE") : "—"}
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      <button onClick={()=>{ setModalVer(p); setEditFecha(p.fecha_cita ? toLocalInput(p.fecha_cita) : ""); cargarActividades(p.id); }}
                        style={{background:"none",border:"none",color:"#00A896",cursor:"pointer",fontSize:12,fontWeight:600}}>
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Modal Nuevo Prospecto */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:480,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.15)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Nuevo Prospecto</div>
              <button onClick={()=>setModal(false)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
              <Input label="Nombres (ej: JUAN CARLOS)" placeholder="Solo nombres propios" value={form.nombres||""} onChange={v=>setForm(f=>({...f,nombres:v.toUpperCase(),nombre:(v.toUpperCase()+" "+(f.apellidos||"")).trim()}))} required error={err.nombre}/>
              <Input label="Apellidos (ej: GARCIA LOPEZ)" placeholder="Apellido paterno + materno" value={form.apellidos||""} onChange={v=>setForm(f=>({...f,apellidos:v.toUpperCase(),nombre:((f.nombres||"")+" "+v.toUpperCase()).trim()}))} required/>
            </div>
            <Input label="Teléfono" value={form.telefono} onChange={v=>setForm(f=>({...f,telefono:v}))} required error={err.telefono}/>
            <Input label="Email (opcional)" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))}/>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Select label="Canal de origen" value={form.canal} onChange={v=>setForm(f=>({...f,canal:v}))} required
                options={CANALES.map(c=>({value:c,label:CANAL_LABEL[c]}))}/>
              <Select label="Sede de interés" value={form.sede_id} onChange={v=>setForm(f=>({...f,sede_id:v}))}
                options={[{value:"",label:"Sin preferencia"},...sedes.map(s=>({value:s.id,label:s.nombre}))]}/>
            </div>

            <Select label="Estado inicial" value={form.estado} onChange={v=>setForm(f=>({...f,estado:v}))}
              options={ESTADOS.map(e=>({value:e,label:ESTADO_LABEL[e]}))}/>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Motivo de consulta</label>
              <textarea value={form.motivo} onChange={e=>setForm(f=>({...f,motivo:e.target.value}))}
                placeholder="Diagnóstico, condición, motivo por el que busca HBOT..."
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",
                  outline:"none",resize:"vertical",minHeight:70,boxSizing:"border-box"}}/>
            </div>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Notas internas</label>
              <textarea value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))}
                placeholder="Observaciones del primer contacto, disponibilidad, etc."
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:10,
                  color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",
                  outline:"none",resize:"vertical",minHeight:60,boxSizing:"border-box"}}/>
            </div>

            {/* Fecha y hora de cita — solo si estado es evaluacion_agendada */}
            {(form.estado === "evaluacion_agendada" || form.fecha_cita) && (
              <div style={{marginBottom:18,padding:"12px 14px",background:"#F59E0B10",border:"0.5px solid #F59E0B40",borderRadius:10}}>
                <label style={{fontSize:12,color:"#F59E0B",fontWeight:600,display:"block",marginBottom:8}}>
                  📅 Fecha y hora de evaluación
                </label>
                <input type="datetime-local" value={form.fecha_cita}
                  onChange={e=>setForm(f=>({...f,fecha_cita:e.target.value}))}
                  style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,
                    color:"var(--text)",padding:"9px 12px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
              </div>
            )}

            {err.general && <div style={{color:"#F87171",fontSize:13,marginBottom:12}}>{err.general}</div>}

            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
              <Btn onClick={guardar} disabled={saving}>{saving?"Guardando...":"Registrar prospecto"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ver Prospecto */}
      {modalVer && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:480,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>{modalVer.nombre}</div>
              <button onClick={()=>setModalVer(null)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[
                ["Teléfono", modalVer.telefono],
                ["Email", modalVer.email||"—"],
                ["Canal", CANAL_LABEL[modalVer.canal]||modalVer.canal],
                ["Sede", modalVer.sedes?.nombre||"Sin preferencia"],
                ["Estado", ESTADO_LABEL[modalVer.estado]],
                ["Registrado", new Date(modalVer.created_at).toLocaleDateString("es-PE")],

              ].map(([k,v])=>(
                <div key={k} style={{background:"var(--surface2)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginBottom:3}}>{k}</div>
                  <div style={{fontSize:13,color:"var(--text)",fontWeight:500}}>{v}</div>
                </div>
              ))}
            </div>

            {modalVer.motivo && (
              <div style={{background:"var(--surface2)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginBottom:3}}>Motivo de consulta</div>
                <div style={{fontSize:13,color:"var(--text)"}}>{modalVer.motivo}</div>
              </div>
            )}
            {modalVer.notas && (
              <div style={{background:"var(--surface2)",borderRadius:8,padding:"10px 12px",marginBottom:16}}>
                <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginBottom:3}}>Notas internas</div>
                <div style={{fontSize:13,color:"var(--text)"}}>{modalVer.notas}</div>
              </div>
            )}

            {/* Campo editable fecha/hora cita */}
            <div style={{marginBottom:16,padding:"12px 14px",background:"#F59E0B10",border:"0.5px solid #F59E0B40",borderRadius:10}}>
              <div style={{fontSize:12,color:"#F59E0B",fontWeight:600,marginBottom:8}}>📅 Fecha y hora de evaluación</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="datetime-local" value={editFecha}
                  onChange={e=>setEditFecha(e.target.value)}
                  style={{flex:1,background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,
                    color:"var(--text)",padding:"8px 12px",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                <Btn onClick={guardarFecha} disabled={savingFecha} style={{padding:"8px 14px",fontSize:12}}>
                  {savingFecha ? "..." : "Guardar"}
                </Btn>
              </div>
              {editFecha && <div style={{fontSize:11,color:"#F59E0B",marginTop:6}}>
                {new Date(editFecha).toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long"})} a las {new Date(editFecha).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"})}
              </div>}
            </div>

            <div style={{marginBottom:16}}>
              {/* ── TIMELINE DE ACTIVIDAD ── */}
              <div style={{marginBottom:16,border:"0.5px solid var(--border)",borderRadius:10,overflow:"hidden"}}>
                <div style={{background:"var(--surface2)",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>Actividad</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{actividades.length} registros</div>
                </div>
                <div style={{maxHeight:200,overflowY:"auto"}}>
                  {loadingAct ? (
                    <div style={{padding:"12px 14px",fontSize:12,color:"var(--text3)"}}>Cargando...</div>
                  ) : actividades.length === 0 ? (
                    <div style={{padding:"12px 14px",fontSize:12,color:"var(--text3)"}}>Sin actividad registrada aún</div>
                  ) : actividades.map((act,i) => {
                    const tipoColor = {cambio_estado:"#00A896",nota:"#6366F1",llamada:"#F59E0B",whatsapp:"#10B981",email:"#3B82F6",sistema:"#9CA3AF"}[act.tipo]||"#9CA3AF";
                    const tipoIcon = {cambio_estado:"↻",nota:"✎",llamada:"☎",whatsapp:"💬",email:"✉",sistema:"⚙"}[act.tipo]||"●";
                    return (
                      <div key={act.id||i} style={{padding:"8px 14px",borderBottom:i<actividades.length-1?"0.5px solid var(--border)":"none",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:tipoColor+"20",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                          <span style={{fontSize:10,color:tipoColor}}>{tipoIcon}</span>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:"var(--text)",fontWeight:500}}>{act.descripcion}</div>
                          <div style={{fontSize:10,color:"var(--text3)",marginTop:2,display:"flex",gap:8}}>
                            <span>{act.usuario_nombre||"Sistema"}</span>
                            <span>·</span>
                            <span>{act.created_at ? new Date(act.created_at).toLocaleDateString("es-PE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : ""}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{padding:"10px 14px",borderTop:"0.5px solid var(--border)"}}>
                  <div style={{display:"flex",gap:6,marginBottom:8}}>
                    {[["nota","✎ Nota"],["llamada","☎ Llamada"],["whatsapp","💬 WhatsApp"]].map(([tipo,label])=>(
                      <button key={tipo} onClick={()=>setTipoNota(tipo)}
                        style={{fontSize:11,padding:"3px 10px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",
                          border:`0.5px solid ${tipoNota===tipo?"#6366F1":"var(--border)"}`,
                          background:tipoNota===tipo?"#6366F1":"var(--surface2)",
                          color:tipoNota===tipo?"white":"var(--text2)"}}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <input value={notaTimeline} onChange={e=>setNotaTimeline(e.target.value)}
                      placeholder={`Registrar ${tipoNota}...`}
                      style={{flex:1,background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:8,
                        color:"var(--text)",padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none"}}
                      onKeyDown={e=>{ if(e.key==="Enter"&&notaTimeline.trim()){guardarActividad(modalVer.id,tipoNota,notaTimeline);setNotaTimeline("");}}}/>
                    <button disabled={!notaTimeline.trim()}
                      onClick={()=>{if(!notaTimeline.trim())return;guardarActividad(modalVer.id,tipoNota,notaTimeline);setNotaTimeline("");}}
                      style={{background:"#6366F1",color:"white",border:"none",borderRadius:8,padding:"6px 12px",
                        fontSize:12,cursor:"pointer",fontFamily:"inherit",opacity:!notaTimeline.trim()?0.5:1}}>
                      Guardar
                    </button>
                  </div>
                </div>
              </div>

              <div style={{fontSize:12,color:"var(--text2)",fontWeight:600,marginBottom:8}}>Cambiar estado</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {ESTADOS.map(e=>(
                  <button key={e} onClick={()=>cambiarEstado(modalVer.id, e)}
                    style={{padding:"5px 12px",borderRadius:20,border:`0.5px solid ${ESTADO_COLOR[e]}`,
                      background: modalVer.estado===e ? ESTADO_COLOR[e] : ESTADO_COLOR[e]+"15",
                      color: modalVer.estado===e ? "#fff" : ESTADO_COLOR[e],
                      fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    {ESTADO_LABEL[e]}
                  </button>
                ))}
              </div>
            </div>

            {/* Formulario inline de conversión */}
            {modalVer.estado !== "convertido" && !modalVer.convertido_paciente_id && (
              <div style={{marginTop:8}}>
                {!showConvertForm ? (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <Btn onClick={abrirConvertForm} style={{background:"#10B981",fontSize:13}}>
                      ✓ Convertir a paciente
                    </Btn>
                    <Btn variant="ghost" onClick={()=>setModalVer(null)}>Cerrar</Btn>
                  </div>
                ) : (
                  <div style={{background:"#10B98110",border:"0.5px solid #10B98140",borderRadius:10,padding:"14px 16px"}}>
                    <div style={{fontSize:12,color:"#10B981",fontWeight:700,marginBottom:12,letterSpacing:"0.04em",textTransform:"uppercase"}}>
                      Confirmar datos del paciente
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                      <div>
                        <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>Nombres *</label>
                        <input value={convertForm.nombres} onChange={e=>setConvertForm(f=>({...f,nombres:e.target.value}))}
                          style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${convertErr.nombres?"#F87171":"var(--border)"}`,
                            borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                        {convertErr.nombres && <div style={{fontSize:11,color:"#F87171",marginTop:2}}>{convertErr.nombres}</div>}
                      </div>
                      <div>
                        <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>Apellidos *</label>
                        <input value={convertForm.apellidos} onChange={e=>setConvertForm(f=>({...f,apellidos:e.target.value}))}
                          style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${convertErr.apellidos?"#F87171":"var(--border)"}`,
                            borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                        {convertErr.apellidos && <div style={{fontSize:11,color:"#F87171",marginTop:2}}>{convertErr.apellidos}</div>}
                      </div>
                    </div>
                    <div style={{marginBottom:12}}>
                      <label style={{fontSize:11,color:"var(--text3)",fontWeight:600,display:"block",marginBottom:4}}>DNI * (8 dígitos)</label>
                      <input value={convertForm.dni} onChange={e=>setConvertForm(f=>({...f,dni:e.target.value.replace(/\D/g,"").slice(0,8)}))}
                        placeholder="12345678" maxLength={8}
                        style={{width:"100%",background:"var(--surface)",border:`0.5px solid ${convertErr.dni?"#F87171":"var(--border)"}`,
                          borderRadius:8,color:"var(--text)",padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                      {convertErr.dni && <div style={{fontSize:11,color:"#F87171",marginTop:2}}>{convertErr.dni}</div>}
                    </div>
                    {convertErr.general && <div style={{fontSize:12,color:"#F87171",marginBottom:10}}>{convertErr.general}</div>}
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>setShowConvertForm(false)}
                        style={{background:"none",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"7px 14px",
                          borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                        Cancelar
                      </button>
                      <Btn onClick={convertirAPaciente} disabled={convirtiendo}
                        style={{background:"#10B981",fontSize:13}}>
                        {convirtiendo ? "Registrando..." : "Confirmar y crear paciente"}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
            {modalVer.convertido_paciente_id && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
                <span style={{fontSize:12,color:"#10B981",fontWeight:600}}>✓ Ya es paciente</span>
                <Btn variant="ghost" onClick={()=>setModalVer(null)}>Cerrar</Btn>
              </div>
            )}
            {modalVer.estado === "convertido" && !modalVer.convertido_paciente_id && (
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
                <Btn variant="ghost" onClick={()=>setModalVer(null)}>Cerrar</Btn>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user,          setUser]          = useState(null);
  const [alertasNuevas, setAlertasNuevas] = useState(0);
  const [perfil,  setPerfil]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState("dashboard");

  // Persistir vista al cambiar
  const cambiarVista = (v) => {
    localStorage.setItem("oxynatur-vista", v);
    setVista(v);
  };
  const [darkMode, setDarkMode] = useState(()=>localStorage.getItem("oxynatur-theme")==="dark");
  useEffect(()=>{
    localStorage.setItem("oxynatur-theme", darkMode ? "dark" : "light");
    let el = document.getElementById("oxynatur-theme-vars");
    if(!el){ el = document.createElement("style"); el.id="oxynatur-theme-vars"; document.head.appendChild(el); }
    if(darkMode){
      el.textContent = `:root{--bg:#0A0F1F;--surface:#0D1320;--surface2:#1A2035;--border:#2A3550;--border2:#374151;--text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8}`;
    } else {
      el.textContent = `:root{--bg:#F4F6FA;--surface:#FFFFFF;--surface2:#F8FAFC;--border:#E2E8F0;--border2:#CBD5E1;--text:#0F172A;--text2:#64748B;--text3:#94A3B8}`;
    }
  }, [darkMode]);

  useEffect(()=>{
    let mounted = true;
    let loadedUserId = null;
    let inFlightUserId = null;
    let vistaRestaurada = false;

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
      // FASE B: restaurar vista guardada solo la primera vez que carga
      const flags = getRolFlags(p);
      if(!vistaRestaurada) {
        vistaRestaurada = true;
        // Enfermeros siempre arrancan en sesiones — limpiar localStorage para no restaurar vista previa
        if(flags.esEnfermero) {
          localStorage.removeItem("oxynatur-vista");
          setVista("sesiones");
        // Admin sede siempre arranca en su dashboard
        } else if(flags.esAdminSede) {
          localStorage.removeItem("oxynatur-vista");
          setVista("dashboard_sede");
        } else {
          const saved = localStorage.getItem("oxynatur-vista");
          const vistaMap = {
            dashboard: flags.puedeVerDashboard,
            alertas:   flags.puedeVerAlertas,
            pacientes: true,
            ventas:    flags.puedeVerVentas,
            sesiones:  true,
            historias: true,
            finanzas:  flags.puedeVerFinanzas,
            sedes:     flags.puedeVerSedes,
            usuarios:  flags.puedeVerUsuarios,
            prospectos:flags.puedeVerProspectos,
            agenda:    true,
          };
          setVista(saved && vistaMap[saved] ? saved : flags.vistaDefault);
        }
      }
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
      case "prospectos": return f.puedeVerProspectos  ? <Prospectos perfil={perfil}/>  : null;
      case "agenda":    return                         <AgendaMedico perfil={perfil} cambiarVista={cambiarVista}/>;
      case "dashboard_sede": return f.puedeVerDashboardSede ? <DashboardSede perfil={perfil}/> : null;
      default:          return f.puedeVerDashboard   ? <DashboardAdmin/>              : <Pacientes perfil={perfil}/>;
    }
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"var(--bg)",minHeight:"100vh",color:"var(--text)",width:"100%"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:3px}select option{background:#1A2035}input::placeholder{color:#4B5563}textarea::placeholder{color:#94A3B8}textarea{box-sizing:border-box}`}</style>
      <div style={{display:"flex",minHeight:"100vh",width:"100%"}}>
        <Sidebar vista={vista} setVista={cambiarVista} perfil={perfil} onLogout={handleLogout} alertasNuevas={alertasNuevas} darkMode={darkMode} setDarkMode={setDarkMode}/>
        <div style={{flex:1,overflow:"auto",padding:"28px 40px",background:"var(--bg)"}}>
          {renderVista()}
        </div>
      </div>
    </div>
  );
}
