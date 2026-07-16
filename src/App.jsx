import { useState, useEffect, useMemo, createContext, useContext } from "react";
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
    `[Oxynatur] Faltan variables de entorno: ${faltantes}. ` +
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

// ── Helper formato hora 12h AM/PM ─────────────────────────────
const fmtHora = (hhmm) => {
  if(!hhmm) return "—";
  const [h,m] = hhmm.slice(0,5).split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
};


// ── Custom hooks ──────────────────────────────────────────────
// Debounce — evita queries en cada keystroke
const useDebounce = (value, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
};

// Esc — cierra modal al presionar Escape
const useEscClose = (isOpen, onClose) => {
  useEffect(() => {
    if(!isOpen) return;
    const handler = (e) => { if(e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);
};

// ── Helpers para queries de Supabase ──────────────────────────
async function safeQuery(queryFn, contexto = "query") {
  try {
    const result = await queryFn();
    if (result?.error) {
      // console.error(`[${contexto}] Error de Supabase:`, result.error);
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
const getColor = (nombre) => SEDE_COLOR[nombre] || "var(--accent)";

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


// Genera opciones de hora en formato 12h AM/PM — slots de 30 min
const HORA_OPTIONS = (() => {
  const opts = [];
  for(let h = 6; h <= 21; h++) {
    for(let m of [0, 30]) {
      if(h === 21 && m === 30) break;
      const val  = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      const ampm = h < 12 ? "am" : "pm";
      const h12  = h % 12 || 12;
      const label = `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
      opts.push({value: val, label});
    }
  }
  return opts;
})();

// ── Toast notification system ──────────────────────────────────────────────
let __toastFn = null;
const toast = {
  success: (msg) => __toastFn && __toastFn({msg, type:"success"}),
  error:   (msg) => __toastFn && __toastFn({msg, type:"error"}),
  info:    (msg) => __toastFn && __toastFn({msg, type:"info"}),
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);
  useEffect(()=>{
    __toastFn = ({msg, type}) => {
      const id = Date.now();
      setToasts(t => [...t.slice(-3), {id, msg, type}]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
    };
    return () => { __toastFn = null; };
  }, []);
  const colors = {
    success: {bg:"#10B981", icon:"✓"},
    error:   {bg:"#F87171", icon:"✕"},
    info:    {bg:"#7C6AF7", icon:"i"},
  };
  return (
    <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,display:"flex",flexDirection:"column",gap:8,pointerEvents:"none"}}>
      {toasts.map(t=>(
        <div key={t.id} style={{
          display:"flex",alignItems:"center",gap:10,
          background:"var(--surface)",border:"0.5px solid var(--border)",
          borderLeft:`3px solid ${colors[t.type].bg}`,
          borderRadius:"var(--radius-sm)",padding:"10px 16px",
          boxShadow:"0 4px 16px rgba(0,0,0,0.12)",
          fontSize:13,color:"var(--text)",fontWeight:500,
          minWidth:260,maxWidth:360,
          animation:"slideIn 0.2s ease",
          pointerEvents:"auto",
        }}>
          <span style={{
            width:20,height:20,borderRadius:"50%",
            background:colors[t.type].bg,color:"white",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:11,fontWeight:700,flexShrink:0,
          }}>{colors[t.type].icon}</span>
          <span style={{flex:1,lineHeight:1.4}}>{t.msg}</span>
        </div>
      ))}
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
};

const Badge = ({color, children, variant="default"}) => (
  <span style={{
    display:"inline-flex",alignItems:"center",padding:"2px 9px",borderRadius:99,
    fontSize:11,fontWeight:600,letterSpacing:"0.01em",
    background:color+"1A",color,border:`1px solid ${color}28`,
    lineHeight:"18px",
  }}>{children}</span>
);

const Card = ({children, style={}}) => (
  <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-md)",padding:22,boxShadow:"0 1px 2px rgba(0,0,0,0.03)",...style}}>{children}</div>
);

const Btn = ({children,onClick,variant="primary",disabled=false,style={}}) => {
  const styles = {
    primary: {background:"var(--accent)",color:"white",border:"none"},
    ghost:   {background:"transparent",color:"var(--text2)",border:"0.5px solid var(--border)"},
    danger:  {background:"#FEE2E220",color:"#DC2626",border:"0.5px solid #FECACA"},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{...styles[variant],padding:"9px 20px",borderRadius:"var(--radius-sm)",cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontSize:14,fontWeight:600,opacity:disabled?0.5:1,transition:"all .15s",...style}}>
      {children}
    </button>
  );
};

const Input = ({label,value,onChange,type="text",placeholder="",required=false,error=""}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:error?"#F87171":"var(--text2)",fontWeight:500,display:"block",marginBottom:5,letterSpacing:"0.01em"}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:"var(--surface2)",border:`0.5px solid ${error?"#F87171":"var(--border)"}`,borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",WebkitAppearance:"none",transition:"border-color .15s"}}/>
    {error && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{error}</div>}
  </div>
);

const Select = ({label,value,onChange,options=[],required=false}) => (
  <div style={{marginBottom:14}}>
    {label && <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5,letterSpacing:"0.01em"}}>{label}{required&&<span style={{color:"#F87171"}}> *</span>}</label>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:value?"var(--text)":"var(--text3)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",colorScheme:"light dark",transition:"border-color .15s"}}>
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
      <style>{`*{box-sizing:border-box;margin:0;padding:0}
:root,[data-theme="light"]{
  --bg:#F0F4F8;--surface:#FFFFFF;--surface2:#F7F9FC;--border:#E8EDF3;--border2:#CDD5DF;
  --text:#0D1829;--text2:#4A5568;--text3:#8A97A8;
  --accent:#00A896;--accent-light:rgba(0,168,150,0.10);--accent-mid:rgba(0,168,150,0.18);
  --radius-sm:8px;--radius-md:12px;--radius-lg:16px;
}
[data-theme="dark"]{
  --bg:#080E1A;--surface:#0E1525;--surface2:#162030;--border:#1E2D42;--border2:#2A3D56;
  --text:#EEF2F7;--text2:#8FA3BC;--text3:#5A7090;
  --accent:#00BFA8;--accent-light:rgba(0,191,168,0.12);--accent-mid:rgba(0,191,168,0.20);
}
input::placeholder{color:var(--text3)}
select option{background:var(--surface);color:var(--text)}
input::-ms-reveal,input::-ms-clear{display:none}
input::-webkit-credentials-auto-fill-button{display:none}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`}</style>
      <div style={{width:"100%",maxWidth:400,padding:20}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:72,height:72,borderRadius:20,background:"var(--accent)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16,boxShadow:"0 8px 24px rgba(0,168,150,0.25)"}}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:26,fontWeight:800,color:"var(--text)",letterSpacing:"-0.03em"}}>Oxynatur</div>
          <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>Sistema de Gestión Clínica</div>
        </div>
        <Card style={{padding:32}}>
          <div style={{fontSize:18,fontWeight:700,color:"var(--text)",marginBottom:6,fontFamily:"Syne,sans-serif"}}>Iniciar sesión</div>
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:24}}>Acceso autorizado al personal Oxynatur</div>
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
        <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"var(--border2)"}}>Oxynatur · Sistema Interno · Acceso Restringido</div>
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
    <div style={{width:218,background:"var(--surface)",borderRight:"0.5px solid var(--border)",padding:"0",display:"flex",flexDirection:"column",flexShrink:0,minHeight:"100vh"}}>
      {/* Logo area */}
      <div style={{padding:"20px 16px 16px",borderBottom:"0.5px solid var(--border)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:9,background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </div>
          <div>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:16,color:"var(--text)",letterSpacing:"-0.02em",lineHeight:1}}>Oxynatur</div>
            <div style={{fontSize:10,color:"var(--text3)",marginTop:2,letterSpacing:"0.04em",textTransform:"uppercase",fontWeight:500}}>{f.rolLabel}</div>
          </div>
        </div>
      </div>
      {/* Nav items */}
      <div style={{flex:1,padding:"10px 8px",display:"flex",flexDirection:"column",gap:1,overflowY:"auto"}}>
        {navItems.map(item=>(
          <button key={item.id} onClick={()=>setVista(item.id)}
            style={{
              background:vista===item.id?"var(--accent-light)":"transparent",
              border:"none",
              borderRadius:"var(--radius-sm)",
              cursor:"pointer",padding:"8px 10px",
              color:vista===item.id?"var(--accent)":"var(--text2)",
              fontFamily:"inherit",fontSize:13,
              fontWeight:vista===item.id?600:400,
              display:"flex",alignItems:"center",gap:9,
              width:"100%",textAlign:"left",transition:"all .12s",
            }}>
            <span style={{display:"flex",alignItems:"center",flexShrink:0,opacity:vista===item.id?1:0.6}}>{item.icon}</span>
            <span style={{flex:1}}>{item.label}</span>
            {item.badge && (
              <span style={{background:"#F87171",color:"white",borderRadius:99,fontSize:10,fontWeight:700,padding:"1px 6px",minWidth:18,textAlign:"center",lineHeight:"16px"}}>
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Footer */}
      <div style={{padding:"12px 12px 16px",borderTop:"0.5px solid var(--border)"}}>
        <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:"var(--accent-mid)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:12,fontWeight:700,color:"var(--accent)"}}>{(perfil?.nombre||"?")[0].toUpperCase()}</span>
          </div>
          <div style={{overflow:"hidden"}}>
            <div style={{fontSize:12,color:"var(--text)",fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{perfil?.nombre}</div>
            <div style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{perfil?.email}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={onLogout} style={{flex:1,background:"transparent",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 8px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:500}}>
            Salir
          </button>
          <button onClick={()=>setDarkMode(d=>!d)}
            style={{background:"transparent",border:"0.5px solid var(--border)",color:"var(--text3)",padding:"6px 8px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"inherit",fontSize:11,display:"flex",alignItems:"center",gap:4}}>
            {darkMode
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            }
          </button>
        </div>
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
  const ESTADO_COLOR    = {programada:"#F59E0B",en_curso:"var(--accent)",completada:"#10B981",cancelada:"#F87171"};

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
          {f.esMedicoEsp && <span style={{color:"var(--accent)",marginLeft:8}}>· Todas las sedes</span>}
        </p>
      </div>

      {/* KPIs clínicos */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Firmas pendientes",  val:firmasPend.length,  color: firmasPend.length>0?"#F59E0B":"#10B981"},
          {label:"Alertas pendientes", val:alertas.length,    color: alertas.length>0?"#F87171":"#10B981"},
          {label:"Sesiones hoy",       val:sesionesHoy.length, color:"var(--accent)"},
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
                        <span>{ev.fecha} {fmtHora(ev.hora)}</span>
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
            <div style={{fontSize:12,fontWeight:700,color:"var(--accent)",letterSpacing:"0.06em",textTransform:"uppercase"}}>⚡ Sesiones de hoy</div>
            <span style={{fontSize:12,color:"var(--text3)"}}>{sesCompletadas}/{sesionesHoy.length} completadas</span>
          </div>
          {sesionesHoy.length===0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--text3)",fontSize:13}}>Sin sesiones programadas para hoy</div>
            : sesionesHoy.map(s=>(
              <div key={s.id} style={{padding:"10px 18px",borderBottom:"0.5px solid var(--border)",display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"var(--accent)",minWidth:44}}>{fmtHora(s.hora_inicio)}</div>
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
                  {firmaModal.fecha} {fmtHora(firmaModal.hora)} · {firmaModal.sedes?.nombre} · {firmaModal.compras_paciente?.paquetes?.nombre}
                </div>
              </div>
              <button onClick={()=>setFirmaModal(null)}
                style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:20,padding:"0 4px"}}>×</button>
            </div>

            {/* Contenido scrolleable */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>

              {/* Signos vitales */}
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Signos Vitales</div>
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
            background: i===data.length-1 ? "var(--accent)" : "var(--accent-light)",
            borderRadius:"4px 4px 0 0",
            transition:"height 0.5s",
            minHeight:4,
            border: i===data.length-1 ? "none" : "0.5px solid var(--border)",
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
      <div style={{marginBottom:28,display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",letterSpacing:"-0.01em"}}>Dashboard</h1>
          <p style={{color:"var(--text3)",fontSize:13,marginTop:3}}>{new Date().toLocaleDateString("es-PE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        </div>
        <div style={{fontSize:11,color:"var(--text3)",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"4px 10px",letterSpacing:"0.02em"}}>
          Red Oxynatur
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Pacientes activos", val:totales.pacientes, color:"var(--accent)", sub:"en tratamiento"},
          {label:"Sesiones este mes",  val:totales.sesiones,  color:"#7C6AF7", sub:"hiperbáricas"},
          {label:"Ingresos del mes",   val:`S/ ${totales.ingresos.toLocaleString()}`, color:"#10B981", sub:"facturado"},
          {label:"Sesiones hoy",       val:totales.sesHoy,   color:"#F59E0B", sub:"programadas"},
        ].map((k,i)=>(
          <div key={i} style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-md)",padding:"18px 20px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"12px 12px 0 0"}}/>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>{k.label}</div>
            <div style={{fontSize:30,fontWeight:700,fontFamily:"Syne,sans-serif",color:k.val===0?"var(--border2)":k.color,lineHeight:1}}>{k.val===0?"—":k.val}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <div style={{fontSize:11,fontWeight:600,color:"var(--text3)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Rendimiento por sede</div>
        <div style={{flex:1,height:"0.5px",background:"var(--border)"}}/>
      </div>
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
  const [pagina, setPagina] = useState(0);
  const PAC_PAGE = 25; // pacientes por página

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

  const [exportandoPac, setExportandoPac] = useState(false);

  const exportarPacientes = async () => {
    if(!pacs || pacs.length === 0) { toast.info("No hay pacientes para exportar"); return; }
    setExportandoPac(true);
    try {
      await new Promise((res, rej) => {
        if(window.XLSX) return res();
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      const XLSX = window.XLSX;
      const filas = pacs.map(p => ({
        "Apellidos":          p.apellidos || "",
        "Nombres":            p.nombres   || "",
        "DNI":                p.dni       || "",
        "Teléfono":           p.telefono  || "",
        "Email":              p.email     || "",
        "Género":             p.genero    || "",
        "Fecha nacimiento":   p.fecha_nacimiento || "",
        "Sede":               p.sedes?.nombre || "",
        "Estado":             p.estado   || "",
        "Sesiones realizadas":p.sesiones_realizadas || 0,
        "Total prescritas":   p.total_sesiones_prescritas || 0,
        "Canal origen":       p.canal_origen || "",
        "Fecha registro":     p.fecha_registro ? p.fecha_registro.slice(0,10) : "",
        "Notas admin":        p.notas_admin || "",
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      ws["!cols"] = [{wch:20},{wch:20},{wch:12},{wch:14},{wch:24},{wch:8},{wch:14},{wch:20},{wch:10},{wch:18},{wch:16},{wch:14},{wch:14},{wch:30}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pacientes");
      const fecha = new Date().toLocaleDateString("en-CA");
      XLSX.writeFile(wb, `Oxynatur_Pacientes_${fecha}.xlsx`);
      toast.success(`${pacs.length} pacientes exportados`);
    } catch(e) {
      toast.error("Error al exportar");
    }
    setExportandoPac(false);
  };

  const abrirPerfil = async (pac) => {
    setPacSelec(pac);
    setLoadingPerfil(true);
    const [r1, r2, r3] = await Promise.all([
      // Datos completos del paciente
      safeQuery(()=>
        supabase.from("pacientes")
          .select("*, sedes!sede_principal_id(nombre)")
          .eq("id", pac.id).maybeSingle(),
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
  const totalPaginas = Math.ceil(filtrados.length / PAC_PAGE);
  const filtradosPag = filtrados.slice(pagina * PAC_PAGE, (pagina + 1) * PAC_PAGE);

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
    }).select().maybeSingle();
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
            style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
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
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
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
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Datos del paciente</div>
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
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Progreso del tratamiento</div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="var(--border)" strokeWidth="8"/>
                    <circle cx="36" cy="36" r="30" fill="none" stroke="var(--accent)" strokeWidth="8"
                      strokeDasharray={`${2*Math.PI*30}`}
                      strokeDashoffset={`${2*Math.PI*30*(1-(pacSelec.sesiones_realizadas||0)/(pacSelec.total_sesiones_prescritas||1))}`}
                      strokeLinecap="round" transform="rotate(-90 36 36)"/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:16,fontWeight:700,color:"var(--accent)"}}>{pacSelec.sesiones_realizadas||0}</div>
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
                          <div style={{height:"100%",width:`${pct}%`,background:pct>=100?"#10B981":"var(--accent)",borderRadius:2,transition:"width .3s"}}/>
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
                  const ECOLOR = {programada:"#F59E0B",en_curso:"var(--accent)",completada:"#10B981",cancelada:"#F87171",no_asistio:"var(--text3)"};
                  return (
                    <div key={s.id} style={{padding:"10px 18px",borderBottom:i<ultimasSesiones.length-1?"0.5px solid var(--border)":"none",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:700,color:"var(--accent)",minWidth:44}}>{fmtHora(s.hora_inicio)}</div>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"flex-end",gap:10}}>
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
        <div style={{display:"flex",gap:8}}>
          {pacs.length > 0 && (
            <Btn variant="ghost" onClick={exportarPacientes} disabled={exportandoPac} style={{fontSize:13}}>
              {exportandoPac ? "Exportando..." : "↓ Excel"}
            </Btn>
          )}
          {f.puedeCrearPaciente && <Btn onClick={()=>setModal(true)}>+ Nuevo Paciente</Btn>}
        </div>
      </div>
      <input value={busq} onChange={e=>{setBusq(e.target.value);setPagina(0);}} placeholder="Buscar por nombre o DNI..."
        style={{background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"9px 14px",fontSize:14,fontFamily:"inherit",outline:"none",width:300,marginBottom:16,transition:"border-color .15s"}}/>
      {loading
        ? <div style={{color:"var(--text3)",padding:20}}>Cargando...</div>
        : (
          <>
            <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-md)",overflow:"hidden",marginBottom:4}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",padding:"9px 18px",background:"var(--surface2)",borderBottom:"0.5px solid var(--border)",fontSize:10,color:"var(--text3)",fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase"}}>
              <span>Paciente</span><span>DNI</span><span>Sede</span><span>Sesiones</span><span>Estado</span>
            </div>
            {filtradosPag.map((p,rowIdx)=>(
              <div key={p.id} onClick={()=>abrirPerfil(p)}
                style={{padding:"12px 18px",display:"grid",gridTemplateColumns:"2fr 1fr 1.2fr 1fr 1fr",alignItems:"center",cursor:"pointer",borderBottom:"0.5px solid var(--border)",background:rowIdx%2===0?"transparent":"var(--surface2)",transition:"background .1s"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--accent-light)"}
                onMouseLeave={e=>e.currentTarget.style.background=rowIdx%2===0?"transparent":"var(--surface2)"}>
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
            {filtrados.length>0 && totalPaginas>1 && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderTop:"0.5px solid var(--border)",background:"var(--surface2)"}}>
                <div style={{fontSize:12,color:"var(--text3)"}}>
                  {pagina*PAC_PAGE+1}–{Math.min((pagina+1)*PAC_PAGE,filtrados.length)} de {filtrados.length} pacientes
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>setPagina(0)} disabled={pagina===0}
                    style={{background:"none",border:"0.5px solid var(--border)",color:pagina===0?"var(--text3)":"var(--text2)",padding:"5px 10px",borderRadius:6,cursor:pagina===0?"default":"pointer",fontFamily:"inherit",fontSize:12}}>«</button>
                  <button onClick={()=>setPagina(p=>Math.max(0,p-1))} disabled={pagina===0}
                    style={{background:"none",border:"0.5px solid var(--border)",color:pagina===0?"var(--text3)":"var(--text2)",padding:"5px 10px",borderRadius:6,cursor:pagina===0?"default":"pointer",fontFamily:"inherit",fontSize:12}}>‹</button>
                  {Array.from({length:Math.min(5,totalPaginas)},(_,i)=>{
                    const pg = Math.max(0,Math.min(totalPaginas-5,pagina-2))+i;
                    return (
                      <button key={pg} onClick={()=>setPagina(pg)}
                        style={{background:pagina===pg?"var(--accent)":"none",border:"0.5px solid var(--border)",color:pagina===pg?"white":"var(--text2)",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:pagina===pg?600:400,minWidth:32}}>
                        {pg+1}
                      </button>
                    );
                  })}
                  <button onClick={()=>setPagina(p=>Math.min(totalPaginas-1,p+1))} disabled={pagina===totalPaginas-1}
                    style={{background:"none",border:"0.5px solid var(--border)",color:pagina===totalPaginas-1?"var(--text3)":"var(--text2)",padding:"5px 10px",borderRadius:6,cursor:pagina===totalPaginas-1?"default":"pointer",fontFamily:"inherit",fontSize:12}}>›</button>
                  <button onClick={()=>setPagina(totalPaginas-1)} disabled={pagina===totalPaginas-1}
                    style={{background:"none",border:"0.5px solid var(--border)",color:pagina===totalPaginas-1?"var(--text3)":"var(--text2)",padding:"5px 10px",borderRadius:6,cursor:pagina===totalPaginas-1?"default":"pointer",fontFamily:"inherit",fontSize:12}}>»</button>
                </div>
              </div>
            )}
            </div>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"flex-end",gap:10}}>
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
  const [modalConsentimiento, setModalConsentimiento] = useState(false);
  const [formConsentimiento, setFormConsentimiento] = useState({medico_nombre:"", medico_cmp:"", fecha: new Date().toLocaleDateString("en-CA")});
  const [guardandoConsentimiento, setGuardandoConsentimiento] = useState(false);
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
  const guardarConsentimiento = async () => {
    if(!formConsentimiento.medico_nombre) { toast.error("Ingresa el nombre del médico"); return; }
    if(!formConsentimiento.fecha) { toast.error("Ingresa la fecha"); return; }
    setGuardandoConsentimiento(true);
    const pac = pacSelec.pacientes;
    const { error } = await safeQuery(() =>
      supabase.from("pacientes").update({
        consentimiento_firmado: true,
        consentimiento_fecha: formConsentimiento.fecha,
        consentimiento_informado_por: formConsentimiento.medico_nombre,
        medico_evaluador_inicial: formConsentimiento.medico_nombre,
        medico_evaluador_fecha: formConsentimiento.fecha,
      }).eq("id", pac.id), "Pacientes:consentimiento"
    );
    setGuardandoConsentimiento(false);
    if(error) { toast.error("Error al guardar"); return; }
    toast.success("Consentimiento registrado correctamente");
    // Generar PDF
    await exportarPDFConsentimiento(formConsentimiento);
    setModalConsentimiento(false);
    // Recargar datos del paciente
    const { data } = await safeQuery(() =>
      supabase.from("historias_clinicas")
        .select("*, pacientes(id,nombres,apellidos,dni,fecha_nacimiento,genero,telefono,email,sesiones_realizadas,total_sesiones_prescritas,consentimiento_firmado,consentimiento_fecha,consentimiento_informado_por), sedes!sede_apertura_id(nombre)")
        .eq("paciente_id", pac.id).maybeSingle(), "HC:recargar"
    );
    if(data) setPacSelec(data);
  };

  const exportarPDFConsentimiento = async (form) => {
    await new Promise((res,rej)=>{
      if(window.jspdf) return res();
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
    const {jsPDF}=window.jspdf;
    const norm=(str)=>String(str==null?"":str)
      .replace(/á/g,"a").replace(/é/g,"e").replace(/í/g,"i").replace(/ó/g,"o").replace(/ú/g,"u")
      .replace(/Á/g,"A").replace(/É/g,"E").replace(/Í/g,"I").replace(/Ó/g,"O").replace(/Ú/g,"U")
      .replace(/ñ/g,"n").replace(/Ñ/g,"N");
    const doc=new jsPDF();
    const pac=pacSelec.pacientes;
    const PAGE_W=210, PAGE_H=297, MARGIN=18, CW=PAGE_W-MARGIN*2;
    let y=0;

    // Header azul
    doc.setFillColor(0,75,140);
    doc.rect(0,0,PAGE_W,28,"F");
    try{doc.addImage("/logo.jpg","JPEG",MARGIN-2,4,18,18);}catch(e){}
    doc.setFillColor(255,255,255);
    doc.roundedRect(MARGIN-3,3,21,22,3,3,"F");
    try{doc.addImage("/logo.jpg","JPEG",MARGIN-2,4,18,18);}catch(e){}
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.setTextColor(255,255,255);
    doc.text("CONSENTIMIENTO INFORMADO", 40, 11);
    doc.setFont("helvetica","normal");
    doc.setFontSize(7.5);
    doc.setTextColor(200,230,255);
    doc.text("Oxigenoterapia Hiperbarica (OHB)  |  Consorcio Estilo Medico S.A.C.  |  RUC: 20614901781", 40, 17);
    const sedeN=(pacSelec.sedes?.nombre||"").toLowerCase();
    const sedeInfo=sedeN.includes("molisalud")||sedeN.includes("molina")
      ?"Molisalud: Av. Javier Prado 5998, La Molina  |  RENIPRESS: 00037878"
      :sedeN.includes("miguel")||sedeN.includes("arcangel")
      ?"Clinica San Miguel Arcangel: Jr. Las Gardenias 754, SJL  |  RENIPRESS: 00009104"
      :sedeN.includes("vitalis")?"Angel Vitalis: San Martin de Porres  |  RENIPRESS: [en tramite]"
      :norm(pacSelec.sedes?.nombre||"");
    doc.setFontSize(7);
    doc.setTextColor(180,220,200);
    doc.text(sedeInfo, 40, 23);
    doc.setDrawColor(0,168,150);
    doc.setLineWidth(1.2);
    doc.line(0,28,PAGE_W,28);
    doc.setLineWidth(0.2);
    y=36;

    // Datos del paciente
    doc.setFillColor(240,246,255);
    doc.rect(MARGIN,y-3,CW,26,"F");
    doc.setDrawColor(0,75,140);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN,y-3,CW,26,"S");
    doc.setLineWidth(0.2);
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.setTextColor(0,75,140);
    doc.text(`${norm(pac?.apellidos||"")} ${norm(pac?.nombres||"")}`, MARGIN+3, y+4);
    doc.setFont("helvetica","normal");
    doc.setFontSize(8);
    doc.setTextColor(60,60,60);
    doc.text(`DNI: ${pac?.dni||"-"}   |   Fecha: ${new Date().toLocaleDateString("es-PE")}   |   N° HC: ${norm(pacSelec?.numero_hc||"-")}`, MARGIN+3, y+11);
    doc.text(`Tel: ${pac?.telefono||"-"}   |   Email: ${pac?.email||"-"}`, MARGIN+3, y+18);
    y+=32;

    // Cuerpo del consentimiento
    const parrafos = [
      {titulo:"1. DESCRIPCION DEL PROCEDIMIENTO", texto:"La Oxigenoterapia Hiperbarica (OHB) consiste en la administracion de oxigeno puro al 100% a una presion superior a la atmosferica (entre 1.4 y 3.0 ATA) dentro de una camara hiperbarica. El tratamiento tiene una duracion estandar de 60 minutos por sesion y se realiza en un ambiente controlado bajo supervision del personal certificado de Oxynatur."},
      {titulo:"2. BENEFICIOS ESPERADOS", texto:"La OHB puede contribuir a la cicatrizacion de heridas cronicas, reduccion de infecciones, mejora de la oxigenacion tisular, tratamiento de necrosis avascular, recuperacion post-quirurgica, y otras indicaciones clinicas determinadas por el medico tratante. Los resultados pueden variar segun la condicion clinica de cada paciente."},
      {titulo:"3. RIESGOS Y EFECTOS ADVERSOS", texto:"Los riesgos asociados a la OHB incluyen: barotrauma de oidos o senos paranasales (presion dolorosa), claustrofobia, fatiga temporal, nauseas, y en casos excepcionales convulsiones por toxicidad al oxigeno. El personal operativo esta capacitado para manejar estas situaciones segun el protocolo de emergencias de Oxynatur v2.0."},
      {titulo:"4. CONTRAINDICACIONES DECLARADAS", texto:"Declaro haber sido informado/a sobre las contraindicaciones absolutas (neumotorax no tratado, quimioterapia con Doxorubicina o Bleomicina, fiebre activa mayor de 38 grados, entre otras) y confirmo no presentar ninguna de ellas al momento de firmar este documento. Me comprometo a informar al personal antes de cada sesion si desarrollo alguna contraindicacion."},
      {titulo:"5. EVALUACION MEDICA PREVIA OBLIGATORIA", texto:"Declaro haber sido evaluado/a por el medico responsable, quien determino mi aptitud clinica para recibir tratamiento de OHB. Entiendo que esta evaluacion medica previa es obligatoria antes de iniciar cualquier sesion y que el personal podra suspender la sesion si detecta condiciones que contraindiquen el procedimiento."},
      {titulo:"6. DERECHO A RETIRO", texto:"Entiendo que puedo retirar este consentimiento en cualquier momento, sin necesidad de justificacion y sin que ello afecte mi atencion medica. Puedo interrumpir la sesion en cualquier momento comunicandolo al operador mediante las senales establecidas."},
      {titulo:"7. AUTORIZACION", texto:"Habiendo recibido informacion clara y suficiente sobre el procedimiento, sus beneficios, riesgos y alternativas, y habiendo tenido la oportunidad de formular preguntas, AUTORIZO voluntariamente la realizacion del tratamiento de Oxigenoterapia Hiperbarica en las instalaciones de Oxynatur."},
    ];

    for(const p of parrafos) {
      if(y+30 > PAGE_H-40) {
        doc.setFillColor(245,248,255);
        doc.rect(0,PAGE_H-16,PAGE_W,16,"F");
        doc.setDrawColor(0,168,150);
        doc.setLineWidth(0.5);
        doc.line(0,PAGE_H-16,PAGE_W,PAGE_H-16);
        doc.setLineWidth(0.2);
        doc.setFontSize(7);
        doc.setFont("helvetica","normal");
        doc.setTextColor(80,80,80);
        doc.text("Servicio de Medicina Hiperbarica - Oxynatur  |  Consorcio Estilo Medico S.A.C.", MARGIN, PAGE_H-9);
        doc.text(`Documento confidencial - Ley N° 29733`, PAGE_W-MARGIN, PAGE_H-9, {align:"right"});
        doc.addPage();
        y=20;
      }
      doc.setFont("helvetica","bold");
      doc.setFontSize(8);
      doc.setTextColor(0,75,140);
      doc.text(p.titulo, MARGIN, y);
      y+=5;
      doc.setFont("helvetica","normal");
      doc.setFontSize(8);
      doc.setTextColor(50,50,50);
      const lines=doc.splitTextToSize(p.texto, CW);
      doc.text(lines, MARGIN, y);
      y+=lines.length*4.5+6;
    }

    // Firmas
    if(y+50 > PAGE_H-40) {
      doc.addPage();
      y=20;
    }
    y+=8;
    doc.setDrawColor(150,150,150);
    doc.setLineWidth(0.3);
    // Paciente
    doc.line(MARGIN, y+20, MARGIN+75, y+20);
    doc.setFont("helvetica","normal");
    doc.setFontSize(7.5);
    doc.setTextColor(60,60,60);
    doc.text("Firma del Paciente o Representante Legal", MARGIN, y+25);
    doc.text(`Nombre: ${norm(pac?.nombres||"")} ${norm(pac?.apellidos||"")}`, MARGIN, y+30);
    doc.text(`DNI: ${pac?.dni||"-"}`, MARGIN, y+35);
    doc.text(`Fecha: ___/___/______`, MARGIN, y+40);
    // Medico
    doc.line(PAGE_W/2+5, y+20, PAGE_W-MARGIN, y+20);
    doc.text("Firma del Medico/Personal que informo", PAGE_W/2+5, y+25);
    doc.text(`Nombre: ${norm(form?.medico_nombre||"")}`, PAGE_W/2+5, y+30);
    doc.text(`CMP: ${norm(form?.medico_cmp||"-")}`, PAGE_W/2+5, y+35);
    doc.text(`Fecha: ${new Date(form?.fecha+"T12:00:00").toLocaleDateString("es-PE")}`, PAGE_W/2+5, y+40);

    // Footer
    doc.setFillColor(245,248,255);
    doc.rect(0,PAGE_H-16,PAGE_W,16,"F");
    doc.setDrawColor(0,168,150);
    doc.setLineWidth(0.5);
    doc.line(0,PAGE_H-16,PAGE_W,PAGE_H-16);
    doc.setLineWidth(0.2);
    doc.setFontSize(7);
    doc.setFont("helvetica","normal");
    doc.setTextColor(80,80,80);
    doc.text("Servicio de Medicina Hiperbarica - Oxynatur  |  Consorcio Estilo Medico S.A.C.", MARGIN, PAGE_H-9);
    doc.text("Documento confidencial - Ley N° 29733 de Proteccion de Datos Personales", PAGE_W-MARGIN, PAGE_H-9, {align:"right"});

    doc.save(`Consentimiento_${norm(pac?.apellidos||"pac")}_${norm(pac?.nombres||"")}_${new Date().toISOString().slice(0,10)}.pdf`);
    toast.success("PDF de consentimiento generado");
  };

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
    const LOGO_B64 = "/logo.jpg";
    const PAGE_W = 210;
    const PAGE_H = 297;
    const MARGIN = 14;
    const CONTENT_W = PAGE_W - MARGIN*2;
    let y = 0;
    let pageNum = 1;

    const addHeader = () => {
      // Fondo azul oscuro header
      doc.setFillColor(0, 75, 140);
      doc.rect(0, 0, PAGE_W, 28, "F");
      // Logo — fondo blanco circular para contraste sobre azul
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(MARGIN-1, 3, 21, 22, 3, 3, "F");
      try { doc.addImage(LOGO_B64, "JPEG", MARGIN, 4, 18, 18); } catch(e) {}
      // Titulo
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text("HISTORIA CLINICA - OXIGENOTERAPIA HIPERBARICA", 36, 10);
      doc.setFont("helvetica","normal");
      doc.setFontSize(7.5);
      doc.setTextColor(200, 230, 255);
      doc.text("Consorcio Estilo Medico S.A.C.  |  RUC: 20614901781", 36, 16);
      // Sede info con RENIPRESS
      const sedeNombre = (pacSelec.sedes?.nombre || "").toLowerCase();
      let sedeInfo = "";
      let renipress = "";
      if(sedeNombre.includes("molisalud") || sedeNombre.includes("molina")) {
        sedeInfo = "Molisalud: Av. Javier Prado 5998, La Molina  |  Tel: 987203017";
        renipress = "RENIPRESS: 00037878";
      } else if(sedeNombre.includes("miguel") || sedeNombre.includes("sma") || sedeNombre.includes("arcangel")) {
        sedeInfo = "Clinica San Miguel Arcangel: Jr. Las Gardenias 754, SJL  |  Tel: (01)387-5457";
        renipress = "RENIPRESS: 00009104";
      } else if(sedeNombre.includes("vitalis") || sedeNombre.includes("angel")) {
        sedeInfo = "Angel Vitalis: San Martin de Porres";
        renipress = "RENIPRESS: [en tramite]";
      } else {
        sedeInfo = norm(pacSelec.sedes?.nombre || "");
        renipress = "";
      }
      doc.setFontSize(7);
      doc.setTextColor(180, 220, 200);
      doc.text(`${sedeInfo}   |   ${renipress}`, 36, 22);
      // Linea separadora verde
      doc.setDrawColor(0, 168, 150);
      doc.setLineWidth(1.2);
      doc.line(0, 28, PAGE_W, 28);
      doc.setLineWidth(0.2);
      y = 34;
    };

    const addFooter = () => {
      doc.setFillColor(245, 248, 255);
      doc.rect(0, PAGE_H-16, PAGE_W, 16, "F");
      doc.setDrawColor(0, 168, 150);
      doc.setLineWidth(0.5);
      doc.line(0, PAGE_H-16, PAGE_W, PAGE_H-16);
      doc.setLineWidth(0.2);
      doc.setFontSize(7);
      doc.setFont("helvetica","normal");
      doc.setTextColor(80,80,80);
      doc.text("Asesor Medico Cientifico: Dr. Raul Aguado Quevedo  |  CMP 028600  |  RNE 022132", MARGIN, PAGE_H-9);
      doc.text(`Pag. ${pageNum}  |  Emitido: ${new Date().toLocaleDateString("es-PE")} ${new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"})}`, PAGE_W-MARGIN, PAGE_H-9, {align:"right"});
      doc.setFontSize(6.5);
      doc.setTextColor(150,150,150);
      doc.text("Documento confidencial — Protegido por Ley N° 29733 de Proteccion de Datos Personales", PAGE_W/2, PAGE_H-4, {align:"center"});
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
      doc.setFontSize(9);
      doc.setTextColor(255,255,255);
      doc.text(norm(title).toUpperCase(), MARGIN+3, y+1);
      nl(10);
    };

    // ── PÁGINA 1 ──────────────────────────────────────────
    addHeader();

    // Datos del paciente
    sectionTitle("Datos del Paciente");
    doc.setFillColor(240, 246, 255);
    doc.rect(MARGIN, y-3, CONTENT_W, 36, "F");
    doc.setDrawColor(0, 75, 140);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y-3, CONTENT_W, 36, "S");
    doc.setLineWidth(0.2);
    // Nombre completo
    doc.setFontSize(12);
    doc.setFont("helvetica","bold");
    doc.setTextColor(0,75,140);
    doc.text(`${norm(pac?.apellidos||"")} ${norm(pac?.nombres||"")}`, MARGIN+4, y+5);
    // Fila 1: DNI, Fecha nac, Género
    doc.setFontSize(8);
    doc.setFont("helvetica","normal");
    doc.setTextColor(60,60,60);
    const edad = pac?.fecha_nacimiento
      ? Math.floor((new Date()-new Date(pac.fecha_nacimiento))/31557600000)+"a"
      : "";
    doc.text(`DNI: ${pac?.dni||"-"}   |   Nac: ${pac?.fecha_nacimiento||"-"} ${edad?`(${edad})`:""}   |   Genero: ${pac?.genero||"-"}`, MARGIN+4, y+12);
    // Fila 2: Sede, N° HC, fecha apertura
    doc.text(`Sede: ${norm(pacSelec.sedes?.nombre||"-")}   |   N° HC: ${norm(hc?.numero_hc||"-")}   |   Apertura: ${hc?.fecha_apertura?new Date(hc.fecha_apertura).toLocaleDateString("es-PE"):new Date().toLocaleDateString("es-PE")}`, MARGIN+4, y+19);
    // Fila 3: Sesiones, apto
    doc.text(`Sesiones: ${pac?.sesiones_realizadas||0} realizadas / ${pac?.total_sesiones_prescritas||0} prescritas   |   Apto HBOT: ${hc?.apto_hiperbarica!==false?"SI":"NO"}`, MARGIN+4, y+26);
    // Fila 4: contacto
    if(pac?.telefono || pac?.email) {
      doc.setFontSize(7.5);
      doc.setTextColor(100,100,100);
      doc.text(`Tel: ${pac?.telefono||"-"}   |   Email: ${pac?.email||"-"}`, MARGIN+4, y+32);
    }
    nl(42);

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
      doc.setFontSize(8);
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
      doc.setFontSize(9);
      doc.setTextColor(isBorrador ? 100 : 255, isBorrador ? 80 : 255, isBorrador ? 0 : 255);
      doc.text(`Sesion #${ev.numero_sesion}  -  ${ev.fecha||"-"}  -  ${norm(ev.sedes?.nombre||"")}`, MARGIN+3, y+3);
      if(isBorrador) {
        doc.setFontSize(7);
        doc.setTextColor(180,120,0);
        doc.text("BORRADOR - pendiente firma medica", PAGE_W-MARGIN-3, y+3, {align:"right"});
      }
      nl(11);

      // PRE / POST en dos columnas — altura dinamica
      const preLines = [
        ev.presion_arterial_pre ? `PA: ${ev.presion_arterial_pre}` : null,
        ev.frecuencia_cardiaca ? `FC: ${ev.frecuencia_cardiaca} bpm` : null,
        ev.saturacion_o2_pre ? `SatO2: ${ev.saturacion_o2_pre}%` : null,
        ev.temperatura ? `Temp: ${ev.temperatura} C` : null,
        ev.peso ? `Peso: ${ev.peso} kg` : null,
      ].filter(Boolean);
      const postLines = [
        ev.presion_arterial ? `PA: ${ev.presion_arterial}` : null,
        ev.frecuencia_cardiaca_post ? `FC: ${ev.frecuencia_cardiaca_post} bpm` : null,
        ev.saturacion_o2 ? `SatO2: ${ev.saturacion_o2}%` : null,
        ev.nivel_dolor!=null ? `Dolor: ${ev.nivel_dolor}/10` : null,
        ev.estado_general ? `Estado: ${norm(ev.estado_general)}` : null,
        ev.tolerancia ? `Tolerancia: ${norm(ev.tolerancia)}` : null,
      ].filter(Boolean);
      const maxLines = Math.max(preLines.length, postLines.length, 2);
      const boxH = 8 + maxLines * 4.5;
      checkPage(boxH + 4);
      const colW = (CONTENT_W/2) - 3;
      const colR = MARGIN + CONTENT_W/2 + 1;
      // PRE — izquierda
      doc.setFillColor(235,240,255);
      doc.rect(MARGIN+2, y-2, colW, boxH, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(7);
      doc.setTextColor(60,60,180);
      doc.text("PRE-SESION", MARGIN+4, y+2);
      doc.setFont("helvetica","normal");
      doc.setFontSize(7.5);
      doc.setTextColor(50,50,50);
      preLines.forEach((line, li) => doc.text(line, MARGIN+4, y+7+(li*4.5)));
      // POST — derecha
      doc.setFillColor(220,245,238);
      doc.rect(colR, y-2, colW, boxH, "F");
      doc.setFont("helvetica","bold");
      doc.setFontSize(7);
      doc.setTextColor(0,120,80);
      doc.text("POST-SESION", colR+2, y+2);
      doc.setFont("helvetica","normal");
      doc.setFontSize(7.5);
      doc.setTextColor(50,50,50);
      postLines.forEach((line, li) => doc.text(line, colR+2, y+7+(li*4.5)));
      nl(boxH + 4);

      // Parámetros de sesión
      checkPage(8);
      doc.setFillColor(245,245,255);
      doc.rect(MARGIN+2, y-2, CONTENT_W-4, 8, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica","bold");
      doc.setTextColor(80,60,160);
      const params = [
        ev.presion_indicada ? `Presion: ${ev.presion_indicada} ATA` : null,
        ev.duracion_minutos ? `Duracion: ${ev.duracion_minutos} min` : null,
        ev.camara_id ? `Camara: ${ev.camara_id.slice(-4)}` : null,
      ].filter(Boolean).join("   |   ");
      doc.text(params || "-", MARGIN+5, y+3);
      nl(10);

      // Cuestionario resumen (solo los Si)
      const cpre = ev.cuestionario_pre || {};
      const alertasCpre = [
        cpre.fiebre && "⛔ Fiebre activa",
        cpre.dolor_oidos && "⛔ Dolor de oidos",
        cpre.alcohol && "⛔ Alcohol",
        cpre.doxorubicina && "⛔ Quimioterapia (Doxorubicina/Bleomicina)",
        cpre.resfriado && "⚠ Resfriado/congestion",
        cpre.medicamento_nuevo && "⚠ Medicamento nuevo",
        cpre.sintoma_nuevo && "⚠ Sintoma nuevo",
      ].filter(Boolean);
      if(alertasCpre.length > 0) {
        checkPage(8);
        doc.setFontSize(7.5);
        doc.setFont("helvetica","bold");
        doc.setTextColor(200,80,0);
        doc.text(`Alertas pre-sesion: ${alertasCpre.join(", ")}`, MARGIN+4, y);
        nl(6);
      }

      // Observaciones — solo si hay contenido real
      if(ev.observaciones && ev.observaciones.trim() && ev.observaciones.trim().toUpperCase() !== "NINGUNO" && ev.observaciones.trim() !== "-") {
        checkPage(10);
        doc.setFontSize(7.5);
        doc.setFont("helvetica","italic");
        doc.setTextColor(80,80,80);
        const obsLines = doc.splitTextToSize(`Obs: ${norm(ev.observaciones)}`, CONTENT_W-10);
        doc.text(obsLines, MARGIN+4, y);
        nl(5 * obsLines.length + 2);
      }

      // Evolucion medica
      if(ev.evolucion) {
        checkPage(10);
        doc.setFontSize(7.5);
        doc.setFont("helvetica","italic");
        doc.setTextColor(0,75,140);
        const evolLines = doc.splitTextToSize(`Evolucion: ${norm(ev.evolucion)}`, CONTENT_W-10);
        doc.text(evolLines, MARGIN+4, y);
        nl(5 * evolLines.length + 2);
      }

      // Firma médico
      checkPage(12);
      if(ev.firma_medico) {
        doc.setFillColor(220,245,235);
        doc.rect(MARGIN+2, y-2, CONTENT_W-4, 9, "F");
        doc.setFontSize(7.5);
        doc.setFont("helvetica","bold");
        doc.setTextColor(0,120,80);
        doc.text(`Evaluado y firmado por: ${norm(ev.firma_medico)}`, MARGIN+5, y+3);
      } else {
        doc.setFillColor(255,248,225);
        doc.rect(MARGIN+2, y-2, CONTENT_W-4, 9, "F");
        doc.setDrawColor(220,150,0);
        doc.setLineWidth(0.3);
        doc.rect(MARGIN+2, y-2, CONTENT_W-4, 9, "S");
        doc.setLineWidth(0.2);
        doc.setFontSize(7.5);
        doc.setFont("helvetica","bold");
        doc.setTextColor(180,100,0);
        doc.text("BORRADOR - Pendiente de firma medica. No tiene validez legal.", MARGIN+5, y+3);
      }
      nl(12);

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
            .limit(1).maybeSingle(), "HC:open_from_agenda"
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
        duracion_minutos:    [60,90,120].includes(parseInt(formEval.duracion_minutos)) ? parseInt(formEval.duracion_minutos) : 60,
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
        }).select().maybeSingle(),
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
            style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
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
          {/* Badge consentimiento */}
          {pacSelec.pacientes?.consentimiento_firmado
            ? <span style={{display:"flex",alignItems:"center",gap:5,background:"#D1FAE5",color:"#065F46",border:"0.5px solid #6EE7B7",borderRadius:99,padding:"4px 12px",fontSize:11,fontWeight:600}}>
                Consentimiento firmado
              </span>
            : <button onClick={()=>setModalConsentimiento(true)}
                style={{background:"#FEF3C7",color:"#92400E",border:"0.5px solid #FCD34D",borderRadius:99,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600}}>
                Pendiente consentimiento
              </button>
          }
          <Btn variant="ghost" onClick={()=>setModalConsentimiento(true)} style={{fontSize:12}}>
            Consentimiento PDF
          </Btn>
          <Btn variant="ghost" onClick={exportarPDF} style={{fontSize:12}}>
            HC PDF
          </Btn>
        </div>
      </div>

      {/* HC MAESTRA */}
      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",display:"flex",alignItems:"center",gap:8}}>
            Historia Clínica Maestra
            {hcMaestra?.numero_hc && (
              <span style={{fontSize:10,color:"var(--accent)",fontWeight:700,background:"var(--accent-light)",padding:"2px 10px",borderRadius:99,border:"0.5px solid var(--accent-mid)",letterSpacing:"0.08em"}}>
                {hcMaestra.numero_hc}
              </span>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Badge color={pacSelec.apto_hiperbarica!==false?"#10B981":"#F87171"}>
              {pacSelec.apto_hiperbarica!==false?"Apto HBOT":"No apto HBOT"}
            </Badge>
            {f.puedeEscribirProtocolo && !editandoHC && (
              <button onClick={()=>setEditandoHC(true)}
                style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
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
                style={{width:16,height:16,accentColor:"var(--accent)"}}/>
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
                            {epIdx===0 && <span style={{fontSize:11,color:"var(--accent)",marginLeft:8,fontWeight:400}}>● Activo</span>}
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
                        borderLeft:`3px solid ${ev.es_borrador?"#F59E0B":ev.firma_medico?"#10B981":"var(--accent)"}`,
                        borderRadius:12,padding:"14px 18px",marginBottom:6,marginLeft:8,
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                              <span style={{fontFamily:"Syne,sans-serif",fontSize:14,fontWeight:700,color:"var(--text)"}}>Sesión #{ev.numero_sesion}</span>
                              <span style={{fontSize:12,color:"var(--text3)"}}>{ev.fecha} · {fmtHora(ev.hora)}</span>
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
                                  <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,marginBottom:4}}>POST-SESIÓN</div>
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
                              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,flexShrink:0}}>
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
                <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Nueva Evaluación</div>
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
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10,paddingTop:4,paddingBottom:8,borderBottom:"0.5px solid var(--border)"}}>
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
                  style={{width:"100%",accentColor:"var(--accent)"}}/>
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
                  style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Observaciones del operador</label>
                <textarea value={formEval.observaciones} onChange={e=>setFormEval(f=>({...f,observaciones:e.target.value}))}
                  placeholder="Observaciones post-sesión..." rows={2}
                  style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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
                      style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
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
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}
          onKeyDown={e=>e.key==="Escape"&&setModalEval(null)} tabIndex={-1}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:"#10B981",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>Evaluación Firmada · Sesión #{modalEval.numero_sesion}</div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)"}}>{pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{modalEval.fecha} · {fmtHora(modalEval.hora)} · {modalEval.sedes?.nombre}</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                <button onClick={async()=>{
                  // Exportar evaluación a PDF
                  await new Promise((res,rej)=>{
                    if(window.jspdf) return res();
                    const s=document.createElement("script");
                    s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
                    s.onload=res; s.onerror=rej;
                    document.head.appendChild(s);
                  });
                  const {jsPDF}=window.jspdf;
                  const norm=(str)=>String(str==null?"":str)
                    .replace(/á/g,"a").replace(/é/g,"e").replace(/í/g,"i").replace(/ó/g,"o").replace(/ú/g,"u")
                    .replace(/Á/g,"A").replace(/É/g,"E").replace(/Í/g,"I").replace(/Ó/g,"O").replace(/Ú/g,"U")
                    .replace(/ñ/g,"n").replace(/Ñ/g,"N");
                  const doc=new jsPDF();
                  const pac=pacSelec.pacientes;
                  const ev=modalEval;
                  const PAGE_W=210, PAGE_H=297, MARGIN=14;
                  const CONTENT_W=PAGE_W-MARGIN*2;
                  let y=0;

                  // Header
                  doc.setFillColor(0,75,140);
                  doc.rect(0,0,PAGE_W,28,"F");
                  try{doc.addImage("/logo.jpg","JPEG",MARGIN,4,18,18);}catch(e){}
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(11);
                  doc.setTextColor(255,255,255);
                  doc.text("EVALUACION MEDICA - OXIGENOTERAPIA HIPERBARICA",38,11);
                  doc.setFont("helvetica","normal");
                  doc.setFontSize(8);
                  doc.text("Consorcio Estilo Medico S.A.C.  |  RUC: 20614901781  |  Oxynatur",38,17);
                  doc.text(norm(ev.sedes?.nombre||""),38,22);
                  doc.setDrawColor(0,168,150);
                  doc.setLineWidth(1);
                  doc.line(0,28,PAGE_W,28);
                  doc.setLineWidth(0.2);
                  y=36;

                  // Datos paciente
                  doc.setFillColor(240,245,255);
                  doc.rect(MARGIN,y-3,CONTENT_W,22,"F");
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(11);
                  doc.setTextColor(0,75,140);
                  doc.text(`${norm(pac?.apellidos||"")} ${norm(pac?.nombres||"")}`,MARGIN+3,y+4);
                  doc.setFont("helvetica","normal");
                  doc.setFontSize(8.5);
                  doc.setTextColor(60,60,60);
                  doc.text(`DNI: ${pac?.dni||"-"}   |   Sesion N°: ${ev.numero_sesion||"-"}   |   Fecha: ${ev.fecha||"-"}   |   Hora: ${fmtHora(ev.hora)}`,MARGIN+3,y+10);
                  doc.text(`Presion aplicada: ${ev.presion_indicada||"-"} ATA   |   Duracion: ${ev.duracion_minutos||"-"} min   |   Camara: ${ev.camara_id?ev.camara_id.slice(-4):"-"}`,MARGIN+3,y+16);
                  y+=28;

                  // Signos vitales
                  doc.setFillColor(0,168,150);
                  doc.rect(MARGIN,y-3,CONTENT_W,8,"F");
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(8.5);
                  doc.setTextColor(255,255,255);
                  doc.text("SIGNOS VITALES",MARGIN+3,y+2);
                  y+=10;
                  const sv=[
                    ["Presion arterial",ev.presion_arterial],["FC",`${ev.frecuencia_cardiaca||"-"} bpm`],
                    ["SatO2",`${ev.saturacion_o2||"-"}%`],["Temperatura",`${ev.temperatura||"-"} °C`],
                    ["Peso",`${ev.peso||"-"} kg`],["Nivel dolor",`${ev.nivel_dolor||0}/10`],
                  ];
                  doc.setTextColor(40,40,40);
                  sv.forEach(([k,v],i)=>{
                    const col=i%2===0?MARGIN:MARGIN+CONTENT_W/2;
                    if(i%2===0&&i>0) y+=7;
                    doc.setFont("helvetica","bold");
                    doc.setFontSize(7.5);
                    doc.setTextColor(100,100,100);
                    doc.text(norm(k).toUpperCase()+":",col,y);
                    doc.setFont("helvetica","normal");
                    doc.setFontSize(9);
                    doc.setTextColor(30,30,30);
                    doc.text(norm(String(v||"-")),col+32,y);
                  });
                  y+=12;

                  // Contraindicaciones del día
                  doc.setFillColor(245,158,11);
                  doc.rect(MARGIN,y-3,CONTENT_W,8,"F");
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(8.5);
                  doc.setTextColor(255,255,255);
                  doc.text("SCREENING DE CONTRAINDICACIONES",MARGIN+3,y+2);
                  y+=10;
                  const contra=[
                    ["Otitis",ev.otitis],["Claustrofobia",ev.claustrofobia],
                    ["Embarazo",ev.embarazo],["Fiebre activa",ev.fiebre_activa],
                  ];
                  contra.forEach(([k,v],i)=>{
                    const col=i%2===0?MARGIN:MARGIN+CONTENT_W/2;
                    if(i%2===0&&i>0) y+=7;
                    doc.setFont("helvetica","bold");
                    doc.setFontSize(7.5);
                    doc.setTextColor(100,100,100);
                    doc.text(norm(k).toUpperCase()+":",col,y);
                    doc.setFont("helvetica","normal");
                    doc.setFontSize(9);
                    const val=String(v||"No");
                    doc.setTextColor(val==="Si"||val==="Sí"?180:30,30,30);
                    doc.text(norm(val),col+32,y);
                  });
                  y+=12;

                  // Estado general y tolerancia
                  doc.setFillColor(124,106,247);
                  doc.rect(MARGIN,y-3,CONTENT_W,8,"F");
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(8.5);
                  doc.setTextColor(255,255,255);
                  doc.text("EVALUACION CLINICA",MARGIN+3,y+2);
                  y+=10;
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(7.5);
                  doc.setTextColor(100,100,100);
                  doc.text("ESTADO GENERAL:",MARGIN,y);
                  doc.setFont("helvetica","normal");
                  doc.setFontSize(9);
                  doc.setTextColor(30,30,30);
                  doc.text(norm(ev.estado_general||"-"),MARGIN+36,y);
                  y+=7;
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(7.5);
                  doc.setTextColor(100,100,100);
                  doc.text("TOLERANCIA:",MARGIN,y);
                  doc.setFont("helvetica","normal");
                  doc.setFontSize(9);
                  doc.setTextColor(30,30,30);
                  doc.text(norm(ev.tolerancia||"-"),MARGIN+36,y);
                  y+=10;

                  // Evolución médica
                  if(ev.evolucion){
                    doc.setFillColor(16,185,129);
                    doc.rect(MARGIN,y-3,CONTENT_W,8,"F");
                    doc.setFont("helvetica","bold");
                    doc.setFontSize(8.5);
                    doc.setTextColor(255,255,255);
                    doc.text("EVOLUCION MEDICA",MARGIN+3,y+2);
                    y+=10;
                    doc.setFont("helvetica","normal");
                    doc.setFontSize(9);
                    doc.setTextColor(30,30,30);
                    const lines=doc.splitTextToSize(norm(ev.evolucion),CONTENT_W);
                    doc.text(lines,MARGIN,y);
                    y+=lines.length*5+8;
                  }

                  // Incidencias y observaciones
                  if(ev.incidencias||ev.observaciones){
                    doc.setFillColor(248,113,113);
                    doc.rect(MARGIN,y-3,CONTENT_W,8,"F");
                    doc.setFont("helvetica","bold");
                    doc.setFontSize(8.5);
                    doc.setTextColor(255,255,255);
                    doc.text("INCIDENCIAS Y OBSERVACIONES",MARGIN+3,y+2);
                    y+=10;
                    if(ev.incidencias){
                      doc.setFont("helvetica","bold");
                      doc.setFontSize(8);
                      doc.setTextColor(80,80,80);
                      doc.text("Incidencias:",MARGIN,y);
                      doc.setFont("helvetica","normal");
                      doc.setFontSize(9);
                      doc.setTextColor(30,30,30);
                      const linesI=doc.splitTextToSize(norm(ev.incidencias),CONTENT_W);
                      doc.text(linesI,MARGIN,y+5);
                      y+=linesI.length*5+10;
                    }
                    if(ev.observaciones){
                      doc.setFont("helvetica","bold");
                      doc.setFontSize(8);
                      doc.setTextColor(80,80,80);
                      doc.text("Observaciones:",MARGIN,y);
                      doc.setFont("helvetica","normal");
                      doc.setFontSize(9);
                      doc.setTextColor(30,30,30);
                      const linesO=doc.splitTextToSize(norm(ev.observaciones),CONTENT_W);
                      doc.text(linesO,MARGIN,y+5);
                      y+=linesO.length*5+10;
                    }
                  }

                  // Firma médico
                  y=Math.max(y,240);
                  doc.setDrawColor(200,200,200);
                  doc.line(MARGIN,y,MARGIN+80,y);
                  doc.setFont("helvetica","bold");
                  doc.setFontSize(8.5);
                  doc.setTextColor(30,30,30);
                  doc.text(norm(ev.firma_medico||"Médico evaluador"),MARGIN,y+5);
                  doc.setFont("helvetica","normal");
                  doc.setFontSize(7.5);
                  doc.setTextColor(100,100,100);
                  doc.text("Medico evaluador - CMP vigente",MARGIN,y+10);

                  // Footer
                  doc.setDrawColor(200,200,200);
                  doc.line(MARGIN,PAGE_H-14,PAGE_W-MARGIN,PAGE_H-14);
                  doc.setFontSize(7);
                  doc.setFont("helvetica","normal");
                  doc.setTextColor(120,120,120);
                  doc.text("Asesor Medico Cientifico: Dr. Raul Aguado Quevedo  |  CMP 028600  |  RNE 022132",MARGIN,PAGE_H-9);
                  doc.text(`Emitido: ${new Date().toLocaleDateString("es-PE")} ${new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"})}`,PAGE_W-MARGIN,PAGE_H-9,{align:"right"});

                  doc.save(`Evaluacion_${norm(pac?.apellidos||"pac")}_Sesion${ev.numero_sesion||""}_${ev.fecha||""}.pdf`);
                  toast.success("PDF generado correctamente");
                }}
                  style={{background:"var(--accent)",color:"white",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                  ↓ PDF
                </button>
                <button onClick={()=>setModalEval(null)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {[
                {titulo:"Signos Vitales", color:"var(--accent)", campos:[
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
      {/* Modal Consentimiento Informado */}
      {modalConsentimiento && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9000,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setModalConsentimiento(false)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModalConsentimiento(false)}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:500,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",maxHeight:"90vh",overflowY:"auto"}}>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,paddingBottom:14,borderBottom:"0.5px solid var(--border)"}}>
              <div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Consentimiento Informado</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {pacSelec.pacientes?.nombres} {pacSelec.pacientes?.apellidos} · DNI {pacSelec.pacientes?.dni}
                </div>
              </div>
              <button onClick={()=>setModalConsentimiento(false)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            {/* Estado actual */}
            {pacSelec.pacientes?.consentimiento_firmado && (
              <div style={{background:"#D1FAE5",border:"0.5px solid #6EE7B7",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:600,color:"#065F46",marginBottom:3}}>Consentimiento registrado</div>
                <div style={{fontSize:11,color:"#047857"}}>
                  Fecha: {pacSelec.pacientes?.consentimiento_fecha} · Informado por: {pacSelec.pacientes?.consentimiento_informado_por}
                </div>
              </div>
            )}

            {/* Info del documento */}
            <div style={{background:"var(--surface2)",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
              El PDF incluye: descripcion del procedimiento, beneficios, riesgos, contraindicaciones declaradas, evaluacion medica previa obligatoria y autorizacion del paciente. Debe imprimirse y firmarse fisicamente por el paciente y el medico.
            </div>

            {/* Formulario */}
            <Input label="Médico o personal que informa" value={formConsentimiento.medico_nombre}
              onChange={v=>setFormConsentimiento(f=>({...f,medico_nombre:v}))}
              placeholder="Dr. Raúl Aguado / Nombre del operador" required/>

            <Input label="CMP del médico (si aplica)" value={formConsentimiento.medico_cmp}
              onChange={v=>setFormConsentimiento(f=>({...f,medico_cmp:v}))}
              placeholder="CMP 028600"/>

            <Input label="Fecha de firma" value={formConsentimiento.fecha} type="date"
              onChange={v=>setFormConsentimiento(f=>({...f,fecha:v}))} required/>

            {/* Advertencia si no tiene consentimiento */}
            {!pacSelec.pacientes?.consentimiento_firmado && (
              <div style={{background:"#FEF3C7",border:"0.5px solid #FCD34D",borderRadius:"var(--radius-sm)",padding:"8px 12px",marginBottom:14,fontSize:11,color:"#92400E"}}>
                Este paciente no tiene consentimiento registrado. Sin consentimiento firmado no deberia iniciar sesiones.
              </div>
            )}

            <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:14,borderTop:"0.5px solid var(--border)"}}>
              <Btn variant="ghost" onClick={()=>setModalConsentimiento(false)}>Cancelar</Btn>
              <Btn variant="ghost" onClick={()=>exportarPDFConsentimiento(formConsentimiento)} disabled={!formConsentimiento.medico_nombre}>
                Solo generar PDF
              </Btn>
              <Btn onClick={guardarConsentimiento} disabled={guardandoConsentimiento||!formConsentimiento.medico_nombre}>
                {guardandoConsentimiento?"Guardando...":"Registrar y generar PDF"}
              </Btn>
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
                borderColor:sedeTab===s.id?"var(--accent)":"var(--border)",
                background:sedeTab===s.id?"#F0FDFB":"none",
                color:sedeTab===s.id?"var(--accent)":"var(--text3)"}}>
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
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"14px 18px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent-mid)"}
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
                  <div style={{fontWeight:700,fontSize:16,color:"var(--text)"}}>Oxynatur {sede.nombre}</div>
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
          {label:"Precio sugerido",   val:fmtSol(totalSugerido),  color:"var(--accent)", sub:"total sin descuento"},
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
                  <div style={{background:"var(--accent)",height:6,borderRadius:4,width:`${Math.round(m.total/totalIngresos*100)}%`,transition:"width 0.5s"}}/>
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

  const rolColor = {admin_general:"var(--accent)",admin_sede:"#7C6AF7",medico:"#F59E0B",enfermero:"#10B981"};
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
                    style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:11}}>
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
                background: esSelec ? "var(--accent)" : esHoy ? "#00A89615" : "none",
                color:      esSelec ? "#fff" : esHoy ? "var(--accent)" : "var(--text)",
                border:     esHoy && !esSelec ? "0.5px solid #00A896" : "none",
                borderRadius:6, padding:"5px 2px", cursor:"pointer",
                fontFamily:"inherit", fontSize:12, fontWeight: esHoy||esSelec ? 700 : 400,
                position:"relative",
              }}>
              {d.split("-")[2].replace(/^0/,"")}
              {tieneSes && !esSelec && (
                <span style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",
                  width:4,height:4,borderRadius:"50%",background:"var(--accent)",display:"block"}}/>
              )}
            </button>
          );
        })}
      </div>
      {/* Botón hoy */}
      <div style={{marginTop:8,textAlign:"center"}}>
        <button onClick={()=>{ onChange(hoy); setMesVista(hoy.slice(0,7)); }}
          style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
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
  const [vistaMode, setVistaMode]   = useState("dia");
  const [agenda, setAgenda]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [sedesData, setSedesData]   = useState([]);
  const [sedeTab, setSedeTab]       = useState("todas");
  const [prospectosCitas, setProspectosCitas] = useState([]);
  const [showCalAgenda, setShowCalAgenda] = useState(false);
  const [accionando, setAccionando] = useState(null); // id de sesion en acción

  const ESTADO_COLOR = {programada:"#F59E0B",en_curso:"var(--accent)",completada:"#10B981",cancelada:"#F87171",no_asistio:"var(--text3)"};
  const ESTADO_LABEL = {programada:"Programada",en_curso:"En curso",completada:"Completada",cancelada:"Cancelada",no_asistio:"No asistió"};

  // FIX #7 — getSemana memoizada, no recalcula en cada render
  const semana = useMemo(() => {
    const d = new Date(fechaSelec+"T00:00:00");
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - (d.getDay()===0?6:d.getDay()-1));
    return Array.from({length:7},(_,i)=>{
      const dia = new Date(lunes);
      dia.setDate(lunes.getDate()+i);
      return dia.toLocaleDateString("en-CA",{timeZone:"America/Lima"});
    });
  }, [fechaSelec]);

  // FIX #2 — sedes se fetcha solo una vez al montar
  useEffect(()=>{
    let mounted = true;
    safeQuery(()=>supabase.from("sedes").select("id,nombre"), "Agenda:sedes")
      .then(({data:s})=>{ if(mounted) setSedesData(s||[]); });
    return ()=>{ mounted=false; };
  }, []); // eslint-disable-line

  const load = async () => {
    setLoading(true);
    const fechas = vistaMode==="semana" ? semana : [fechaSelec];
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
    (async()=>{ if(mounted) await load(); })();
    return ()=>{ mounted=false; };
  },[fechaSelec, vistaMode]); // eslint-disable-line

  // FIX #6 — acción rápida con optimistic update + feedback visual
  const cambiarEstado = async (sesionId, nuevoEstado) => {
    setAccionando(sesionId);
    // Optimistic update — actualiza localmente de inmediato
    setAgenda(prev => prev.map(s => s.id===sesionId ? {...s, estado:nuevoEstado} : s));
    const {error} = await safeQuery(
      ()=>supabase.from("sesiones").update({estado:nuevoEstado}).eq("id",sesionId),
      "Agenda:cambiarEstado"
    );
    if(error) {
      // Rollback si falla
      await load();
    }
    setAccionando(null);
  };

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

  // FIX #4 + #8 — prospectos del día computados una sola vez con fecha pre-parseada
  const prospectosHoy = useMemo(() =>
    prospectosFiltrados.filter(p =>
      new Date(p.fecha_cita).toLocaleDateString("en-CA",{timeZone:"America/Lima"}) === fechaSelec
    ),
  [prospectosFiltrados, fechaSelec]);

  // FIX #5 — KPIs adaptativos según vista
  const kpis = useMemo(() => {
    if(vistaMode==="semana") {
      // Totales de toda la semana
      return {
        total:      agendaFiltrada.length + prospectosFiltrados.length,
        completadas: agendaFiltrada.filter(s=>s.estado==="completada").length,
        enCurso:    agendaFiltrada.filter(s=>s.estado==="en_curso").length,
        pendientes: agendaFiltrada.filter(s=>s.estado==="programada").length,
      };
    }
    // Vista día — totales del día seleccionado
    return {
      total:      agendaFiltrada.length + prospectosHoy.length,
      completadas: agendaFiltrada.filter(s=>s.estado==="completada").length,
      enCurso:    agendaFiltrada.filter(s=>s.estado==="en_curso").length,
      pendientes: agendaFiltrada.filter(s=>s.estado==="programada").length,
    };
  }, [agendaFiltrada, prospectosFiltrados, prospectosHoy, vistaMode]);


  // Vista semana calculada
  const renderSemana = (()=>{
        // Config timeline
        const HORA_INICIO = 7;   // 07:00
        const HORA_FIN    = 20;  // 20:00
        const HORAS       = HORA_FIN - HORA_INICIO;
        const PX_HORA     = 64;  // píxeles por hora
        const TOTAL_H     = HORAS * PX_HORA;
        const COL_HORAS   = 44;  // ancho columna de horas

        const toMin = (hhmm) => {
          if(!hhmm) return null;
          const [h,m] = hhmm.slice(0,5).split(":").map(Number);
          return h*60 + m;
        };
        const toTop  = (min) => ((min - HORA_INICIO*60) / 60) * PX_HORA;
        const toHeight = (dur) => Math.max((dur/60)*PX_HORA, 28);

        const horas = Array.from({length: HORAS+1}, (_,i) => HORA_INICIO + i);

        return (
          <div style={{display:"flex", gap:0, overflowX:"auto"}}>

            {/* ── Eje de horas ── */}
            <div style={{width:COL_HORAS, flexShrink:0, position:"relative", height:TOTAL_H+24, paddingTop:32}}>
              {horas.map(h=>(
                <div key={h} style={{
                  position:"absolute",
                  top: 32 + ((h-HORA_INICIO)*PX_HORA) - 8,
                  right:8,
                  fontSize:10, fontWeight:600, color:"var(--text3)",
                  letterSpacing:"0.02em", lineHeight:1,
                  userSelect:"none",
                }}>
                  {h===12?"12pm":h>12?`${h-12}pm`:`${h}am`}
                </div>
              ))}
            </div>

            {/* ── Columnas de días ── */}
            <div style={{flex:1, display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:0, minWidth:0}}>
              {semana.map(fecha=>{
                const sesiones  = agendaFiltrada.filter(s=>s.fecha===fecha);
                const evalsDia  = prospectosFiltrados.filter(p=>
                  new Date(p.fecha_cita).toLocaleDateString("en-CA",{timeZone:"America/Lima"}) === fecha
                );
                const totalDia     = sesiones.length + evalsDia.length;
                const tieneEnCurso = sesiones.some(s=>s.estado==="en_curso");

                return (
                  <div key={fecha} style={{
                    borderLeft:"1px solid var(--border)",
                    borderRight: fecha===semana[6] ? "1px solid var(--border)" : "none",
                    background: esHoy(fecha)?"#00C4B408":"transparent",
                    position:"relative",
                  }}>

                    {/* Cabecera día */}
                    <div
                      onClick={()=>{ setFechaSelec(fecha); setVistaMode("dia"); }}
                      style={{
                        height:32, display:"flex", flexDirection:"column",
                        alignItems:"center", justifyContent:"center",
                        borderBottom:`2px solid ${tieneEnCurso?"var(--accent)":esHoy(fecha)?"#00C4B4":"var(--border)"}`,
                        background: esHoy(fecha)?"#00C4B410":"var(--surface)",
                        cursor:"pointer", gap:1,
                        position:"sticky", top:0, zIndex:2,
                      }}
                    >
                      <div style={{fontSize:8,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,lineHeight:1}}>
                        {new Date(fecha+"T00:00:00").toLocaleDateString("es-PE",{weekday:"short"})}
                      </div>
                      <div style={{
                        fontSize:15,fontWeight:700,fontFamily:"Syne,sans-serif",lineHeight:1,
                        color:esHoy(fecha)?"var(--accent)":"var(--text)",
                      }}>
                        {new Date(fecha+"T00:00:00").getDate()}
                      </div>
                      {totalDia>0 && (
                        <div style={{
                          fontSize:8,fontWeight:700,lineHeight:1,
                          color:tieneEnCurso?"var(--accent)":"var(--text3)",
                        }}>{totalDia}s</div>
                      )}
                    </div>

                    {/* Grid de horas — líneas horizontales */}
                    <div style={{position:"relative", height:TOTAL_H}}>
                      {horas.map(h=>(
                        <div key={h} style={{
                          position:"absolute", top:(h-HORA_INICIO)*PX_HORA,
                          left:0, right:0,
                          borderTop: h===HORA_INICIO ? "none" : "1px solid var(--border)",
                          opacity: 0.5,
                          pointerEvents:"none",
                        }}/>
                      ))}

                      {/* Línea de "ahora" — solo en día de hoy */}
                      {esHoy(fecha) && (() => {
                        const ahora = new Date();
                        const ahoraMin = ahora.getHours()*60 + ahora.getMinutes();
                        const top = toTop(ahoraMin);
                        if(top < 0 || top > TOTAL_H) return null;
                        return (
                          <div style={{
                            position:"absolute", top, left:0, right:0, zIndex:3,
                            display:"flex", alignItems:"center", pointerEvents:"none",
                          }}>
                            <div style={{width:6,height:6,borderRadius:"50%",background:"#F87171",flexShrink:0}}/>
                            <div style={{flex:1,height:1.5,background:"#F87171",opacity:0.7}}/>
                          </div>
                        );
                      })()}

                      {/* Evaluaciones de prospectos */}
                      {evalsDia.map(p=>{
                        const min = toMin(new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/Lima"}));
                        const top = min !== null ? toTop(min) : 0;
                        return (
                          <div key={p.id} style={{
                            position:"absolute",
                            top: Math.max(top,0),
                            left:2, right:2,
                            height:28,
                            background:"#7C6AF720",
                            border:"1px solid #7C6AF750",
                            borderLeft:"3px solid #7C6AF7",
                            borderRadius:5,
                            padding:"2px 5px",
                            overflow:"hidden",
                            zIndex:1,
                            cursor:"default",
                          }}>
                            <div style={{fontSize:9,fontWeight:700,color:"#7C6AF7",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                              {p.nombre.split(" ").slice(-1)[0]}
                            </div>
                            <div style={{fontSize:8,color:"var(--text3)"}}>Eval</div>
                          </div>
                        );
                      })}

                      {/* Sesiones — con detección de solapamientos */}
                      {(()=>{
                        // Calcular posición y dimensiones de cada sesión
                        const items = sesiones.map(s=>({
                          ...s,
                          col: ESTADO_COLOR[s.estado]||"var(--border2)",
                          min: toMin(s.hora_inicio),
                          top: Math.max(toTop(toMin(s.hora_inicio)||0), 0),
                          height: toHeight(s.duracion_minutos||60),
                        }));

                        // Algoritmo de columnas: asignar columna a cada evento
                        // para evitar solapamiento visual
                        const cols = []; // cols[i] = minuto fin del último evento en columna i
                        const assigned = items.map(item=>{
                          const startMin = item.min||0;
                          const endMin   = startMin + (item.duracion_minutos||60);
                          // Buscar columna disponible
                          let colIdx = cols.findIndex(finCol => finCol <= startMin);
                          if(colIdx === -1){ colIdx = cols.length; }
                          cols[colIdx] = endMin;
                          return { ...item, colIdx, totalCols: 0 }; // totalCols se recalcula abajo
                        });

                        // Calcular cuántas columnas se usan en cada franja
                        // para dimensionar el ancho correctamente
                        const withCols = assigned.map((item, i)=>{
                          const startMin = item.min||0;
                          const endMin   = startMin + (item.duracion_minutos||60);
                          // Contar cuántos eventos se solapan con este
                          const maxCol = assigned
                            .filter(other=>{
                              const oStart = other.min||0;
                              const oEnd   = oStart + (other.duracion_minutos||60);
                              return oStart < endMin && oEnd > startMin;
                            })
                            .reduce((max, o) => Math.max(max, o.colIdx+1), 1);
                          return { ...item, totalCols: maxCol };
                        });

                        const GAP = 2;
                        return withCols.map(s=>{
                          const pct     = 100 / s.totalCols;
                          const leftPct = s.colIdx * pct;
                          return (
                            <div key={s.id}
                              onClick={()=>{ setFechaSelec(fecha); setVistaMode("dia"); }}
                              style={{
                                position:"absolute",
                                top: s.top,
                                left:`calc(${leftPct}% + ${GAP}px)`,
                                width:`calc(${pct}% - ${GAP*2}px)`,
                                height: s.height,
                                background:`${s.col}18`,
                                border:`1px solid ${s.col}50`,
                                borderLeft:`3px solid ${s.col}`,
                                borderRadius:5,
                                padding:"3px 5px",
                                overflow:"hidden",
                                cursor:"pointer",
                                zIndex:1,
                                transition:"filter 0.1s",
                                boxSizing:"border-box",
                              }}
                              onMouseEnter={e=>e.currentTarget.style.filter="brightness(0.93)"}
                              onMouseLeave={e=>e.currentTarget.style.filter="none"}
                            >
                              <div style={{fontSize:9,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.2}}>
                                {(s.paciente||"").split(" ").slice(-2).join(" ")}
                              </div>
                              {s.height >= 40 && (
                                <div style={{fontSize:8,color:"var(--text3)",marginTop:1,lineHeight:1.2}}>
                                  {fmtHora(s.hora_inicio)}
                                  {s.camara_numero ? ` · Cam#${s.camara_numero}` : ""}
                                </div>
                              )}
                              <div style={{position:"absolute",bottom:3,right:4,width:5,height:5,borderRadius:"50%",background:s.col}}/>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
  })();

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
        <div style={{display:"flex",alignItems:"center",gap:8}}>
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
          <button onClick={()=>navegar(-1)} style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>‹</button>
          <button onClick={()=>setFechaSelec(hoy)} style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--accent)",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>Hoy</button>
          <button onClick={()=>navegar(1)} style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>›</button>
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

      {/* KPIs — label cambia según vista */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {label: vistaMode==="semana"?"Total semana":"Total hoy",  val:kpis.total,      color:"var(--text)"},
          {label:"Completadas", val:kpis.completadas, color:"#10B981"},
          {label:"En curso",    val:kpis.enCurso,     color:"var(--accent)"},
          {label:"Pendientes",  val:kpis.pendientes,  color:"#F59E0B"},
        ].map((k,i)=>(
          <div key={i} style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"12px 16px",minHeight:90,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:26,fontWeight:700,color:k.color,marginTop:8}}>{k.val === 0 ? <span style={{color:"var(--border2)",fontSize:22}}>—</span> : k.val}</div>
          </div>
        ))}
      </div>

      {/* Tabs sede */}
      {(f.esAdmin || f.esMedicoEsp) && sedesData.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[{id:"todas",nombre:"Todas"},...sedesData].map(s=>(
            <button key={s.id} onClick={()=>setSedeTab(s.id)}
              style={{padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:12,cursor:"pointer",fontFamily:"inherit",
                borderColor:sedeTab===s.id?"var(--accent)":"var(--border)",
                background:sedeTab===s.id?"#F0FDFB":"none",
                color:sedeTab===s.id?"var(--accent)":"var(--text3)"}}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:60,color:"var(--text3)",gap:10}}>
          <div style={{width:18,height:18,border:"2px solid var(--accent)",borderTopColor:"transparent",borderRadius:"50%"}}/>
          Cargando agenda...
        </div>

      ) : vistaMode==="semana" ? renderSemana
      : agendaFiltrada.length===0 && prospectosHoy.length===0 ? (
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:16,padding:"60px 40px",textAlign:"center"}}>
            <div style={{fontSize:40,opacity:0.2,marginBottom:12}}>📅</div>
            <div style={{color:"var(--text3)",fontSize:14}}>Sin sesiones para este día</div>
            <div style={{color:"var(--border2)",fontSize:12,marginTop:6}}>Navega con ‹ › o selecciona otra fecha</div>
          </div>
        ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>

          {/* FIX #8 — usa prospectosHoy ya computado, no re-filtra inline */}
          {prospectosHoy.map(p=>(
            <div key={p.id} style={{background:"#7C6AF708",border:"0.5px solid #7C6AF730",borderLeft:"3px solid #7C6AF7",borderRadius:12,padding:"14px 18px",display:"grid",gridTemplateColumns:"90px 1fr auto auto",alignItems:"center",gap:14}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:18,fontWeight:700,color:"#7C6AF7",fontFamily:"Syne,sans-serif",lineHeight:1}}>
                  {fmtHora(new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/Lima"}))}
                </div>
                <div style={{fontSize:9,color:"var(--text3)",marginTop:4,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase"}}>Evaluación</div>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:"var(--text)"}}>{p.nombre}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span>📞 {p.telefono}</span>
                  {p.motivo && <span>· {p.motivo}</span>}
                  {p.canal && <span style={{background:"#7C6AF715",color:"#7C6AF7",borderRadius:4,padding:"1px 6px",fontSize:11}}>vía {p.canal}</span>}
                </div>
              </div>
              {(f.esAdmin||f.esMedicoEsp) && (
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"#7C6AF7",display:"inline-block"}}/>
                  <span style={{fontSize:12,color:"var(--text2)"}}>{p.sedes?.nombre||"—"}</span>
                </div>
              )}
              <Badge color="#7C6AF7">Eval.</Badge>
            </div>
          ))}

          {agendaFiltrada.map(s=>{
            const col = ESTADO_COLOR[s.estado]||"var(--border2)";
            const camaraCol = s.estado==="en_curso"?"#F87171":s.estado==="programada"?"#F59E0B":"#10B981";
            const enAccion = accionando===s.id;
            return (
              <div key={s.id} style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderLeft:`3px solid ${col}`,borderRadius:12,padding:"14px 18px",display:"grid",gridTemplateColumns:"90px 1fr 150px 110px",alignItems:"center",gap:14,opacity:s.estado==="cancelada"||s.estado==="no_asistio"?0.55:1,transition:"opacity 0.2s"}}>

                {/* Hora timeline */}
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0}}>
                  <div style={{fontSize:18,fontWeight:700,color:"var(--accent)",fontFamily:"Syne,sans-serif",lineHeight:1}}>{fmtHora(s.hora_inicio)}</div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",margin:"3px 0",gap:1}}>
                    <div style={{width:1,height:7,background:"var(--border2)"}}/>
                    <span style={{fontSize:9,color:"var(--text3)",fontWeight:700,padding:"1px 5px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:4}}>{s.duracion_minutos||60}m</span>
                    <div style={{width:1,height:7,background:"var(--border2)"}}/>
                  </div>
                  <div style={{fontSize:12,color:"var(--text3)",fontWeight:500}}>{fmtHora(s.hora_fin)}</div>
                </div>

                {/* Paciente */}
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--text)",marginBottom:4}}>{s.paciente}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                    <span style={{fontSize:11,color:"var(--text3)"}}>DNI {s.dni} · #{s.numero_sesion}</span>
                    {s.sesiones_restantes != null && (
                      <span style={{fontSize:11,fontWeight:600,color:s.sesiones_restantes===0?"#F87171":s.sesiones_restantes<=2?"#F59E0B":"#10B981",background:s.sesiones_restantes===0?"#F8717115":s.sesiones_restantes<=2?"#F59E0B15":"#10B98115",borderRadius:4,padding:"1px 6px"}}>
                        {s.sesiones_restantes===0?"última":""+s.sesiones_restantes+" rest."}
                      </span>
                    )}
                  </div>
                  {(f.esAdmin||f.esMedicoEsp) && s.sede_nombre && (
                    <div style={{display:"flex",alignItems:"center",gap:5,marginTop:5}}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:getColor(s.sede_nombre),display:"inline-block"}}/>
                      <span style={{fontSize:11,color:"var(--text3)"}}>{s.sede_nombre}</span>
                    </div>
                  )}
                </div>

                {/* Cámara + params */}
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {s.camara_numero ? (
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{width:8,height:8,borderRadius:"50%",background:camaraCol,display:"inline-block",flexShrink:0}}/>
                      <span style={{fontSize:13,color:"var(--text2)",fontWeight:600}}>Cámara #{s.camara_numero}</span>
                    </div>
                  ) : <span style={{fontSize:12,color:"var(--border2)"}}>Sin cámara</span>}
                  <div style={{display:"flex",gap:5}}>
                    <span style={{fontSize:11,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 7px",color:"var(--text3)",fontWeight:600}}>{s.presion_aplicada||"—"} ATA</span>
                    <span style={{fontSize:11,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 7px",color:"var(--text3)",fontWeight:600}}>{s.duracion_minutos||60} min</span>
                  </div>
                </div>

                {/* Estado + acciones — FIX #1 y #6 */}
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
                  <Badge color={col}>{ESTADO_LABEL[s.estado]||s.estado}</Badge>
                  {!s.hc_completada && s.estado==="completada" && <Badge color="#F59E0B">⚠ Sin HC</Badge>}
                  {s.estado==="programada" && (
                    <button
                      disabled={enAccion}
                      onClick={()=>cambiarEstado(s.id,"en_curso")}
                      style={{background:enAccion?"var(--border2)":"#00A89618",border:`1px solid ${enAccion?"var(--border)":"#00A89650"}`,color:enAccion?"var(--text3)":"var(--accent)",fontSize:11,fontWeight:700,cursor:enAccion?"not-allowed":"pointer",padding:"4px 10px",borderRadius:6,fontFamily:"inherit",width:"100%",textAlign:"center",transition:"all 0.15s"}}>
                      {enAccion?"..." : "▶ Iniciar"}
                    </button>
                  )}
                  {s.estado==="en_curso" && (
                    <button
                      disabled={enAccion}
                      onClick={()=>cambiarEstado(s.id,"completada")}
                      style={{background:enAccion?"var(--border2)":"#10B98118",border:`1px solid ${enAccion?"var(--border)":"#10B98150"}`,color:enAccion?"var(--text3)":"#10B981",fontSize:11,fontWeight:700,cursor:enAccion?"not-allowed":"pointer",padding:"4px 10px",borderRadius:6,fontFamily:"inherit",width:"100%",textAlign:"center",transition:"all 0.15s"}}>
                      {enAccion?"..." : "✓ Completar"}
                    </button>
                  )}
                  {s.paciente_id && cambiarVista && (
                    <button onClick={()=>{ localStorage.setItem("oxynatur-hc-paciente", s.paciente_id); cambiarVista("historias"); }}
                      style={{background:"none",border:"none",color:"var(--accent)",fontSize:11,fontWeight:600,cursor:"pointer",padding:"2px 0",fontFamily:"inherit"}}>
                      Ver HC →
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
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
  const busqVentaDebounced = useDebounce(busqVenta, 350);
  const [filtroMetodo, setFiltroMetodo] = useState("todos");
  const [filtroEstadoV, setFiltroEstadoV] = useState("todos");
  const [busqResultados, setBusqResultados] = useState(null);
  const [loadingBusq, setLoadingBusq] = useState(false);
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

  const buscarVentas = async (texto) => {
    if(!texto || texto.trim().length < 2) { setBusqResultados(null); return; }
    setLoadingBusq(true);
    const t = texto.trim();
    // Paso 1: buscar pacientes que coincidan
    const { data: pacs } = await safeQuery(() =>
      supabase.from("pacientes")
        .select("id")
        .or(`nombres.ilike.%${t}%,apellidos.ilike.%${t}%,dni.ilike.%${t}%`)
        .limit(50),
      "Ventas:buscarPacs"
    );
    const ids = (pacs||[]).map(p => p.id);
    // Paso 2: traer compras por paciente_id o numero_comprobante
    const { data } = await safeQuery(() => {
      let q = supabase.from("compras_paciente")
        .select(`id, fecha_compra, monto_pagado, precio_sugerido, descuento_pct,
          estado, promo_aplicada, metodo_pago, notas, numero_comprobante, comprobante_url,
          pacientes(nombres,apellidos,dni), paquetes(codigo,nombre), sedes(nombre,color)`)
        .order("fecha_compra", {ascending:false})
        .limit(100);
      if(ids.length > 0) {
        q = q.or(`paciente_id.in.(${ids.join(",")}),numero_comprobante.ilike.%${t}%`);
      } else {
        q = q.ilike("numero_comprobante", `%${t}%`);
      }
      if(sedeFija) q = q.eq("sede_id", sedeFija);
      return q;
    }, "Ventas:buscarCompras");
    setBusqResultados(data || []);
    setLoadingBusq(false);
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
  const [uploadProgress, setUploadProgress] = useState(null);
  const [err, setErr]           = useState({});
  const [modalEditar, setModalEditar] = useState(null);
  const [formEditar, setFormEditar]   = useState({monto_pagado:"", metodo_pago:"efectivo", notas:"", numero_comprobante:""});
  const [savingEditar, setSavingEditar] = useState(false);

  const abrirEditar = (v) => {
    setFormEditar({
      monto_pagado:       String(v.monto_pagado || ""),
      metodo_pago:        v.metodo_pago || "efectivo",
      notas:              v.notas || "",
      numero_comprobante: v.numero_comprobante || "",
    });
    setModalEditar(v);
  };

  const guardarEdicion = async () => {
    if(!formEditar.monto_pagado || Number(formEditar.monto_pagado) <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    setSavingEditar(true);
    const { error } = await safeQuery(
      () => supabase.from("compras_paciente").update({
        monto_pagado:       Number(formEditar.monto_pagado),
        metodo_pago:        formEditar.metodo_pago,
        notas:              formEditar.notas || null,
        numero_comprobante: formEditar.numero_comprobante || null,
      }).eq("id", modalEditar.id),
      "Ventas:editar"
    );
    setSavingEditar(false);
    if(error) { toast.error("Error al guardar cambios"); return; }
    toast.success("Venta actualizada correctamente");
    setModalEditar(null);
    loadVentas();
  };

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
        toast.error("Error subiendo foto: " + upErr.message);
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
    if(error) { toast.error("Error al guardar la venta"); return; }
    setModal(false);
    toast.success("Venta registrada correctamente");
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
      // Ciclo 26 → 25. Si el dia actual es >=26, el ciclo activo arranca este mes y termina el siguiente.
      const diaActual = now.getDate();
      const offset = diaActual >= 26 ? 0 : -1;
      const desde = new Date(y, m+offset, 26);
      const hasta = new Date(y, m+offset+1, 25);
      return {
        desde: desde.toISOString().slice(0,10),
        hasta: hasta.toISOString().slice(0,10),
        label: `26 ${desde.toLocaleDateString("es-PE",{month:"short"})} → 25 ${hasta.toLocaleDateString("es-PE",{month:"short",year:"numeric"})}`,
      };
    } else if(sedeId === SEDE_SMA) {
      // Ciclo 16 → 15. Si el dia actual es >=16, el ciclo activo arranca este mes y termina el siguiente.
      const diaActual = now.getDate();
      const offset = diaActual >= 16 ? 0 : -1;
      const desde = new Date(y, m+offset, 16);
      const hasta = new Date(y, m+offset+1, 15);
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
      toast.info("No hay ventas en ese rango de fechas.");
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
    const filename = `Oxynatur_Ventas_${nombreSede.replace(/\s/g,"_")}_${exportDesde}_${exportHasta}.xlsx`;
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
                borderColor: filtroSede===s.id ? "var(--accent)" : "var(--border)",
                background:  filtroSede===s.id ? "#F0FDFB" : "none",
                color:       filtroSede===s.id ? "var(--accent)" : "var(--text3)"}}>
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
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"var(--accent)",marginTop:4}}>{fmtSol(totalMes)}</div>
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

      {/* Filtro por fecha + buscador + método pago */}
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
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={filtroMetodo} onChange={e=>setFiltroMetodo(e.target.value)}
            style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:12,fontFamily:"inherit",outline:"none"}}>
            <option value="todos">Todos los métodos</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="yape">Yape</option>
            <option value="plin">Plin</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="kiwi">Kiwi</option>
          </select>
          <select value={filtroEstadoV} onChange={e=>setFiltroEstadoV(e.target.value)}
            style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:12,fontFamily:"inherit",outline:"none"}}>
            <option value="todos">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="agotado">Agotado</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <input type="text" placeholder="Buscar paciente o comprobante..."
            value={busqVenta}
            onChange={e=>{ const v=e.target.value; setBusqVenta(v); if(!v){ setBusqResultados(null); } else { clearTimeout(window._busqVentaTimer); window._busqVentaTimer=setTimeout(()=>buscarVentas(v),400); } }}
            style={{padding:"7px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,fontFamily:"inherit",minWidth:200,outline:"none"}}/>
          {(filtroMetodo!=="todos"||filtroEstadoV!=="todos") && (
            <button onClick={()=>{setFiltroMetodo("todos");setFiltroEstadoV("todos");}}
              style={{padding:"6px 10px",borderRadius:8,border:"0.5px solid var(--accent-mid)",background:"var(--accent-light)",color:"var(--accent)",fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

            {/* Tabla */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"0.5px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--text2)",letterSpacing:"0.02em"}}>
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
        {loadingVentas || loadingBusq ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>Cargando...</div>
        ) : busqResultados !== null && busqResultados.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>Sin resultados para esa búsqueda</div>
        ) : busqResultados === null && ventas.length === 0 ? (
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
                {(busqResultados !== null ? busqResultados : ventas).filter(v=>{
                    if(filtroMetodo!=="todos" && v.metodo_pago!==filtroMetodo) return false;
                    if(filtroEstadoV!=="todos" && v.estado!==filtroEstadoV) return false;
                    return true;
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
                      <td style={{padding:"11px 14px",fontSize:13,fontWeight:600,color:conDesc?"#F59E0B":"var(--accent)"}}>{fmtSol(pag)}</td>
                      <td style={{padding:"11px 14px",fontSize:12,color:"var(--text3)"}}>{v.metodo_pago}</td>
                      <td style={{padding:"11px 14px"}}>
                        {v.comprobante_url
                          ? <a href={v.comprobante_url} target="_blank" rel="noreferrer"
                              style={{fontSize:12,color:"var(--accent)",textDecoration:"none"}}>Ver 📎</a>
                          : <span style={{fontSize:12,color:"var(--border2)"}}>—</span>
                        }
                      </td>
                      <td style={{padding:"11px 14px"}}>
                        {v.estado === "cancelado"
                          ? <span style={{fontSize:11,fontWeight:600,color:"#9CA3AF",background:"var(--surface2)",padding:"3px 8px",borderRadius:6}}>Anulada</span>
                          : f.esAdmin && (
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <button onClick={()=>abrirEditar(v)}
                              style={{background:"none",border:"none",color:"var(--accent)",padding:"4px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,textDecoration:"underline",textDecorationColor:"var(--accent-mid)"}}>
                              Editar
                            </button>
                            <span style={{color:"var(--border2)"}}>·</span>
                            <button onClick={()=>anularVenta(v)}
                              style={{background:"none",border:"none",color:"#EF4444",padding:"4px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,textDecoration:"underline",textDecorationColor:"#FECACA"}}>
                              Anular
                            </button>
                          </div>
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

      {/* Modal editar venta */}
      {modalEditar && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setModalEditar(null)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModalEditar(null)}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:440,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Editar venta</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {modalEditar.pacientes ? `${modalEditar.pacientes.apellidos}, ${modalEditar.pacientes.nombres}` : ""} · {modalEditar.fecha_compra}
                </div>
              </div>
              <button onClick={()=>setModalEditar(null)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            <div style={{background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--text2)"}}>
              <span style={{color:"var(--text3)"}}>Paquete: </span>{modalEditar.paquetes?.nombre || "—"}
              <span style={{color:"var(--text3)",marginLeft:12}}>Precio sugerido: </span>
              <span style={{fontWeight:600,color:"var(--text)"}}>{fmtSol(modalEditar.precio_sugerido||0)}</span>
            </div>

            <Input label="Monto pagado (S/)" value={formEditar.monto_pagado}
              onChange={v=>setFormEditar(f=>({...f,monto_pagado:v}))} type="number" required/>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Método de pago</label>
              <select value={formEditar.metodo_pago} onChange={e=>setFormEditar(f=>({...f,metodo_pago:e.target.value}))}
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="kiwi">Kiwi (cuotas)</option>
              </select>
            </div>

            <Input label="N° comprobante" value={formEditar.numero_comprobante}
              onChange={v=>setFormEditar(f=>({...f,numero_comprobante:v}))} placeholder="B001-0001"/>

            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Notas</label>
              <textarea value={formEditar.notas} onChange={e=>setFormEditar(f=>({...f,notas:e.target.value}))}
                placeholder="Observaciones, acuerdos, etc."
                style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical",minHeight:70}}/>
            </div>

            <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:14,borderTop:"0.5px solid var(--border)"}}>
              <Btn variant="ghost" onClick={()=>setModalEditar(null)} disabled={savingEditar}>Cancelar</Btn>
              <Btn onClick={guardarEdicion} disabled={savingEditar}>{savingEditar?"Guardando...":"Guardar cambios"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva venta */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setModal(false)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:540,boxShadow:"0 20px 60px rgba(0,0,0,0.12)",width:"100%",maxHeight:"92vh",overflowY:"auto",padding:24}}>
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
                <div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,color:"var(--accent)",borderTop:"0.5px solid var(--border)",paddingTop:8,marginTop:8}}>
                  <span>Sugerido</span><span>{fmtSol(calculo.precio_final)}</span>
                </div>
              </div>
            )}

            <Input label="Monto cobrado (S/)" type="number" value={form.monto_pagado}
              onChange={v=>setForm({...form,monto_pagado:v})} placeholder="0.00" required error={err.monto_pagado}/>
            {calculo && form.monto_pagado && Number(form.monto_pagado) !== Number(calculo.precio_final) && (
              <div style={{padding:"8px 12px",background:Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B20":"var(--accent-light)",border:`1px solid ${Number(form.monto_pagado)<Number(calculo.precio_final)?"#F59E0B40":"var(--accent-mid)"}`,borderRadius:8,fontSize:12,color:"var(--text)",marginBottom:14}}>
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
                      style={{flex:1,padding:"8px 12px",borderRadius:10,border:`1.5px solid ${form.segmento===s.value?"var(--accent)":"var(--border)"}`,
                        background:form.segmento===s.value?"#00A89610":"var(--surface)",
                        color:form.segmento===s.value?"var(--accent)":"var(--text2)",
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
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
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
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,cursor:"pointer"}}>
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
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.12)",width:"100%",padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:700,color:"var(--text)"}}>Exportar ventas</div>
              <button onClick={()=>setModalExport(false)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22}}>×</button>
            </div>

            {/* Sede que se va a exportar */}
            <div style={{marginBottom:18,padding:"10px 14px",background:"var(--surface2)",borderRadius:10,fontSize:13,color:"var(--text2)"}}>
              Sede: <strong style={{color:"var(--accent)"}}>
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
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{marginBottom:22}}>
              <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:5}}>Hasta</label>
              <input type="date" value={exportHasta} onChange={e=>setExportHasta(e.target.value)}
                style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
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
    () => supabase.from("sedes").select("nombre").eq("id", sedeId).maybeSingle(),
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

  const kpi = (label, val, color="var(--accent)", sub="") => (
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
          style={{background:"var(--accent)",color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
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
        {kpi("Sesiones completadas", completadas, "var(--accent)")}
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
            {label:"50% Oxynatur",val:fmtS(parteOxynatur),color:"var(--accent)"},
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
                  <td style={{padding:"9px 16px",color:"var(--text2)"}}>{fmtHora(s.hora_inicio)}</td>
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
    programada:"#F59E0B", en_curso:"var(--accent)",
    completada:"#10B981", cancelada:"#F87171", no_asistio:"var(--text3)"
  };
  const ESTADO_LABEL = {
    programada:"Programada", en_curso:"En curso",
    completada:"Completada", cancelada:"Cancelada", no_asistio:"No asistió"
  };

  // Fecha seleccionada — default hoy
  const hoy = fechaHoyLima();
  const [fecha, setFecha]       = useState(hoy);
  const [modoRango, setModoRango] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(hoy);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [filtroEstado, setFiltroEstado] = useState("todos");
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

  // absoluta:true → bloquea el inicio hasta override médico
  const CUESTIONARIO_PRE = [
    {key:"fiebre",           label:"¿Tiene fiebre hoy (≥38°C)?",                               accion:"SUSPENDER — Contraindicación absoluta.", invertido:false, absoluta:true},
    {key:"dolor_oidos",      label:"¿Tiene dolor de oídos o sinusal en este momento?",          accion:"SUSPENDER — Riesgo de barotrauma. Llamar médico.", invertido:false, absoluta:true},
    {key:"resfriado",        label:"¿Está resfriado o con congestión nasal severa?",            accion:"Suspender. Llamar médico.", invertido:false, absoluta:false},
    {key:"alcohol",          label:"¿Consumió alcohol en las últimas 12 horas?",                accion:"SUSPENDER — Riesgo de toxicidad. Llamar médico.", invertido:false, absoluta:true},
    {key:"doxorubicina",     label:"¿Está en quimioterapia con Doxorubicina o Bleomicina?",    accion:"SUSPENDER — Contraindicación absoluta. Llamar al Dr. Aguado.", invertido:false, absoluta:true},
    {key:"medicamento_nuevo",label:"¿Tomó algún medicamento nuevo desde la última sesión?",     accion:"Llamar médico antes de iniciar.", invertido:false, absoluta:false},
    {key:"sintoma_nuevo",    label:"¿Tiene algún síntoma nuevo o cambio en su estado?",         accion:"Llamar médico antes de iniciar.", invertido:false, absoluta:false},
    {key:"comio",            label:"¿Comió al menos 2 horas antes de la sesión?",              accion:"Informar al médico (riesgo hipoglucemia).", invertido:true, absoluta:false},
  ];

  const hayAlertaPre = CUESTIONARIO_PRE.some(q=>{
    const resp = cuestionarioPre[q.key];
    return q.invertido ? resp===false : resp===true;
  });
  // Contraindicación absoluta — bloquea inicio
  const hayContraAbsoluta = CUESTIONARIO_PRE.some(q=>{
    if(!q.absoluta) return false;
    const resp = cuestionarioPre[q.key];
    return q.invertido ? resp===false : resp===true;
  });
  const preguntaAbsoluta = CUESTIONARIO_PRE.find(q=>{
    if(!q.absoluta) return false;
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

  const [overrideAbsoluta, setOverrideAbsoluta] = useState(false);

  const confirmarIniciar = async () => {
    // Bloquear si hay contraindicación absoluta sin override médico
    if(hayContraAbsoluta && !overrideAbsoluta) {
      toast.error("⛔ Contraindicación absoluta detectada. Se requiere autorización médica para continuar.");
      setErrIniciar(`SUSPENDER: ${preguntaAbsoluta?.accion || "Contraindicación absoluta. Llamar al médico."}`);
      setSavingIniciar(false);
      return;
    }

    setSavingIniciar(true);
    setErrIniciar("");

    // Validar rangos de signos vitales
    const alertasSignos = validarSignosPre();
    if(alertasSignos.length > 0) {
      alertasSignos.forEach(a => toast.error("⚠️ " + a));
      await new Promise(r => setTimeout(r, 1000));
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
      autorizado_por:      perfil?.nombre || perfil?.email || null,
      override_medico:     overrideAbsoluta || null,
    }).eq("id", modalIniciar.id), "Sesiones:iniciar");
    setSavingIniciar(false);
    if(error) {
      setErrIniciar(`Error al iniciar: ${error?.message || error?.code || JSON.stringify(error)}`);
      return;
    }
    setModalIniciar(null);
    setCuestionarioPre({});
    setOverrideAbsoluta(false);
    setSignosPre({presion_arterial_pre:"",saturacion_o2_pre:"",frecuencia_cardiaca:"",temperatura:"",peso:"",nivel_dolor:0});
    toast.info("Sesión iniciada");
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
  const { data: sedesData } = useSupabaseQuery(
    () => supabase.from("sedes").select("id,nombre").eq("estado","activo").order("nombre"),
    [], "Sesiones:sedes"
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
      let q = supabase.from("vista_agenda_hoy").select("*").order("fecha").order("hora_inicio");
      if(modoRango) {
        q = q.gte("fecha", fechaDesde).lte("fecha", fechaHasta);
      } else {
        q = q.eq("fecha", fecha);
      }
      if(perfil?.sede_id && !f.esAdmin && !f.esMedicoEsp) q = q.eq("sede_id", perfil.sede_id);
      return q;
    }, "Sesiones:load");
    setSesiones(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [fecha, modoRango, fechaDesde, fechaHasta]); // eslint-disable-line

  // Form nueva sesión
  const sedeDefecto = perfil?.sede_id || "";
  const formInicial = {
    paciente_id:"", camara_id:"", compra_id:"",
    sede_id: sedeDefecto,
    fecha: hoy, hora_inicio:"08:00", hora_fin:"09:00",
    presion_aplicada:"2.0", duracion_minutos:"60",
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
    const sede_id = formNueva.sede_id || pac?.sede_principal_id || perfil?.sede_id;

    const { error } = await safeQuery(() => supabase.from("sesiones").insert({
      paciente_id:       formNueva.paciente_id,
      sede_id,
      camara_id:         formNueva.camara_id,
      compra_id:         formNueva.compra_id || null,
      fecha:             formNueva.fecha,
      hora_inicio:       formNueva.hora_inicio,
      hora_fin:          formNueva.hora_fin,
      presion_aplicada:  parseFloat(formNueva.presion_aplicada) || 2.0,
      duracion_minutos:  parseInt(formNueva.duracion_minutos) || 60,
      numero_sesion:     (() => { const c = comprasData?.find(x=>x.id===formNueva.compra_id) || comprasDelPaciente(formNueva.paciente_id)[0]; return c ? c.sesiones_usadas+1 : 1; })(),
      estado:            "programada",
      enfermero_id:      f.esEnfermero ? perfil.id : null,
      medico_id:         f.esMedico ? perfil.id : null,
    }), "Sesiones:programar");

    setSavingNueva(false);
    if(error) { toast.error("Error al programar la sesión"); return; }
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
    if(error) { toast.error("Error al completar la sesión"); return; }
    toast.success("Sesión completada correctamente");
    setVerSesion(null);
    load();
  };

  const [confirmCancelar, setConfirmCancelar] = useState(null);
  const cancelar = async (sesion) => {
    setConfirmCancelar(sesion);
  };
  const ejecutarCancelar = async () => {
    if(!confirmCancelar) return;
    await safeQuery(() => supabase.from("sesiones").update({ estado:"cancelada" }).eq("id", confirmCancelar.id), "Sesiones:cancelar");
    toast.info("Sesión cancelada");
    setConfirmCancelar(null);
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

  const [exportandoSes, setExportandoSes] = useState(false);

  const exportarSesiones = async () => {
    const lista = filtroEstado === "todos" ? sesiones : sesiones.filter(s => s.estado === filtroEstado);
    if(!lista || lista.length === 0) { toast.info("No hay sesiones para exportar"); return; }
    setExportandoSes(true);
    try {
      await new Promise((res, rej) => {
        if(window.XLSX) return res();
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      const XLSX = window.XLSX;
      const filas = lista.map(s => ({
        "Fecha":          s.fecha || "",
        "Hora inicio":    s.hora_inicio ? fmtHora(s.hora_inicio) : "",
        "Hora fin":       s.hora_fin   ? fmtHora(s.hora_fin)    : "",
        "Paciente":       s.paciente   || "",
        "Sesión #":       s.numero_sesion || "",
        "Cámara":         s.camara_numero ? `Cám #${s.camara_numero}` : "",
        "Presión (ATA)":  s.presion_aplicada || "",
        "Duración (min)": s.duracion_minutos || "",
        "Estado":         s.estado || "",
        "Sede":           s.sede_nombre || "",
        "Observaciones":  s.observaciones || "",
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      ws["!cols"] = [{wch:12},{wch:12},{wch:10},{wch:28},{wch:9},{wch:10},{wch:13},{wch:14},{wch:12},{wch:24},{wch:30}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sesiones");
      const periodo = modoRango ? `${fechaDesde}_${fechaHasta}` : fecha;
      XLSX.writeFile(wb, `Oxynatur_Sesiones_${periodo}.xlsx`);
      toast.success(`${lista.length} sesiones exportadas`);
    } catch(e) {
      toast.error("Error al exportar");
    }
    setExportandoSes(false);
  };

  const comprasDelPaciente = (paciente_id) =>
    (comprasData || []).filter(c => c.paciente_id === paciente_id && c.sesiones_usadas < c.sesiones_totales);

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <h1 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:700,color:"var(--text)",marginBottom:4}}>Sesiones</h1>
          <p style={{color:"var(--text3)",fontSize:14}}>Agenda de sesiones hiperbáricas</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          {sesiones.length > 0 && (
            <Btn variant="ghost" onClick={exportarSesiones} disabled={exportandoSes}
              style={{fontSize:13}}>
              {exportandoSes ? "Exportando..." : "↓ Excel"}
            </Btn>
          )}
          {(f.esAdmin || f.esMedico || f.esEnfermero) && (
            <Btn onClick={()=>setModalNueva(true)}>+ Programar sesión</Btn>
          )}
        </div>
      </div>

      {/* Toolbar de filtros */}
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:20,flexWrap:"wrap"}}>
        {/* Toggle día / rango */}
        <div style={{display:"flex",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",padding:3,gap:2}}>
          {[{k:false,l:"Día"},{k:true,l:"Rango"}].map(({k,l})=>(
            <button key={String(k)} onClick={()=>setModoRango(k)}
              style={{padding:"5px 14px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,
                background:modoRango===k?"var(--accent)":"transparent",
                color:modoRango===k?"white":"var(--text2)",transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>

        {/* Controles de fecha */}
        {!modoRango ? (
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>{ const d=new Date(fecha+"T12:00:00"); d.setDate(d.getDate()-1); setFecha(d.toLocaleDateString("en-CA",{timeZone:"America/Lima"})); }}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 10px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontSize:15,lineHeight:1}}>‹</button>
            <div style={{position:"relative"}}>
              <button onClick={()=>setShowCal(c=>!c)}
                style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text)",
                  padding:"6px 12px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,
                  display:"flex",alignItems:"center",gap:6}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                {new Date(fecha+"T12:00:00").toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"})}
              </button>
              {showCal && (
                <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,zIndex:100}}
                  onMouseLeave={()=>setShowCal(false)}>
                  <MiniCal fecha={fecha} onChange={d=>{ setFecha(d); setShowCal(false); }}/>
                </div>
              )}
            </div>
            <button onClick={()=>{ const d=new Date(fecha+"T12:00:00"); d.setDate(d.getDate()+1); setFecha(d.toLocaleDateString("en-CA",{timeZone:"America/Lima"})); }}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 10px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontSize:15,lineHeight:1}}>›</button>
            <button onClick={()=>setFecha(hoy)}
              style={{background:"var(--accent-light)",border:"0.5px solid var(--accent-mid)",color:"var(--accent)",padding:"6px 10px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500}}>
              Hoy
            </button>
          </div>
        ) : (
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"6px 10px",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
            <span style={{color:"var(--text3)",fontSize:12}}>hasta</span>
            <input type="date" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)}
              style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"6px 10px",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
            {/* Shortcuts */}
            {[
              {l:"Esta semana", fn:()=>{ const d=new Date(); const mon=new Date(d); mon.setDate(d.getDate()-d.getDay()+1); const sun=new Date(mon); sun.setDate(mon.getDate()+6); setFechaDesde(mon.toLocaleDateString("en-CA")); setFechaHasta(sun.toLocaleDateString("en-CA")); }},
              {l:"Este mes",    fn:()=>{ const d=new Date(); setFechaDesde(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`); setFechaHasta(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${new Date(d.getFullYear(),d.getMonth()+1,0).getDate()}`); }},
            ].map(({l,fn})=>(
              <button key={l} onClick={fn}
                style={{background:"var(--surface2)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"6px 10px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:500}}>
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Filtro por estado */}
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}
          style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",marginLeft:"auto"}}>
          <option value="todos">Todos los estados</option>
          <option value="programada">Programada</option>
          <option value="en_curso">En curso</option>
          <option value="completada">Completada</option>
          <option value="cancelada">Cancelada</option>
          <option value="no_asistio">No asistió</option>
        </select>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Total del día",  val:total,      color:"var(--text)"},
          {label:"En curso",       val:enCurso,    color:"var(--accent)"},
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
        ? <div style={{color:"var(--text3)",padding:20}}>Cargando...</div>
        : (()=>{
            const sesionesFiltradas = filtroEstado === "todos"
              ? sesiones
              : sesiones.filter(s => s.estado === filtroEstado);
            if(sesionesFiltradas.length === 0) return (
              <Card style={{textAlign:"center",padding:"50px"}}>
                <div style={{fontSize:36,opacity:.3,marginBottom:12}}>⚡</div>
                <div style={{color:"var(--text3)"}}>No hay sesiones{filtroEstado !== "todos" ? ` con estado "${ESTADO_LABEL[filtroEstado]}"` : " para este período"}</div>
              </Card>
            );
            return (
              <div>
              {sesionesFiltradas.map(s => (
            <div key={s.id} style={{
              background:"var(--surface)", border:"0.5px solid var(--border)",
              borderLeft:`3px solid ${ESTADO_COLOR[s.estado]||"var(--border2)"}`,
              borderRadius:12, padding:"14px 18px", marginBottom:8,
              display:"grid", gridTemplateColumns:"80px 2fr 1fr 1fr 1fr auto",
              alignItems:"center", gap:12,
            }}>
              {/* Hora */}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:700,color:"var(--accent)",fontFamily:"Syne,sans-serif"}}>{fmtHora(s.hora_inicio)}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{fmtHora(s.hora_fin)}</div>
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
                      style={{background:"var(--accent-light)",border:"0.5px solid #00A89640",color:"var(--accent)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
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
                  <button onClick={()=>{ setModalReprog(s); setFormReprog({fecha:fecha,hora_inicio:s.hora_inicio?.slice(0,5)||"08:00",hora_fin:s.hora_fin?.slice(0,5)||"09:00"}); }}
                    style={{background:"#7C6AF720",border:"1px solid #7C6AF740",color:"#7C6AF7",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                    📅 Reprogramar
                  </button>
                )}
                {s.estado === "completada" && (
                  <button onClick={()=>setVerSesion(s)}
                    style={{background:"var(--surface)",border:"0.5px solid var(--border)",color:"var(--text2)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>
                    Ver
                  </button>
                )}
              </div>
            </div>
          ))}
              </div>
            );
        })()}

      {/* Modal programar nueva sesión */}
      {modalNueva && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}
          onKeyDown={e=>e.key==="Escape"&&setModalNueva(false)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModalNueva(false)}>
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

              {/* Select sede — visible solo para admin */}
              {f.esAdmin && (
                <Select label="Sede" value={formNueva.sede_id}
                  onChange={v=>setFormNueva(f=>({...f,sede_id:v,camara_id:""}))}
                  options={(sedesData||[]).map(s=>({value:s.id,label:s.nombre}))} required/>
              )}

              <Select label="Cámara" value={formNueva.camara_id}
                onChange={v=>setFormNueva(f=>({...f,camara_id:v}))}
                options={(camarasData||[])
                  .filter(c => !formNueva.sede_id || c.sede_id === formNueva.sede_id)
                  .map(c=>({value:c.id,label:`Cámara #${c.numero} — ${c.modelo}`}))} required/>
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
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Hora inicio <span style={{color:"#F87171"}}>*</span></label>
                  <select value={formNueva.hora_inicio} onChange={e=>setFormNueva(f=>({...f,hora_inicio:e.target.value}))}
                    style={{width:"100%",background:"var(--surface2)",border:`0.5px solid ${errNueva.hora_inicio?"#F87171":"var(--border)"}`,borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                    {HORA_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {errNueva.hora_inicio && <div style={{fontSize:11,color:"#F87171",marginTop:3}}>{errNueva.hora_inicio}</div>}
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Hora fin estimada</label>
                  <select value={formNueva.hora_fin} onChange={e=>setFormNueva(f=>({...f,hora_fin:e.target.value}))}
                    style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                    {HORA_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <Input label="Presión (ATA)" type="number" value={formNueva.presion_aplicada}
                  onChange={v=>setFormNueva(f=>({...f,presion_aplicada:v}))}/>
                <Input label="Duración (min)" type="number" value={formNueva.duracion_minutos}
                  onChange={v=>setFormNueva(f=>({...f,duracion_minutos:v}))}/>
              </div>
            </div>
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"flex-end",gap:10}}>
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
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Hora inicio <span style={{color:"#F87171"}}>*</span></label>
                <select value={formReprog.hora_inicio} onChange={e=>setFormReprog(f=>({...f,hora_inicio:e.target.value}))}
                  style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                  {HORA_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",fontWeight:500,display:"block",marginBottom:5}}>Hora fin estimada</label>
                <select value={formReprog.hora_fin} onChange={e=>setFormReprog(f=>({...f,hora_fin:e.target.value}))}
                  style={{width:"100%",background:"var(--surface2)",border:"0.5px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                  {HORA_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
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
                <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>
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
                    ["Hora inicio real", fmtHora(verSesion.hora_inicio_real)],
                    ["Hora fin real",    fmtHora(verSesion.hora_fin_real)],
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
                    <div style={{padding:"8px 14px",background:"#00A89608",fontSize:11,fontWeight:700,color:"var(--accent)",letterSpacing:"0.08em",textTransform:"uppercase"}}>
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
                          style={{width:"100%",accentColor:"var(--accent)"}}/>
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
                      style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
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
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"flex-end",gap:10}}>
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
                <div style={{fontSize:11,fontWeight:600,color:"var(--accent)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Checklist de cámara</div>
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
                    <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${checked?"var(--accent)":"var(--border)"}`,
                      background:checked?"var(--accent)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
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
                  style={{background:"var(--accent)",color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer",
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
                        <div style={{background:"var(--accent)",height:"100%",borderRadius:4,width:`${pct}%`,transition:"width 0.3s"}}/>
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
                  const esAbsoluta = q.absoluta && esAlerta;
                  return (
                    <div key={q.key} style={{
                      marginBottom:8,padding:"10px 12px",borderRadius:8,
                      background: esAbsoluta ? "#FEE2E2" : esAlerta ? "#F8717108" : "var(--surface2)",
                      border: `0.5px solid ${esAbsoluta?"#FECACA":esAlerta?"#F8717140":"var(--border)"}`,
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
                        <span style={{fontSize:13,color:"var(--text)",flex:1}}>
                          {q.absoluta && <span style={{fontSize:10,fontWeight:700,color:"#DC2626",background:"#FEE2E2",padding:"1px 5px",borderRadius:4,marginRight:6}}>ABSOLUTA</span>}
                          {q.label}
                        </span>
                        {i+1 === CUESTIONARIO_PRE.length && <span style={{fontSize:10,color:"var(--text3)"}}>(Sí = normal)</span>}
                      </div>
                      {esAlerta && (
                        <div style={{marginTop:6,fontSize:11,color: esAbsoluta ? "#DC2626" : "#F87171",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                          {esAbsoluta ? "⛔" : "⚠"} {q.accion}
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
                <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
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
                {Object.keys(cuestionarioPre).length}/8 preguntas respondidas
                {hayContraAbsoluta && (
                  <div style={{marginTop:12,background:"#FEE2E2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#DC2626",marginBottom:4}}>
                      ⛔ CONTRAINDICACIÓN ABSOLUTA DETECTADA
                    </div>
                    <div style={{fontSize:12,color:"#991B1B",marginBottom:8}}>
                      {preguntaAbsoluta?.accion}
                    </div>
                    {!overrideAbsoluta ? (
                      <div>
                        <div style={{fontSize:11,color:"#7F1D1D",marginBottom:8}}>
                          La sesión está BLOQUEADA. Solo un médico puede autorizar el inicio documentando la justificación clínica.
                        </div>
                        <button onClick={()=>setOverrideAbsoluta(true)}
                          style={{background:"#DC2626",color:"white",border:"none",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                          Autorizar como médico responsable
                        </button>
                      </div>
                    ) : (
                      <div style={{display:"flex",alignItems:"center",gap:8,background:"#FEF3C7",borderRadius:6,padding:"6px 10px"}}>
                        <span style={{fontSize:12,color:"#92400E",fontWeight:600}}>⚠️ Override médico activo — proceder con máxima precaución</span>
                        <button onClick={()=>setOverrideAbsoluta(false)}
                          style={{background:"none",border:"none",color:"#92400E",cursor:"pointer",fontSize:11,textDecoration:"underline"}}>
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:8}}>
                <Btn variant="ghost" onClick={()=>setModalIniciar(null)}>Cancelar</Btn>
                <Btn onClick={confirmarIniciar} disabled={savingIniciar||Object.keys(cuestionarioPre).length<8}
                  style={{background: hayAlertaPre?"#F59E0B":"var(--accent)"}}>
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

      {/* Modal confirmación cancelar sesión */}
      {confirmCancelar && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9000,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setConfirmCancelar(null)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setConfirmCancelar(null)}>
          <div style={{background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:14,maxWidth:380,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:"#FEE2E2",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            </div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:6}}>¿Cancelar esta sesión?</div>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:6}}>{confirmCancelar.paciente}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>
              {confirmCancelar.fecha} · {fmtHora(confirmCancelar.hora_inicio)} · {confirmCancelar.sede_nombre}
            </div>
            <div style={{fontSize:12,color:"#DC2626",background:"#FEE2E2",borderRadius:"var(--radius-sm)",padding:"8px 12px",marginBottom:20}}>
              Esta acción no se puede deshacer.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="ghost" onClick={()=>setConfirmCancelar(null)}>Volver</Btn>
              <Btn variant="danger" onClick={ejecutarCancelar}>Sí, cancelar sesión</Btn>
            </div>
          </div>
        </div>
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
      <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12,paddingTop:20,borderTop:"0.5px solid var(--border)"}}>
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
    if(error) { toast.error("Error al guardar respuesta"); return; }
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
    if(error) { toast.error("Error al crear alerta"); return; }
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
              borderColor:filtroEstado===f.id?"var(--accent)":"var(--border)",
              background:filtroEstado===f.id?"#F0FDFB":"none",
              color:filtroEstado===f.id?"var(--accent)":"var(--text3)"}}>
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
              onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent-mid)"}
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
                <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
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
                    style={{width:"100%",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:10,color:"var(--text)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",resize:"vertical"}}
                  />
                </div>
              )}
            </div>

            {/* Footer modal */}
            <div style={{padding:"14px 24px",borderTop:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}
          onKeyDown={e=>e.key==="Escape"&&setModalNueva(false)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModalNueva(false)}>
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
    nuevo:"#7C6AF7", contactado:"var(--accent)",
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
          .select("*, sedes(nombre), creador:perfiles!creado_por(nombre)")
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
        creado_por: perfil?.id || null,
      }), "Prospectos:insert"
    );
    setSaving(false);
    if(error){ setErr({general:"Error al guardar"}); toast.error("Error al guardar el prospecto"); return; }
    setModal(false);
    setForm(formInicial);
    setErr({});
    toast.success("Prospecto registrado correctamente");
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
      }).select().maybeSingle(), "Prospectos:convertir"
    );

    let pacienteId = pac?.id;

    if(error || !pac) {
      // Si el error es DNI duplicado, buscar el paciente existente y vincularlo
      if(error?.code === "23505") {
        const { data: pacExistente } = await safeQuery(() =>
          supabase.from("pacientes").select("id").eq("dni", convertForm.dni.trim()).maybeSingle(),
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
    toast.success(`${convertForm.nombres} ${convertForm.apellidos} vinculado como paciente`);
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
    { label:"Nuevos",       val: prospectos.filter(p=>p.estado==="nuevo").length,             color:"var(--accent)" },
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
              borderColor: filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"var(--accent)") : "var(--border)",
              background:  filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"var(--accent)")+"15" : "none",
              color:       filtroEstado===e.id ? (ESTADO_COLOR[e.id]||"var(--accent)") : "var(--text3)"}}>
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
                            📅 {new Date(p.fecha_cita).toLocaleDateString("es-PE",{timeZone:"America/Lima"})} {fmtHora(new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/Lima"}))}
                          </span>
                        : p.fecha_ultimo_contacto ? new Date(p.fecha_ultimo_contacto).toLocaleDateString("es-PE") : "—"}
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      <button onClick={()=>{ setModalVer(p); setEditFecha(p.fecha_cita ? toLocalInput(p.fecha_cita) : ""); cargarActividades(p.id); }}
                        style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:12,fontWeight:600}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setModal(false)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModal(false)}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:20}}
          onKeyDown={e=>e.key==="Escape"&&setModalVer(null)} tabIndex={-1}
          onClick={e=>e.target===e.currentTarget&&setModalVer(null)}>
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
                ["Registrado por", modalVer.creador?.nombre || "—"],

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
                    const tipoColor = {cambio_estado:"var(--accent)",nota:"#6366F1",llamada:"#F59E0B",whatsapp:"#10B981",email:"#3B82F6",sistema:"#9CA3AF"}[act.tipo]||"#9CA3AF";
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
      el.textContent = `:root{--bg:#080E1A;--surface:#0E1525;--surface2:#162030;--border:#1E2D42;--border2:#2A3D56;--text:#EEF2F7;--text2:#8FA3BC;--text3:#5A7090;--accent:#00BFA8;--accent-light:rgba(0,191,168,0.12);--accent-mid:rgba(0,191,168,0.20);--radius-sm:8px;--radius-md:12px;--radius-lg:16px}`;
    } else {
      el.textContent = `:root{--bg:#F0F4F8;--surface:#FFFFFF;--surface2:#F7F9FC;--border:#E8EDF3;--border2:#CDD5DF;--text:#0D1829;--text2:#4A5568;--text3:#8A97A8;--accent:#00A896;--accent-light:rgba(0,168,150,0.10);--accent-mid:rgba(0,168,150,0.18);--radius-sm:8px;--radius-md:12px;--radius-lg:16px}`;
    }
  }, [darkMode]);

  useEffect(()=>{
    let mounted = true;
    let loadedUserId = null;
    let inFlightUserId = null;
    let vistaRestaurada = false;

    const loadPerfil = async (userId) => {
      try {
        const {data, error} = await supabase.from("perfiles").select("*").eq("id", userId).maybeSingle();
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
      // Auth event logged
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
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",background:"var(--bg)",minHeight:"100vh",color:"var(--text)",width:"100%"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet"/>
      <ToastContainer/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#F0F4F8;--surface:#FFFFFF;--surface2:#F7F9FC;--border:#E8EDF3;--border2:#CDD5DF;--text:#0D1829;--text2:#4A5568;--text3:#8A97A8;--accent:#00A896;--accent-light:rgba(0,168,150,0.10);--accent-mid:rgba(0,168,150,0.18);--radius-sm:8px;--radius-md:12px;--radius-lg:16px}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}::-webkit-scrollbar-track{background:transparent}select option{background:var(--surface)}input::placeholder{color:var(--text3)}textarea::placeholder{color:var(--text3)}textarea{box-sizing:border-box}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`}</style>
      <div style={{display:"flex",minHeight:"100vh",width:"100%"}}>
        <Sidebar vista={vista} setVista={cambiarVista} perfil={perfil} onLogout={handleLogout} alertasNuevas={alertasNuevas} darkMode={darkMode} setDarkMode={setDarkMode}/>
        <div style={{flex:1,overflow:"auto",padding:"30px 36px",background:"var(--bg)"}}>
          {renderVista()}
        </div>
      </div>
    </div>
  );
}
