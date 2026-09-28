import React, { useState, useRef } from "react";
import {
  Camera, CheckCircle2, Clock, ChevronRight, Loader2, Package, Store, Target, Plus,
  Image as ImageIcon, RefreshCw, Trash2, X, Check, Users, ClipboardList, BarChart3,
} from "lucide-react";

/* Presentation layer shared by the field app and the manager dashboard.
   No data access lives here: everything comes in through props. */

export const APP_NAME = "Trade Activation Tracker";
export const BRAND_LINE = "Thyrocare Pregnancy Kit";

export const ASSETS = [
  { key: "poster", label: "Poster", mode: "installed" },
  { key: "wobbler", label: "Wobbler", mode: "installed" },
  { key: "dangler", label: "Dangler", mode: "installed" },
  { key: "shelf_strip", label: "Shelf Strip", mode: "installed" },
  { key: "gravity_feeder", label: "Gravity Feeder", mode: "installed" },
  { key: "shelf_in_shelf", label: "Shelf-in-Shelf", mode: "installed" },
  { key: "brown_envelope", label: "Brown Envelope", mode: "distributed" },
];
export const ASSET_KEYS = ASSETS.map((a) => a.key);
export const assetLabel = (k) => (ASSETS.find((a) => a.key === k) || {}).label || k;

export const STATUSES = ["Submitted", "Pending Review", "Approved", "Rejected"];




/* ---------------------------- small utilities ---------------------------- */

export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const fmtTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const pctOf = (a, b) => (!b ? 0 : Math.round((a / b) * 1000) / 10);
export const shopKey = (a) => `${a.state}|${a.city}|${String(a.pharmacyName || "").trim().toLowerCase()}`;
export const toInt = (v) => {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
};
export const assetTotal = (a) => (a.assets || []).reduce((s, x) => s + toInt(x.qty), 0);

export function penTone(p) {
  if (p >= 90) return { bar: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700" };
  if (p >= 70) return { bar: "bg-teal-500", text: "text-teal-700", chip: "bg-teal-50 text-teal-700" };
  if (p >= 45) return { bar: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-50 text-amber-700" };
  return { bar: "bg-rose-500", text: "text-rose-700", chip: "bg-rose-50 text-rose-700" };
}

export function statusTone(s) {
  if (s === "Approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "Rejected") return "bg-rose-50 text-rose-700 border-rose-200";
  if (s === "Pending Review") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

/* --------------------------- image + device APIs -------------------------- */

export function fileToCompressedDataUrl(file, maxEdge = 900, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not open that image."));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This device or browser does not expose location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: Number(p.coords.latitude.toFixed(6)),
          lng: Number(p.coords.longitude.toFixed(6)),
          accuracy: Math.round(p.coords.accuracy || 0),
          ts: new Date().toISOString(),
          source: "device",
        }),
      (err) => {
        const map = {
          1: "Location permission was denied. Allow location for this page and try again.",
          2: "Location is unavailable right now. Move to an open area and try again.",
          3: "Getting a fix took too long. Try again.",
        };
        reject(new Error(map[err.code] || "Location could not be captured."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    if (!res.ok) return null;
    const j = await res.json();
    const parts = [j.locality, j.city, j.principalSubdivision, j.postcode].filter(Boolean);
    return {
      state: j.principalSubdivision || "",
      city: j.city || j.locality || "",
      area: j.locality || "",
      address: parts.join(", "),
    };
  } catch (e) {
    return null;
  }
}

/* --------------------------------- CSV ---------------------------------- */

export function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

export function downloadCsv(filename, rows) {
  const blob = new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}


/* ============================== UI primitives ============================= */

export function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-xs text-slate-500 mt-1">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100";

export function TextInput(props) {
  return <input {...props} className={inputCls} />;
}

export function Select({ value, onChange, options, placeholder, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls + (disabled ? " bg-slate-50 text-slate-400" : "")}
    >
      <option value="">{placeholder || "Select"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function ComboInput({ value, onChange, options = [], placeholder }) {
  const listId = React.useId();

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        className={inputCls}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function Button({ children, onClick, variant = "primary", size = "md", disabled, className = "", type = "button" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-300";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3.5 text-base w-full" };
  const variants = {
    primary: "bg-teal-600 text-white hover:bg-teal-700",
    dark: "bg-slate-900 text-white hover:bg-slate-800",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    danger: "bg-white text-rose-700 border border-rose-300 hover:bg-rose-50",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function Stat({ label, value, sub, icon: Icon, tone = "teal" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
        </div>
        {Icon ? (
          <span className={`shrink-0 rounded-lg p-2 ${tones[tone]}`}>
            <Icon size={16} />
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function Bar({ value, tone }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function Banner({ kind = "info", children }) {
  const tones = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warn: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-rose-50 border-rose-200 text-rose-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  return <div className={`rounded-lg border px-3 py-2.5 text-sm ${tones[kind]}`}>{children}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900 bg-opacity-50 p-0 sm:p-4">
      <div className={`flex max-h-full w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function MiniMap({ lat, lng, height = 220 }) {
  const d = 0.008;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join("%2C");
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <iframe
        title="Activation location"
        className="w-full block"
        style={{ height }}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`}
      />
      <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="tabular-nums">
          {lat}, {lng}
        </span>
        <a
          className="font-medium text-teal-700 hover:underline"
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}


export function AssetRow({ asset, row, onToggle, onQty, onPhoto, onRemovePhoto, photo }) {
  const fileRef = useRef(null);
  const selected = !!row;
  return (
    <div className={`rounded-xl border p-3 ${selected ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <button onClick={onToggle} className="flex flex-1 items-center gap-3 text-left">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
              selected ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white"
            }`}
          >
            {selected ? <Check size={14} /> : null}
          </span>
          <span>
            <span className="block text-sm font-medium text-slate-900">{asset.label}</span>
            <span className="block text-xs text-slate-500">{asset.mode === "installed" ? "Installed in shop" : "Distributed to shop"}</span>
          </span>
        </button>
        {selected ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onQty(Math.max(1, toInt(row.qty) - 1))}
              className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg text-slate-700"
            >
              -
            </button>
            <input
              value={row.qty}
              inputMode="numeric"
              onChange={(e) => onQty(toInt(e.target.value))}
              className="h-9 w-12 rounded-lg border border-slate-300 bg-white text-center text-sm tabular-nums"
            />
            <button
              onClick={() => onQty(toInt(row.qty) + 1)}
              className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg text-slate-700"
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) onPhoto(f);
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
              <img src={photo.dataUrl} alt={`${asset.label} proof`} className="h-16 w-16 rounded-md object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{asset.label} proof</p>
                <p className="text-xs text-slate-500">Captured {fmtTime(photo.ts)}</p>
              </div>
              <button onClick={() => fileRef.current && fileRef.current.click()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <RefreshCw size={16} />
              </button>
              <button onClick={onRemovePhoto} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50">
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            <Button variant="ghost" className="w-full" onClick={() => fileRef.current && fileRef.current.click()}>
              <Camera size={16} /> Capture photo
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}


export function SubmitSuccess({ record, onNew, onDashboard }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 size={28} />
      </div>
      <h2 className="text-xl font-semibold text-slate-900">Trade activation successfully submitted</h2>
      <p className="mt-1 text-sm text-slate-500">{record.pharmacyName}</p>
      <div className="mx-auto mt-5 max-w-xs rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs text-slate-500">Activation ID</p>
        <p className="font-mono text-lg font-semibold text-slate-900">{record.id}</p>
      </div>
      <div className="mx-auto mt-6 flex max-w-xs flex-col gap-2">
        <Button size="lg" onClick={onNew}>
          <Plus size={16} /> Log the next shop
        </Button>
        <Button variant="ghost" onClick={onDashboard}>
          View my activations
        </Button>
      </div>
    </div>
  );
}


export function PenTable({ head, rows, cols }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{head}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {cols.map((c) => (
                <th key={c.label} className={`px-4 py-2 font-medium ${c.right ? "text-right" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                {cols.map((c) => (
                  <td key={c.label} className={`px-4 py-2.5 ${c.right ? "text-right tabular-nums" : ""}`}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-slate-500">No data for these filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function PenCell({ value }) {
  const t = penTone(value);
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden w-20 sm:block">
        <Bar value={value} tone={t.bar} />
      </div>
      <span className={`w-14 text-right font-medium ${t.text}`}>{value}%</span>
    </div>
  );
}


export function AdminOverview({ a }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Planned shops" value={a.plannedShops.toLocaleString("en-IN")} icon={Target} tone="slate" />
        <Stat label="Shops activated" value={a.activatedShops.toLocaleString("en-IN")} icon={Store} />
        <Stat label="Shop activation penetration" value={`${a.shopPen}%`} sub={`${a.activatedShops} of ${a.plannedShops}`} icon={BarChart3} tone="emerald" />
        <Stat label="Activations today" value={a.todayCount} icon={Clock} tone="blue" />
        <Stat label="Assets planned" value={a.plannedAssets.toLocaleString("en-IN")} icon={ClipboardList} tone="slate" />
        <Stat label="Assets installed" value={a.installedAssets.toLocaleString("en-IN")} icon={Package} />
        <Stat label="Asset installation penetration" value={`${a.assetPen}%`} sub={`${a.installedAssets} of ${a.plannedAssets}`} icon={BarChart3} tone="emerald" />
        <Stat label="Active field users" value={a.activeUsers} icon={Users} tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">India performance by state</h3>
          <p className="mb-3 text-xs text-slate-500">Shop activation penetration against plan</p>
          <div className="space-y-3">
            {a.byState.map((s) => {
              const t = penTone(s.shopPen);
              return (
                <div key={s.key}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-slate-700">{s.key}</span>
                    <span className={`tabular-nums font-medium ${t.text}`}>
                      {s.activatedShops}/{s.plannedShops} · {s.shopPen}%
                    </span>
                  </div>
                  <Bar value={s.shopPen} tone={t.bar} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Asset installation against plan</h3>
          <p className="mb-3 text-xs text-slate-500">Installed or distributed quantity vs planned quantity</p>
          <div className="space-y-3">
            {a.byAsset.map((s) => {
              const t = penTone(s.pen);
              return (
                <div key={s.key}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-slate-700">{s.label}</span>
                    <span className={`tabular-nums font-medium ${t.text}`}>
                      {s.installed.toLocaleString("en-IN")}/{s.planned.toLocaleString("en-IN")} · {s.pen}%
                    </span>
                  </div>
                  <Bar value={s.pen} tone={t.bar} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}


export function AdminAnalytics({ a }) {
  return (
    <div className="space-y-4">
      <PenTable
        head="State-wise performance"
        rows={a.byState}
        cols={[
          { label: "State", render: (r) => r.key },
          { label: "Planned shops", right: true, render: (r) => r.plannedShops },
          { label: "Activated", right: true, render: (r) => r.activatedShops },
          { label: "Assets installed", right: true, render: (r) => r.installed.toLocaleString("en-IN") },
          { label: "Shop penetration", right: true, render: (r) => <PenCell value={r.shopPen} /> },
        ]}
      />
      <PenTable
        head="City-wise performance"
        rows={a.byCity}
        cols={[
          { label: "City", render: (r) => r.key },
          { label: "State", render: (r) => r.state },
          { label: "Planned", right: true, render: (r) => r.plannedShops },
          { label: "Activated", right: true, render: (r) => r.activatedShops },
          { label: "Penetration", right: true, render: (r) => <PenCell value={r.shopPen} /> },
        ]}
      />
      <PenTable
        head="Area-wise performance"
        rows={a.byArea}
        cols={[
          { label: "Area", render: (r) => r.key },
          { label: "Planned", right: true, render: (r) => r.plannedShops },
          { label: "Activated", right: true, render: (r) => r.activatedShops },
          { label: "Asset penetration", right: true, render: (r) => <PenCell value={r.assetPen} /> },
        ]}
      />
      <PenTable
        head="Salesperson performance"
        rows={a.bySales}
        cols={[
          { label: "Salesperson", render: (r) => (<span><span className="font-medium text-slate-900">{r.name}</span><span className="block text-xs text-slate-500">{r.employeeId}</span></span>) },
          { label: "City", render: (r) => r.city },
          { label: "Shops activated", right: true, render: (r) => r.shops },
          { label: "Assets installed", right: true, render: (r) => r.installed },
          { label: "Completion", right: true, render: (r) => <PenCell value={r.completion} /> },
        ]}
      />
      <p className="text-xs text-slate-500">Salesperson completion compares shops activated against an equal share of the planned shops in their assigned city.</p>
    </div>
  );
}
