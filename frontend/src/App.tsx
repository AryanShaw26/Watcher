import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, Area, CartesianGrid, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import { useAuth } from './auth/AuthContext';
import { login, logout, register } from './api/auth';
import { monitorApi, type Monitor, type MonitorInput } from './api/monitors';
import { setAccessToken } from './api/client';
import { StatusBadge, statusFor } from './components/StatusBadge';
import { PipelineCard } from './components/PipelineCard';

function AuthPage({mode}:{mode:'login'|'register'}) {
  const {setSession,status} = useAuth();
  const navigate = useNavigate();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  async function submit(event:FormEvent) {
    event.preventDefault(); setError('');
    if (!email.includes('@')) { setError('Enter a valid email address'); return; }
    if (password.length < 10 || password.length > 72) { setError('Password must be 10 to 72 characters'); return; }
    try {
      const result = mode === 'login' ? await login(email,password) : await register(email,password);
      setSession(result.accessToken,result.user);
      navigate('/dashboard');
    } catch (cause) {
      if (axios.isAxiosError(cause)) setError(cause.response?.data?.error?.message || 'Request failed');
    }
  }
  return <main className="auth-shell">
    <div className="auth-card clay-panel">
      <div className="brand"><span className="brand-orb" /> <span>Watcher</span></div>
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      <p className="tagline">Your APIs. Always in Sight.</p>
      <form onSubmit={submit}>
        <label>Email<input className="clay-well" type="email" value={email} onChange={(event)=>setEmail(event.target.value)} /></label>
        <label>Password
          <div className="password-wrap"><input className="clay-well" type={showPassword?'text':'password'} value={password} onChange={(event)=>setPassword(event.target.value)} /><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?'Hide':'Show'}</button></div>
        </label>
        {error && <p className="error" role="alert">! {error}</p>}
        <button className="primary full" type="submit">{mode === 'login'?'Log in':'Create account'}</button>
      </form>
      <button className="ghost link" onClick={()=>navigate(mode==='login'?'/register':'/login')}>{mode==='login'?'New here? Create an account':'Already have an account? Log in'}</button>
    </div>
  </main>;
}

function Protected({children}:{children:React.ReactNode}) {
  const {status} = useAuth();
  if (status === 'loading') return <main className="loader">Loading Watcher...</main>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function TopBar() {
  const {user,clearSession} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await logout().catch(()=>undefined);
    clearSession(); setAccessToken(null); queryClient.clear(); navigate('/login');
  }
  return <header className="topbar clay-panel"><button className="brand ghost" onClick={()=>navigate('/dashboard')}><span className="brand-orb" /><span>Watcher</span></button><div className="top-actions"><span className="user-email">{user?.email}</span><button className="ghost" onClick={signOut}>Log out</button></div></header>;
}

function MonitorForm({monitor,onClose}:{monitor?:Monitor;onClose:()=>void}) {
  const queryClient = useQueryClient();
  const [error,setError] = useState('');
  const [form,setForm] = useState<MonitorInput>({
    name:monitor?.name||'',url:monitor?.url||'',method:monitor?.method||'GET',
    intervalSeconds:monitor?.intervalSeconds||300,expectedStatusCode:monitor?.expectedStatusCode||200,timeoutMs:monitor?.timeoutMs||10000
  });
  const mutation = useMutation({
    mutationFn:()=>monitor?monitorApi.update(monitor.id,form):monitorApi.create(form),
    onSuccess:()=>{queryClient.invalidateQueries({queryKey:['monitors']});onClose();},
    onError:(cause) => {
      if (axios.isAxiosError(cause)) {
        const code = cause.response?.data?.error?.code;
        setError(code==='URL_NOT_ALLOWED'?'Watcher can only check public web addresses. Use an https:// URL reachable from the internet.':code==='MONITOR_LIMIT_REACHED'?"You've reached the limit of 10 monitors. Delete one to add another.":cause.response?.data?.error?.message||'Could not save monitor');
      }
    }
  });
  return <div className="modal-overlay" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="modal clay-panel" role="dialog" aria-modal="true" aria-labelledby="monitor-form-title">
      <h2 id="monitor-form-title">{monitor?'Edit monitor':'Add monitor'}</h2>
      <form onSubmit={(event)=>{event.preventDefault();mutation.mutate();}}>
        <label>Name<input className="clay-well" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required maxLength={100}/></label>
        <label>URL<input className="clay-well" type="url" value={form.url} onChange={(e)=>setForm({...form,url:e.target.value})} required maxLength={2048}/></label>
        <div className="form-grid">
          <label>Method<select className="clay-well" value={form.method} onChange={(e)=>setForm({...form,method:e.target.value as 'GET'|'HEAD'})}><option>GET</option><option>HEAD</option></select></label>
          <label>Interval<select className="clay-well" value={form.intervalSeconds} onChange={(e)=>setForm({...form,intervalSeconds:Number(e.target.value)})}>{[60,300,600,900,1800,3600].map(v=><option key={v} value={v}>{v===60?'1 minute':`${v/60} minutes`}</option>)}</select></label>
          <label>Expected status<input className="clay-well" type="number" min={100} max={599} value={form.expectedStatusCode} onChange={(e)=>setForm({...form,expectedStatusCode:Number(e.target.value)})}/></label>
          <label>Timeout (ms)<input className="clay-well" type="number" min={1000} max={30000} value={form.timeoutMs} onChange={(e)=>setForm({...form,timeoutMs:Number(e.target.value)})}/></label>
        </div>
        {error&&<p className="error" role="alert">! {error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={mutation.isPending}>{monitor?'Save changes':'Add monitor'}</button></div>
      </form>
    </div>
  </div>;
}

function relativeTime(value:string|null) {
  if (!value) return 'Never';
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));
  if(seconds<60)return `${seconds}s ago`; if(seconds<3600)return `${Math.floor(seconds/60)}m ago`; return `${Math.floor(seconds/3600)}h ago`;
}

function MonitorCard({monitor}:{monitor:Monitor}) {
  const navigate=useNavigate();
  const state=statusFor(monitor);
  return <button className="monitor-card clay-card" onClick={()=>navigate(`/monitors/${monitor.id}`)}>
    <span className={`orb orb-lg`} data-state={state}>{state==='up'?'✓':state==='down'?'×':state==='paused'?'Ⅱ':'◷'}</span>
    <span className="monitor-main"><strong>{monitor.name}</strong><span className="monitor-url">{monitor.url}</span></span>
    <span className="monitor-meta"><StatusBadge monitor={monitor}/><span>{monitor.lastResponseTimeMs===null?'—':`${monitor.lastResponseTimeMs} ms`} · {relativeTime(monitor.lastCheckedAt)}</span></span>
  </button>;
}

function Dashboard() {
  const [formOpen,setFormOpen]=useState(false);
  const query=useQuery({queryKey:['monitors'],queryFn:monitorApi.list,refetchInterval:15000});
  const monitors=query.data||[];
  const sorted=[...monitors].sort((a,b)=>{
    const rank=(m:Monitor)=>!m.isActive?3:m.currentStatus==='down'?0:m.currentStatus==='up'?1:2;
    return rank(a)-rank(b)||a.name.localeCompare(b.name);
  });
  const counts={up:monitors.filter(m=>m.isActive&&m.currentStatus==='up').length,down:monitors.filter(m=>m.isActive&&m.currentStatus==='down').length,paused:monitors.filter(m=>!m.isActive).length,pending:monitors.filter(m=>m.isActive&&m.currentStatus==='pending').length};
  return <><TopBar/><main className="page">
    <div className="page-heading"><h1>Monitors</h1><button className="primary" onClick={()=>setFormOpen(true)}>+ Add monitor</button></div>
    {query.isLoading?<div className="grid"><div className="monitor-card clay-card skeleton"/><div className="monitor-card clay-card skeleton"/></div>:query.isError?<div className="empty clay-panel"><p>Could not load monitors.</p><button className="secondary" onClick={()=>query.refetch()}>Retry</button></div>:monitors.length===0?<div className="empty clay-panel"><span className="orb orb-xl" data-state="pending">◷</span><h2>No monitors yet</h2><p>Add the first API you want to keep an eye on.</p><button className="primary" onClick={()=>setFormOpen(true)}>Add monitor</button></div>:<>
      <section className="summary-strip">{([['up','Up'],['down','Down'],['paused','Paused'],['pending','Pending']] as const).map(([key,label])=><div className="stat-tile clay-card" key={key}><span className={`orb orb-sm`} data-state={key==='pending'?key:key==='paused'?'paused':key}/><strong>{counts[key]}</strong><span>{label}</span></div>)}</section>
      <section className="monitor-grid">{sorted.map(m=><MonitorCard key={m.id} monitor={m}/>)}</section>
    </>}
    <PipelineCard/>
  </main>{formOpen&&<MonitorForm onClose={()=>setFormOpen(false)}/>}</>;
}

function Detail() {
  const {id}=useParams();
  const navigate=useNavigate();
  const queryClient=useQueryClient();
  const [window,setWindow]=useState<'24h'|'7d'>('24h');
  const [editing,setEditing]=useState(false);
  const monitorQuery=useQuery({queryKey:['monitors',id],queryFn:()=>monitorApi.get(id!),refetchInterval:15000,enabled:!!id});
  const resultsQuery=useQuery({queryKey:['results',id],queryFn:()=>monitorApi.results(id!),refetchInterval:15000,enabled:!!id});
  const statsQuery=useQuery({queryKey:['stats',id,window],queryFn:()=>monitorApi.stats(id!,window),refetchInterval:15000,enabled:!!id});
  if(monitorQuery.isError)return <><TopBar/><main className="page"><div className="empty clay-panel"><h2>Page not found</h2><p>That page doesn't exist or you don't have access to it.</p><button className="primary" onClick={()=>navigate('/dashboard')}>Back to monitors</button></div></main></>;
  if(monitorQuery.isLoading)return <><TopBar/><main className="page"><div className="clay-panel detail-header skeleton"/></main></>;
  const monitor=monitorQuery.data!;
  const results=[...(resultsQuery.data||[])].reverse();
  async function refresh(){await Promise.all([monitorQuery.refetch(),resultsQuery.refetch(),statsQuery.refetch()]);queryClient.invalidateQueries({queryKey:['monitors']});}
  async function togglePause(){await monitorApi.update(monitor.id,{isActive:!monitor.isActive});await refresh();}
  async function remove(){if(!globalThis.confirm(`Delete ${monitor.name}? This also deletes its check history.`))return;await monitorApi.remove(monitor.id);queryClient.invalidateQueries({queryKey:['monitors']});navigate('/dashboard');}
  return <><TopBar/><main className="page">
    <button className="ghost back" onClick={()=>navigate('/dashboard')}>← Monitors</button>
    <section className="detail-header clay-panel"><span className="orb orb-xl" data-state={statusFor(monitor)}>{statusFor(monitor)==='up'?'✓':statusFor(monitor)==='down'?'×':statusFor(monitor)==='paused'?'Ⅱ':'◷'}</span><div className="detail-title"><h1>{monitor.name}</h1><div className="detail-url"><span>{monitor.url}</span><StatusBadge monitor={monitor}/></div></div><div className="detail-actions"><button className="secondary" onClick={async()=>{await monitorApi.check(monitor.id);await refresh();}}>Check now</button><button className="secondary" onClick={togglePause}>{monitor.isActive?'Pause':'Resume'} monitor</button><button className="secondary" onClick={()=>setEditing(true)}>Edit</button><button className="secondary danger" onClick={remove}>Delete</button></div></section>
    <div className="window-toggle"><span>Last {window==='24h'?'24 hours':'7 days'}</span><button className={window==='24h'?'selected':''} onClick={()=>setWindow('24h')}>24h</button><button className={window==='7d'?'selected':''} onClick={()=>setWindow('7d')}>7d</button></div>
    <section className="stats-grid"><div className="stat-tile clay-card"><strong>{statsQuery.data?.uptimePercent===null||statsQuery.data?.uptimePercent===undefined?'—':`${statsQuery.data.uptimePercent}%`}</strong><span>Uptime</span></div><div className="stat-tile clay-card"><strong>{statsQuery.data?.avgResponseTimeMs===null||statsQuery.data?.avgResponseTimeMs===undefined?'—':`${statsQuery.data.avgResponseTimeMs} ms`}</strong><span>Average</span></div><div className="stat-tile clay-card"><strong>{statsQuery.data?.totalChecks??'—'}</strong><span>Checks</span></div><div className="stat-tile clay-card"><strong>{statsQuery.data?.failedChecks??'—'}</strong><span>Failed</span></div></section>
    <section className="chart-panel clay-panel"><h2>Response time</h2><div className="chart-well"><ResponsiveContainer width="100%" height={260}><LineChart data={results}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FF7A1A" stopOpacity={0.28}/><stop offset="95%" stopColor="#FF7A1A" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#3A1D21" strokeDasharray="4 6" vertical={false}/><XAxis dataKey="checkedAt" hide/><YAxis stroke="#C9A9AA"/><Tooltip/><Area type="monotone" dataKey="responseTimeMs" fill="url(#area)" stroke="none"/><Line type="monotone" dataKey="responseTimeMs" stroke="#FF7A1A" strokeWidth={3} dot={(props)=>props.payload.status==='down'?<circle cx={props.cx} cy={props.cy} r={7} fill="#F0434B" stroke="#FFF1EE" strokeWidth={2}/>:<circle cx={-100} cy={-100} r={0}/>} isAnimationActive={false}/></LineChart></ResponsiveContainer>{results.length===0&&<div className="chart-empty"><span className="orb" data-state="pending"/>No checks yet. The first result appears within a minute.</div>}</div></section>
    <section className="results-panel clay-panel"><h2>Recent checks</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Status</th><th>Code</th><th>Response</th><th>Error</th></tr></thead><tbody>{[...results].reverse().slice(0,20).map(result=><tr className={result.status==='down'?'failed-row':''} key={result.id}><td>{new Date(result.checkedAt).toLocaleString()}</td><td>{result.status==='up'?'Up':'Down'}</td><td>{result.statusCode??'—'}</td><td className={result.responseTimeMs&&result.responseTimeMs>1000?'slow':''}>{result.responseTimeMs===null?'—':`${result.responseTimeMs} ms`}</td><td>{result.error||'—'}</td></tr>)}</tbody></table></div></section>
  </main>{editing&&<MonitorForm monitor={monitor} onClose={()=>setEditing(false)}/>}</>;
}

function NotFound() {
  const navigate=useNavigate();
  return <main className="page not-found"><span className="orb orb-xl" data-state="down">×</span><h1>Page not found</h1><p>That page doesn't exist or you don't have access to it.</p><button className="primary" onClick={()=>navigate('/dashboard')}>Back to monitors</button></main>;
}

export default function App(){
  const {status}=useAuth();
  useEffect(()=>{document.title='Watcher — Your APIs. Always in Sight.'},[]);
  if(status==='loading')return <main className="loader">Loading Watcher...</main>;
  return <Routes><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/login" element={<AuthPage mode="login"/>}/><Route path="/register" element={<AuthPage mode="register"/>}/><Route path="/dashboard" element={<Protected><Dashboard/></Protected>}/><Route path="/monitors/:id" element={<Protected><Detail/></Protected>}/><Route path="*" element={<NotFound/>}/></Routes>;
}
