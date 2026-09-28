import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, CheckCircle2, Loader2, Crosshair, LogOut, Plus, Home,
  Store, Package, Clock, Target, KeyRound,
} from "lucide-react";
import { api, dataUrlToBlob } from "./api";
import {
  APP_NAME, BRAND_LINE, ASSETS, assetLabel, Field, TextInput, Select, ComboInput, Button, Card, Stat,
  Banner, MiniMap, AssetRow, SubmitSuccess, fileToCompressedDataUrl, getPosition, reverseGeocode,
  fmtDate, fmtTime, toInt, statusTone,
} from "./ui";

const STEPS = ["Shop", "Assets", "Location", "Review"];

/* --------------------------- new activation ---------------------------- */

function NewActivation({ user, geo, onSubmitted }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    state: user.state || "", city: user.city || "", area: "",
    pharmacyName: "", address: "", pharmacyId: null,
  });
  const [rows, setRows] = useState({});
  const [photos, setPhotos] = useState({});
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [place, setPlace] = useState(null);
  const [error, setError] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [duplicateHit, setDuplicateHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const captureGps = useCallback(async () => {
    setGpsBusy(true);
    setGpsError("");
    try {
      const p = await getPosition();
      setGps(p);
      const rg = await reverseGeocode(p.lat, p.lng);
      if (rg) setPlace(rg);
    } catch (e) {
      setGpsError(e.message);
    } finally {
      setGpsBusy(false);
    }
  }, []);

  useEffect(() => { captureGps(); }, [captureGps]);

  // Shop name lookup against the pharmacy master, debounced.
  useEffect(() => {
    const q = form.pharmacyName.trim();
    if (q.length < 2 || !form.city) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api.pharmacies({ search: q, city: form.city })
        .then((r) => setSuggestions(r.pharmacies.slice(0, 5)))
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [form.pharmacyName, form.city]);

  const selected = Object.keys(rows);
  const installedMissingPhoto = selected.filter(
    (k) => (ASSETS.find((a) => a.key === k) || {}).mode === "installed" && !photos[k]
  );

  const next = () => {
    if (step === 0) {
      if (!form.state || !form.city || !form.area || form.pharmacyName.trim().length < 3) {
        setError("Fill in state, city, area and the pharmacy name to continue.");
        return;
      }
    }
    if (step === 1) {
      if (!selected.length) { setError("Select at least one collateral asset."); return; }
      if (installedMissingPhoto.length) {
        setError(`Photo proof is still missing for ${installedMissingPhoto.map(assetLabel).join(", ")}.`);
        return;
      }
    }
    if (step === 2 && !gps) { setError("Capture GPS location before continuing."); return; }
    setError("");
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    if (!gps) { setError("GPS location is required."); return; }
    setBusy(true);
    setError("");
    try {
      const photoTimes = {};
      const blobs = {};
      selected.forEach((k) => {
        if (photos[k]) {
          blobs[k] = dataUrlToBlob(photos[k].dataUrl);
          photoTimes[k] = photos[k].ts;
        }
      });
      const payload = {
        pharmacyName: form.pharmacyName.trim(),
        pharmacyId: form.pharmacyId,
        address: form.address.trim(),
        state: form.state, city: form.city, area: form.area,
        latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy,
        gpsSource: gps.source, geoAddress: place ? place.address : "",
        assets: selected.map((k) => ({ key: k, qty: Math.max(1, toInt(rows[k].qty)) })),
        photoTimes,
        allowDuplicate,
      };
      const { activation } = await api.createActivation(payload, blobs);
      onSubmitted(activation);
    } catch (e) {
      if (e.body && e.body.code === "DUPLICATE") {
        setDuplicateHit(true);
        setError("You already logged this shop today. Tick the repeat visit box to submit anyway.");
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-28">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? "bg-teal-600" : "bg-slate-200"}`} />
              <p className={`mt-1 text-xs ${i === step ? "font-medium text-teal-700" : "text-slate-400"}`}>{s}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 px-4 pt-4">
        {step === 0 ? (
          <>
            <Field label="State" required>
  <ComboInput
    value={form.state}
    onChange={(v) =>
      setForm((f) => ({ ...f, state: v, city: "", area: "" }))
    }
    options={geo.states}
    placeholder="e.g. Maharashtra"
  />
</Field>

<Field label="City" required>
  <ComboInput
    value={form.city}
    onChange={(v) =>
      setForm((f) => ({ ...f, city: v, area: "" }))
    }
    options={geo.cities(form.state)}
    placeholder="e.g. Mumbai"
  />
</Field>

<Field label="Area" required>
  <ComboInput
    value={form.area}
    onChange={(v) => set("area", v)}
    options={geo.areas(form.city, form.state)}
    placeholder="e.g. Ghatkopar West"
  />
</Field>
            <Field label="Pharmacy / medical shop name" required hint="Choose a suggestion or enter a new shop. New shop or geography values will be flagged for manager verification.">
              <TextInput value={form.pharmacyName}
                onChange={(e) => setForm((f) => ({ ...f, pharmacyName: e.target.value, pharmacyId: null }))}
                placeholder="e.g. Noble Chemist" />
            </Field>
            {suggestions.length ? (
              <div className="-mt-2 space-y-1">
                {suggestions.map((p) => (
                  <button key={p.id}
                    onClick={() => { setForm((f) => ({ ...f, pharmacyName: p.name, address: p.address || "", area: p.area, pharmacyId: p.id })); setSuggestions([]); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-teal-50">
                    <Store size={14} className="text-slate-400" />
                    <span className="truncate">
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="text-slate-500"> - {p.area}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <Field label="Shop address" hint="Optional">
              <TextInput value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Shop no., street" />
            </Field>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Date, time and your employee ID are recorded by the server at submission.
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-sm text-slate-600">
              Tick every asset installed or distributed, set the quantity, and capture one photo per installed asset.
            </p>
            <div className="space-y-2">
              {ASSETS.map((a) => (
                <AssetRow key={a.key} asset={a} row={rows[a.key]} photo={photos[a.key]}
                  onToggle={() =>
                    setRows((r) => {
                      const nr = { ...r };
                      if (nr[a.key]) {
                        delete nr[a.key];
                        setPhotos((p) => { const np = { ...p }; delete np[a.key]; return np; });
                      } else nr[a.key] = { qty: a.key === "brown_envelope" ? 10 : 1 };
                      return nr;
                    })
                  }
                  onQty={(q) => setRows((r) => ({ ...r, [a.key]: { ...r[a.key], qty: q } }))}
                  onPhoto={async (file) => {
                    try {
                      const dataUrl = await fileToCompressedDataUrl(file);
                      setPhotos((p) => ({ ...p, [a.key]: { dataUrl, ts: new Date().toISOString() } }));
                      setError("");
                    } catch (err) { setError(err.message); }
                  }}
                  onRemovePhoto={() => setPhotos((p) => { const np = { ...p }; delete np[a.key]; return np; })}
                />
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            {gpsBusy ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-6 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" /> Getting a GPS fix
              </div>
            ) : null}
            {gps ? (
              <>
                <Banner kind={gps.source === "device" ? "success" : "warn"}>
                  {gps.source === "device"
                    ? `Location captured with ${gps.accuracy} m accuracy at ${fmtTime(gps.ts)}.`
                    : "Manual location entered. This entry will be flagged as unverified for your manager."}
                </Banner>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Latitude</p>
                    <p className="font-medium tabular-nums text-slate-900">{gps.lat}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Longitude</p>
                    <p className="font-medium tabular-nums text-slate-900">{gps.lng}</p>
                  </div>
                </div>
                {place ? (
                  <div className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="text-xs text-slate-500">Detected address</p>
                    <p className="text-slate-800">{place.address}</p>
                  </div>
                ) : null}
                <MiniMap lat={gps.lat} lng={gps.lng} height={180} />
                <Button variant="ghost" className="w-full" onClick={captureGps}>
                  <Crosshair size={16} /> Re-capture location
                </Button>
              </>
            ) : null}
            {gpsError ? (
              <>
                <Banner kind="error">{gpsError}</Banner>
                <Button variant="ghost" className="w-full" onClick={captureGps}>
                  <Crosshair size={16} /> Try again
                </Button>
                <ManualLocation onSet={(p) => { setGps(p); setGpsError(""); }} />
              </>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Card className="divide-y divide-slate-100">
              <div className="p-3">
                <p className="text-xs text-slate-500">Shop</p>
                <p className="font-medium text-slate-900">{form.pharmacyName}</p>
                <p className="text-sm text-slate-600">{form.area}, {form.city}, {form.state}</p>
              </div>
              <div className="p-3">
                <p className="mb-2 text-xs text-slate-500">Assets</p>
                <div className="space-y-1.5">
                  {selected.map((k) => (
                    <div key={k} className="flex items-center gap-2 text-sm">
                      {photos[k] ? <img src={photos[k].dataUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-slate-100" />}
                      <span className="flex-1 text-slate-800">{assetLabel(k)}</span>
                      <span className="tabular-nums font-medium text-slate-900">{rows[k].qty}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3">
                <p className="text-xs text-slate-500">GPS</p>
                <p className="tabular-nums text-sm text-slate-800">
                  {gps ? `${gps.lat}, ${gps.lng} (${gps.accuracy} m, ${gps.source})` : "Not captured"}
                </p>
              </div>
            </Card>
            {duplicateHit ? (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="mt-0.5" />
                <span>This is a genuine repeat visit to the same shop today. It will be flagged for the manager.</span>
              </label>
            ) : null}
          </>
        ) : null}

        {error ? <Banner kind="error">{error}</Banner> : null}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft size={16} /> Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button className="flex-1" onClick={next}>Continue <ChevronRight size={16} /></Button>
          ) : (
            <Button variant="success" className="flex-1" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Submit activation
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangePassword({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async () => {
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setBusy(true);

    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password changed successfully.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-5 pb-24">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Change password
          </h2>
          <p className="text-sm text-slate-500">
            Enter your current password and choose a new one.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>

      <div className="space-y-4">
        <Field label="Current password" required>
          <TextInput
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>

        <Field label="New password" required>
          <TextInput
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirm new password" required>
          <TextInput
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        {error ? <Banner kind="error">{error}</Banner> : null}
        {success ? <Banner kind="success">{success}</Banner> : null}

        <Button size="lg" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          Change password
        </Button>
      </div>
    </div>
  );
}

function ManualLocation({ onSet }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  return (
    <Card className="p-3">
      <p className="mb-2 text-xs text-slate-600">
        If the device cannot get a fix, enter coordinates from your maps app. The entry is stored as unverified.
      </p>
      <div className="flex gap-2">
        <TextInput value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" inputMode="decimal" />
        <TextInput value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" inputMode="decimal" />
        <Button variant="ghost" onClick={() => {
          const la = Number(lat), ln = Number(lng);
          if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
            onSet({ lat: la, lng: ln, accuracy: 0, ts: new Date().toISOString(), source: "manual" });
          }
        }}>Use</Button>
      </div>
    </Card>
  );
}

/* --------------------------- field dashboard --------------------------- */

function FieldDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.myStats(), api.activations({ limit: 20 })])
      .then(([s, r]) => { setStats(s); setRows(r.activations); })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="px-4 py-4 pb-24">
      <h2 className="text-lg font-semibold text-slate-900">Hello, {user.name.split(" ")[0]}</h2>
      <p className="text-sm text-slate-500">{user.city || "Field"} territory / {user.employeeId}</p>

      {error ? <div className="mt-3"><Banner kind="error">{error}</Banner></div> : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Shops activated" value={stats ? stats.shops : "-"} icon={Store} />
        <Stat label="Assets installed" value={stats ? stats.units : "-"} icon={Package} tone="blue" />
        <Stat label="Activations today" value={stats ? stats.today : "-"} icon={Clock} tone="emerald" />
        <Stat label="This week" value={stats ? stats.week : "-"} icon={Target} tone="slate" />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Recent activations</h3>
      {rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-500">No activations yet. Start with the New entry tab.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <Card key={a.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{a.pharmacy_name}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(a.occurred_at)} / {a.city} / {a.asset_count} assets, {a.units} units
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusTone(a.status)}`}>{a.status}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- shell --------------------------------- */

export default function FieldApp({ user, geo, onLogout }) {
  const [tab, setTab] = useState("new");
  const [submitted, setSubmitted] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const successRecord = submitted
    ? { id: submitted.code, pharmacyName: submitted.pharmacy_name, photoStoreFailed: false }
    : null;

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{APP_NAME}</p>
          <p className="text-xs text-slate-500">{user.name} / {user.employeeId}</p>
        </div>
        <div className="flex items-center gap-1">
  <button
    onClick={() => setShowPassword(true)}
    title="Change password"
    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
  >
    <KeyRound size={18} />
  </button>

  <button
    onClick={onLogout}
    title="Log out"
    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
  >
    <LogOut size={18} />
  </button>
</div>
      </header>

      <main className="mx-auto max-w-2xl">
        {showPassword ? (
  <ChangePassword onClose={() => setShowPassword(false)} />
) : tab === "new" ? (
  successRecord ? (
    <SubmitSuccess
      record={successRecord}
      onNew={() => {
        setSubmitted(null);
        setFormKey((k) => k + 1);
      }}
      onDashboard={() => {
        setSubmitted(null);
        setFormKey((k) => k + 1);
        setTab("me");
      }}
    />
  ) : (
    <NewActivation
      key={formKey}
      user={user}
      geo={geo}
      onSubmitted={setSubmitted}
    />
  )
) : (
  <FieldDashboard key={formKey} user={user} />
)}
      </main>
{!showPassword && (
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-slate-200 bg-white">
        {[{ key: "new", label: "New entry", icon: Plus }, { key: "me", label: "My activations", icon: Home }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${tab === t.key ? "text-teal-700" : "text-slate-500"}`}>
            <t.icon size={19} />
            {t.label}
          </button>
        ))}
      </nav>
      )}
    </div>
  );
}
