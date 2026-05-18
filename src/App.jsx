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

// Admin client con service_role — solo para crear/eliminar usuarios
const SUPABASE_SERVICE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_KEY;
const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

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
  const esMedicoEsp  = esMedico && esEspecialista;
  const esMedicoSede = esMedico && !esEspecialista;

  return {
    // ── Identidad ──
    esAdmin, esMedico, esEnfermero, esATC, esMedicoEsp, esMedicoSede,

    // ── Acceso a módulos ──
    puedeVerDashboard:    esAdmin || esMedico,
    puedeVerVentas:       esAdmin || esEnfermero,
    puedeVerFinanzas:     esAdmin,
    puedeVerSedes:        esAdmin,
    puedeVerUsuarios:     esAdmin,
    puedeVerAlertas:      esAdmin || esMedico,
    puedeVerProspectos:   esAdmin || esATC,

    // ── Restricciones dentro de Ventas ──
    ventasSoloSuSede:     esEnfermero,

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
            : esATC        ? "ATC"
            : "Usuario",

    vistaDefault: esAdmin  ? "dashboard"
                : esMedico ? "alertas"
                : esATC    ? "prospectos"
                : "agenda",
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
      style={{width:"100%",background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:value?"var(--text)":"var(--text3)",padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none"}}>
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
        safeQuery(()=> supabase.from("evaluaciones_medicas")
          .select(`id,numero_sesion,fecha,hora,evolucion,incidencias,observaciones,
            presion_arterial,frecuencia_cardiaca,saturacion_o2,temperatura,peso,nivel_dolor,estado_general,
            presion_indicada,duracion_minutos,otitis,claustrofobia,embarazo,fiebre_activa,
            pacientes(nombres,apellidos,dni),sedes(nombre),compras_paciente(paquetes(nombre))`)
          .eq("es_borrador", true)
          .order("fecha",{ascending:true})
          .order("hora",{ascending:true})
          .limit(50), "DashMed:firmasPend"),
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
      if(viejos.length > 0 && mounted){
        // Crear alerta automática si no existe ya
        await safeQuery(()=> supabase.from("alertas_clinicas").insert(
          viejos.slice(0,3).map(e=>({
            paciente_id:  e.pacientes?.id || null,
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
        nombres:   formEditar.nombres,
        apellidos: formEditar.apellidos,
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
                <Input label="Nombres" value={formEditar.nombres} onChange={v=>setFormEditar(f=>({...f,nombres:v}))} required/>
                <Input label="Apellidos" value={formEditar.apellidos} onChange={v=>setFormEditar(f=>({...f,apellidos:v}))} required/>
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
              </div>
            ))}
            {filtrados.length===0 && <div style={{color:"var(--text3)",textAlign:"center",padding:"40px 0",fontSize:14}}>No se encontraron pacientes</div>}
          </>
        )
      }
      {modal && f.puedeCrearPaciente && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"var(--bg)",border:"1px solid #2A3550",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",borderBottom:"0.5px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"Syne,sans-serif",fontSize:17,fontWeight:700,color:"var(--text)"}}>Nuevo Paciente</div>
              <button onClick={()=>setModal(false)} style={{background:"var(--surface2)",border:"none",color:"var(--text2)",cursor:"pointer",padding:"5px 12px",borderRadius:8,fontSize:18}}>×</button>
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
    // Cargar jsPDF dinámicamente
    await new Promise((res,rej)=>{
      if(window.jspdf) return res();
      const s = document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
    const { jsPDF } = window.jspdf;
    // Normalizar caracteres especiales para jsPDF (no soporta UTF-8 nativo)
    const norm = (str) => (str||"")
      .replace(/á/g,"a").replace(/é/g,"e").replace(/í/g,"i").replace(/ó/g,"o").replace(/ú/g,"u")
      .replace(/Á/g,"A").replace(/É/g,"E").replace(/Í/g,"I").replace(/Ó/g,"O").replace(/Ú/g,"U")
      .replace(/ñ/g,"n").replace(/Ñ/g,"N").replace(/ü/g,"u").replace(/Ü/g,"U")
      .replace(/[^ -]/g,"?");
    const doc = new jsPDF();
    const pac = pacSelec.pacientes;
    const hc  = hcMaestra;
    let y = 20;
    const nl = (h=8) => { y+=h; if(y>270){doc.addPage();y=20;} };
    const txt = (text,x,size=11,bold=false,color=[30,30,30]) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", bold?"bold":"normal");
      doc.setTextColor(...color);
      doc.text(String(text||""),x,y);
    };
    const line = (x1,x2) => { doc.setDrawColor(200,200,200); doc.line(x1,y,x2,y); nl(6); };

    // Header
    doc.setFillColor(0,168,150);
    doc.rect(0,0,210,18,"F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(16);
    doc.setTextColor(255,255,255);
    doc.text("OxyNatur - Historia Clinica",14,12);
    y=28;

    // Datos paciente
    txt(`${norm(pac?.nombres)} ${norm(pac?.apellidos)}`,14,14,true,[0,100,90]); nl(7);
    txt(`DNI: ${pac?.dni||"-"}  |  Sede: ${norm(pacSelec.sedes?.nombre||"-")}  |  Sesiones: ${pac?.sesiones_realizadas||0}/${pac?.total_sesiones_prescritas||0}`,14,10); nl(6);
    txt(`Apto HBOT: ${hc?.apto_hiperbarica!==false?"SI":"NO"}  |  Fecha emision: ${new Date().toLocaleDateString("es-PE")}`,14,10); nl(4);
    line(14,196);

    // HC Maestra
    txt("HISTORIA CLINICA MAESTRA",14,12,true,[0,100,90]); nl(7);
    const campos = [
      ["Diagnostico principal",hc?.diagnostico_principal],
      ["Antecedentes personales",hc?.antecedentes_personales],
      ["Antecedentes familiares",hc?.antecedentes_familiares],
      ["Alergias",hc?.alergias],
      ["Medicamentos habituales",hc?.medicamentos_habituales],
      ["Contraindicaciones",hc?.contraindicaciones],
    ];
    campos.forEach(([label,val])=>{
      if(!val) return;
      txt(norm(label)+":",14,10,true); nl(5);
      const lines = doc.splitTextToSize(norm(val),175);
      lines.forEach(l=>{ txt(l,18,10); nl(5); });
      nl(2);
    });
    line(14,196);

    // Evaluaciones
    txt("EVALUACIONES POR SESION",14,12,true,[0,100,90]); nl(7);
    evals.slice(0,20).forEach((ev,i)=>{
      if(y>240){doc.addPage();y=20;}
      doc.setFillColor(248,250,252);
      doc.rect(14,y-4,182,22,"F");
      txt(`Sesion #${ev.numero_sesion} - ${ev.fecha} - ${norm(ev.sedes?.nombre||"")}`,16,10,true); nl(5);
      txt(`PA: ${ev.presion_arterial||"-"}  FC: ${ev.frecuencia_cardiaca||"-"}  Sat: ${ev.saturacion_o2||"-"}%  Peso: ${ev.peso||"-"}kg`,16,9); nl(5);
      txt(`Estado: ${norm(ev.estado_general||"-")}  Dolor: ${ev.nivel_dolor}/10  Duracion: ${ev.duracion_minutos}min  Presion: ${ev.presion_indicada}ATA`,16,9); nl(5);
      if(ev.firma_medico){ txt(`Firmado por: ${norm(ev.firma_medico)}`,16,9,true); nl(5); }
      if(ev.es_borrador){ txt("BORRADOR - sin firma medica",16,9,false,[220,100,0]); nl(5); }
      nl(4);
    });

    const filename = `HC_${pac?.apellidos}_${pac?.nombres}_${new Date().toISOString().slice(0,10)}.pdf`;
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
      contraindicaciones_screening: hc.contraindicaciones_screening || {},
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
    await safeQuery(()=>
      supabase.from("evaluaciones_medicas").update({
        evolucion:    firmaModal.evolucionEdit || firmaModal.evolucion || "",
        firma_medico: firmaTexto.trim(),
        es_borrador:  false,
        medico_id:    perfil.id,
      }).eq("id", firmaModal.id),
      "HC:firmar"
    );
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
          {(f.esEnfermero || f.esMedico || f.esAdmin) && (
            <Btn onClick={()=>{ setFormEval(evalInicial); setErrEval({}); setModalNuevaEval(true); }}>
              + Nueva evaluación
            </Btn>
          )}
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
            </div>            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
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
        </div>
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
                            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:ev.evolucion?8:0}}>
                              {[
                                ["PA",    ev.presion_arterial],
                                ["FC",    ev.frecuencia_cardiaca],
                                ["SatO₂", ev.saturacion_o2],
                                ["Dolor", ev.nivel_dolor!=null?`${ev.nivel_dolor}/10`:null],
                                ["Estado",ev.estado_general],
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
      <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar paciente..."
        style={{background:"var(--surface)",border:"0.5px solid #E2E8F0",borderRadius:10,color:"var(--text)",padding:"10px 16px",fontSize:14,fontFamily:"inherit",outline:"none",width:300,marginBottom:16}}/>

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
  const porMetodo = ["efectivo","transferencia","tarjeta","yape","plin"].map(m=>{
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
    if(!supabaseAdmin){setMsg("Error: service key no configurada");return;}
    setSaving(true); setMsg("");
    const sedeId = form.rol==="medico" && form.es_especialista ? null : (form.sede_id||null);
    // 1. Crear auth.user con Admin API (sin confirmación de email)
    const {data, error} = await supabaseAdmin.auth.admin.createUser({
      email: form.email,
      password: form.password,
      email_confirm: true,
    });
    if(error){setMsg("Error: "+error.message);setSaving(false);return;}
    const uid = data.user.id;
    // 2. Actualizar el perfil que el trigger creó automáticamente
    const {error: e2} = await supabaseAdmin.from("perfiles").update({
      nombre: form.nombre,
      rol: form.rol,
      es_especialista: form.rol==="medico" ? form.es_especialista : false,
      sede_id: sedeId,
      email: form.email,
      activo: true,
    }).eq("id", uid);
    if(e2){setMsg("Usuario creado pero error en perfil: "+e2.message);setSaving(false);return;}
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
              options={[{value:"admin_general",label:"Admin General"},{value:"medico",label:"Médico"},{value:"enfermero",label:"Enfermero"},{value:"atc",label:"ATC"}]}/>
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
              options={[{value:"admin_general",label:"Admin General"},{value:"medico",label:"Médico"},{value:"enfermero",label:"Enfermero"},{value:"atc",label:"ATC"}]}/>
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
      .select("*, paquetes_precios(sede_id, precio, sesiones_incluidas)")
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

  const loadVentas = async (sedeId) => {
    setLoadingVentas(true);
    const sedeActiva = sedeId !== undefined ? sedeId : filtroSede;
    const { data } = await safeQuery(() => {
      let q = supabase.from("compras_paciente")
        .select(`
          id, fecha_compra, monto_pagado, precio_sugerido, descuento_pct,
          estado, promo_aplicada, metodo_pago, notas, numero_comprobante, comprobante_url,
          pacientes(nombres,apellidos,dni),
          paquetes(codigo,nombre),
          sedes(nombre,color)
        `)
        .order("fecha_compra", {ascending:false})
        .limit(50);
      if(sedeFija) q = q.eq("sede_id", sedeFija);
      else if(sedeActiva !== "todas") q = q.eq("sede_id", sedeActiva);
      return q;
    }, "Ventas:loadVentas");
    setVentas(data || []);
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
    monto_pagado:"", metodo_pago:"efectivo", notas:"",
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
  const ventasMes   = ventas.filter(v => (v.fecha_compra||"").startsWith(hoyMes) && v.estado !== "cancelado");
  const totalMes    = ventasMes.reduce((a,v)=>a+Number(v.monto_pagado||0), 0);
  const descuentosMes = ventasMes.reduce((a,v)=>a+Math.max(Number(v.precio_sugerido||0)-Number(v.monto_pagado||0),0), 0);
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
            <button key={s.id} onClick={()=>{ setFiltroSede(s.id); loadVentas(s.id); }}
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
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>Ventas del mes</div>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:700,color:"#00A896",marginTop:8}}>{fmtSol(totalMes)}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{ventasMes.length} ventas</div>
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

      {/* Tabla */}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"0.5px solid #E2E8F0",fontSize:12,fontWeight:600,color:"var(--text2)",letterSpacing:"0.02em"}}>Últimas ventas</div>
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
                {ventas.map(v=>{
                  const sug = Number(v.precio_sugerido||0);
                  const pag = Number(v.monto_pagado||0);
                  const conDesc = sug > 0 && pag < sug;
                  return (
                    <tr key={v.id} style={{borderTop:"0.5px solid #E2E8F0"}}>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text2)"}}>{v.fecha_compra}</td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text)",fontWeight:600}}>
                        {v.numero_comprobante || <span style={{color:"var(--text3)"}}>—</span>}
                      </td>
                      <td style={{padding:"11px 14px",fontSize:13,color:"var(--text)"}}>
                        {v.pacientes ? `${v.pacientes.nombres} ${v.pacientes.apellidos}` : "—"}
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
                        {f.esAdmin && v.estado !== "cancelado" && (
                          <button onClick={()=>anularVenta(v)}
                            style={{background:"none",border:"none",color:"#EF4444",padding:"4px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,textDecoration:"underline",textDecorationColor:"#FECACA"}}>
                            Anular
                          </button>
                        )}
                        {v.estado === "cancelado" && <span style={{fontSize:11,color:"var(--text3)"}}>Anulada</span>}
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

            <Select label="Paciente" value={form.paciente_id} onChange={v=>setForm({...form,paciente_id:v})}
              options={(pacientesData||[]).map(p=>({value:p.id,label:`${p.apellidos}, ${p.nombres}${p.dni?` — DNI ${p.dni}`:""}`}))} required/>
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
              options={(paquetesData||[]).map(p=>{
                const precioSede = p.paquetes_precios?.find(pp=>pp.sede_id===form.sede_id);
                const precio = precioSede ? precioSede.precio : p.precio_total;
                return {value:p.id, label:`${p.codigo} — ${p.nombre} — ${fmtSol(precio)}`};
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
              options={[{value:"efectivo",label:"Efectivo"},{value:"transferencia",label:"Transferencia"},{value:"tarjeta",label:"Tarjeta"},{value:"yape",label:"Yape / Plin"},{value:"otro",label:"Otro"}]}/>

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
  const [showCal, setShowCal] = useState(false);

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
      numero_sesion:     formNueva.numero_sesion ? parseInt(formNueva.numero_sesion) : (() => { const c = comprasData?.find(x=>x.id===formNueva.compra_id); return c ? c.sesiones_usadas+1 : 1; })(),
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
                    <button onClick={()=>iniciar(s)}
                      style={{background:"#00C4B420",border:"1px solid #00C4B440",color:"#00A896",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
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
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                    <Input label="Hora inicio real" type="time" value={formCompletar.hora_inicio_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_inicio_real:v}))}/>
                    <Input label="Hora fin real" type="time" value={formCompletar.hora_fin_real}
                      onChange={v=>setFormCompletar(f=>({...f,hora_fin_real:v}))}/>
                  </div>

                  {/* Nivel de dolor */}
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"var(--text2)",fontWeight:600,display:"block",marginBottom:8}}>
                      Nivel de dolor: <span style={{color: formCompletar.nivel_dolor>=7?"#F87171":formCompletar.nivel_dolor>=4?"#F59E0B":"#10B981",fontWeight:700}}>{formCompletar.nivel_dolor}/10</span>
                    </label>
                    <input type="range" min="0" max="10" value={formCompletar.nivel_dolor}
                      onChange={e=>setFormCompletar(f=>({...f,nivel_dolor:parseInt(e.target.value)}))}
                      style={{width:"100%",accentColor:"#00A896"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:2}}>
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
  const ESTADOS = ["nuevo","contactado","evaluacion_agendada","convertido","perdido"];
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
      safeQuery(() => supabase.from("prospectos")
        .select("*, sedes(nombre)")
        .order("created_at", {ascending:false}), "Prospectos:load"),
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
        nombre: form.nombre.trim(),
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
    // Prellenar nombres/apellidos inteligentemente
    const partes = modalVer.nombre.trim().split(" ");
    let nombres = "", apellidos = "";
    if(partes.length === 1) { nombres = partes[0]; apellidos = ""; }
    else if(partes.length === 2) { nombres = partes[0]; apellidos = partes[1]; }
    else if(partes.length === 3) { nombres = partes[0]; apellidos = partes.slice(1).join(" "); }
    else { nombres = partes.slice(0,2).join(" "); apellidos = partes.slice(2).join(" "); }
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

    if(error || !pac) {
      setConvertErr({general: "Error al crear el paciente. Verificá que el DNI no esté duplicado."});
      setConvirtiendo(false);
      return;
    }

    await safeQuery(() =>
      supabase.from("prospectos").update({
        estado: "convertido",
        convertido_paciente_id: pac.id,
        updated_at: new Date().toISOString(),
      }).eq("id", modalVer.id), "Prospectos:vincular"
    );

    setConvirtiendo(false);
    setShowConvertForm(false);
    setModalVer(null);
    load();
    alert(`✅ ${convertForm.nombres} ${convertForm.apellidos} fue registrado como paciente. Ya podés agendar sus sesiones.`);
  };

  const cambiarEstado = async (id, nuevoEstado) => {
    await safeQuery(() =>
      supabase.from("prospectos").update({
        estado: nuevoEstado,
        fecha_ultimo_contacto: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id), "Prospectos:update"
    );
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
                      <select value={p.estado} onChange={e=>cambiarEstado(p.id, e.target.value)}
                        style={{background:ESTADO_COLOR[p.estado]+"15",border:`0.5px solid ${ESTADO_COLOR[p.estado]}`,
                          color:ESTADO_COLOR[p.estado],borderRadius:20,padding:"3px 10px",fontSize:11,
                          fontWeight:600,cursor:"pointer",fontFamily:"inherit",outline:"none"}}>
                        {ESTADOS.map(e=>(
                          <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{padding:"11px 14px",fontSize:11,color:"var(--text3)"}}>
                      {p.estado === "evaluacion_agendada" && p.fecha_cita
                        ? <span style={{color:"#F59E0B",fontWeight:600}}>
                            📅 {new Date(p.fecha_cita).toLocaleDateString("es-PE",{timeZone:"America/Lima"})} {new Date(p.fecha_cita).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Lima"})}
                          </span>
                        : p.fecha_ultimo_contacto ? new Date(p.fecha_ultimo_contacto).toLocaleDateString("es-PE") : "—"}
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      <button onClick={()=>{ setModalVer(p); setEditFecha(p.fecha_cita ? toLocalInput(p.fecha_cita) : ""); }}
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

            <Input label="Nombre completo" value={form.nombre} onChange={v=>setForm(f=>({...f,nombre:v}))} required error={err.nombre}/>
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
