import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Store, ChevronRight, Loader2, Eye, EyeOff } from "lucide-react";
import { api, setToken, getToken } from "./api";
import { APP_NAME, BRAND_LINE, Field, TextInput, Button, Banner } from "./ui";
import FieldApp from "./FieldApp";
import AdminApp from "./AdminApp";
import ManagerApp from "./ManagerApp";

function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError("Enter your employee ID, mobile or email and your password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { token, user } = await api.login(identifier.trim(), password);
      setToken(token);
      onLogin(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-8">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white">
            <Store size={20} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-500">{BRAND_LINE}</p>
        </div>
        <div className="space-y-4">
          <Field label="Employee ID, mobile or email" required>
            <TextInput value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              placeholder="EMP1001" autoComplete="username" onKeyDown={(e) => e.key === "Enter" && submit()} />
          </Field>
          <Field label="Password" required>
            <div className="relative">
              <TextInput type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password" autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && submit()} className="pr-11" />
              <button type="button" onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800">
                {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
              </button>
            </div>
          </Field>
          {error ? <Banner kind="error">{error}</Banner> : null}
          <Button size="lg" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} Log in
          </Button>
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">
          Accounts are issued by your manager. Contact them if you cannot sign in.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState("");

  const loadPlans = useCallback(() => {
    api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, []);

  // Restore an existing session on reload.
  useEffect(() => {
    if (!getToken()) { setBooting(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch((e) => { if (e.status !== 401) setFatal(e.message); })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => { if (user) loadPlans(); }, [user, loadPlans]);

  // A rejected token anywhere in the app drops the session.
  useEffect(() => {
    const onOut = () => setUser(null);
    window.addEventListener("tat:signed-out", onOut);
    return () => window.removeEventListener("tat:signed-out", onOut);
  }, []);

  // State, city and area lists come from the uploaded planned targets, so the
  // app's geography always matches what the brand team actually planned.
  const geo = useMemo(() => {
    const states = [...new Set(plans.map((p) => p.state))].sort();
    return {
      states,
      cities: (state) => [...new Set(plans.filter((p) => !state || p.state === state).map((p) => p.city))].sort(),
      areas: (city, state) => [...new Set(plans
        .filter((p) => (!city || p.city === city) && (!state || p.state === state))
        .map((p) => p.area))].sort(),
    };
  }, [plans]);

  const logout = () => { setToken(null); setUser(null); };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }
  if (fatal) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Banner kind="error">{fatal}</Banner>
      </div>
    );
  }
  if (!user) return <Login onLogin={setUser} />;

  if (user.role === "admin") {
    return <AdminApp user={user} geo={geo} planCount={plans.length} onPlansChanged={loadPlans} onLogout={logout} />;
  }
  if (["regional_head", "city_head", "team_lead"].includes(user.role)) return <ManagerApp user={user} geo={geo} onLogout={logout} />;
  return <FieldApp user={user} geo={geo} onLogout={logout} />;
}
