import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, BarChart3, FileText, Target, Users, LogOut, Store, Download, Upload,
  Search, Plus, Loader2, CheckCircle2, XCircle, Image as ImageIcon, ClipboardCheck,
  ChevronDown, ChevronUp, Clock,
} from "lucide-react";
import { api } from "./api";
import BulkUsers from "./BulkUsers";
import {
  APP_NAME, BRAND_LINE, ASSETS, assetLabel, inputCls, Field, TextInput, Select, ComboInput, Button, Card,
  Banner, Modal, MiniMap, PenTable, PenCell, AdminOverview, AdminAnalytics, fmtDate, fmtTime,
  statusTone,
} from "./ui";

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* ------------------------------- filters -------------------------------- */

function FilterBar({ geo, users, f, setF }) {
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const isBelow = useCallback((user, ancestorId) => {
    if (!ancestorId) return true;
    let current = user;
    const seen = new Set();
    while (current?.managerId && !seen.has(current.managerId)) {
      if (current.managerId === ancestorId) return true;
      seen.add(current.managerId);
      current = byId.get(current.managerId);
    }
    return false;
  }, [byId]);
  const rhs = users.filter((u) => u.active && u.role === "regional_head");
  const cityHeads = users.filter((u) => u.active && u.role === "city_head" && isBelow(u, f.rhId));
  const teamLeads = users.filter((u) => u.active && u.role === "team_lead" && isBelow(u, f.chId || f.rhId));
  const salespeople = users.filter((u) => u.active && u.role === "field" && isBelow(u, f.tlId || f.chId || f.rhId));
  const chooseLeader = (level, value) => setF((p) => {
    const next = { ...p, [level]: value, userId: "" };
    if (level === "rhId") Object.assign(next, { chId: "", tlId: "" });
    if (level === "chId") Object.assign(next, { tlId: "" });
    next.scopeUserId = value || (level === "tlId" ? p.chId || p.rhId : level === "chId" ? p.rhId : "");
    return next;
  });
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
      <input type="date" value={f.from} onChange={(e) => upd("from", e.target.value)} className={inputCls} />
      <input type="date" value={f.to} onChange={(e) => upd("to", e.target.value)} className={inputCls} />
      <Select value={f.state} onChange={(v) => setF((p) => ({ ...p, state: v, city: "", area: "" }))} options={geo.states} placeholder="All states" />
      <Select value={f.city} onChange={(v) => setF((p) => ({ ...p, city: v, area: "" }))} options={geo.cities(f.state)} placeholder="All cities" />
      <Select value={f.area} onChange={(v) => upd("area", v)} options={geo.areas(f.city, f.state)} placeholder="All areas" />
      <select value={f.rhId} onChange={(e) => chooseLeader("rhId", e.target.value)} className={inputCls}>
        <option value="">All Regional Heads</option>
        {rhs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={f.chId} onChange={(e) => chooseLeader("chId", e.target.value)} className={inputCls}>
        <option value="">All City Heads</option>
        {cityHeads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={f.tlId} onChange={(e) => chooseLeader("tlId", e.target.value)} className={inputCls}>
        <option value="">All Team Leads</option>
        {teamLeads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={f.userId} onChange={(e) => setF((p) => ({
        ...p,
        userId: e.target.value,
        scopeUserId: e.target.value ? "" : (p.tlId || p.chId || p.rhId),
      }))} className={inputCls}>
        <option value="">All salespeople</option>
        {salespeople.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <select value={f.asset} onChange={(e) => upd("asset", e.target.value)} className={inputCls}>
        <option value="">All assets</option>
        {ASSETS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
      </select>
    </div>
  );
}

function ExcelExport({ filters }) {
  return (
    <div className="flex justify-end">
      <Button variant="ghost" size="sm"
        onClick={() => api.download("/analytics/export/performance.xlsx", "performance-report.xlsx", filters)}>
        <Download size={15} /> Download Excel
      </Button>
    </div>
  );
}

/* ---------------------------- record detail ----------------------------- */

function RecordDetail({ id, onClose, onOpenSalesperson }) {
  const [record, setRecord] = useState(null);
  const [photos, setPhotos] = useState({});
  const [photoErrors, setPhotoErrors] = useState({});
  const [error, setError] = useState("");
  const [rating, setRating] = useState("");
  const [comment, setComment] = useState("");
  const [assetStatuses, setAssetStatuses] = useState({});
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  useEffect(() => {
    let urls = [];
    let live = true;
    api.activation(id)
      .then(async ({ activation }) => {
        if (!live) return;
        setRecord(activation);
        setRating(activation.shop_rating || "");
        setComment(activation.admin_comment || "");
        setAssetStatuses(Object.fromEntries(activation.assets.map((asset) => [asset.asset_type, asset.review_status || "pending"])));
        for (const a of activation.assets) {
          if (!a.photo_id) continue;
          try {
            const url = await api.photoUrl(id, a.asset_type);
            urls.push(url);
            if (live) setPhotos((p) => ({ ...p, [a.asset_type]: url }));
          } catch (e) {
            if (live) setPhotoErrors((p) => ({ ...p, [a.asset_type]: e.message || "Photo could not be loaded." }));
          }
        }
      })
      .catch((e) => setError(e.message));
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [id]);

  const Row = ({ label, value }) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );

  const saveFeedback = async () => {
    setSavingFeedback(true);
    setError("");
    setFeedbackMessage("");
    try {
      const result = await api.setAdminFeedback(id, { rating: rating || null, comment, assetStatuses });
      setRecord(result.activation);
      setFeedbackMessage("Asset decisions, rating and comment saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingFeedback(false);
    }
  };

  return (
    <Modal title={record ? record.code : "Loading"} onClose={onClose} wide>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {!record ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4 py-2">
              <Row label="Salesperson" value={
                <button type="button" onClick={() => onOpenSalesperson?.(record.user_id)}
                  className="font-medium text-teal-700 hover:underline">
                  {record.user_name}
                </button>
              } />
              <Row label="Employee ID" value={record.employee_id} />
              <Row label="Date and time" value={`${fmtDate(record.occurred_at)} ${fmtTime(record.occurred_at)}`} />
              <Row label="Pharmacy" value={record.pharmacy_name} />
              <Row label="Party Code (Alter Code)" value={record.party_code || "-"} />
              <Row label="Address" value={record.address || record.geo_address || "-"} />
              <Row label="Area" value={record.area} />
              <Row label="City" value={record.city} />
              <Row label="State" value={record.state} />
              <Row label="Latitude" value={record.latitude} />
              <Row label="Longitude" value={record.longitude} />
              <Row label="GPS accuracy" value={record.gps_accuracy ? `${record.gps_accuracy} m` : "not reported"} />
              <Row label="Status" value={<span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(record.status)}`}>{record.status}</span>} />
            </div>

            {record.gps_source !== "device" ? (
              <div className="mt-3"><Banner kind="warn">Coordinates were typed in by the user, not read from the device GPS.</Banner></div>
            ) : null}
            {record.duplicate_override ? (
              <div className="mt-3"><Banner kind="warn">Submitted as a repeat visit to this shop on the same day.</Banner></div>
            ) : null}
            {record.party_code_duplicate ? (
              <div className="mt-3"><Banner kind="warn">Flagged: another salesman previously submitted this Party Code (Alter Code).</Banner></div>
            ) : null}

            <div className="mt-3"><MiniMap lat={record.latitude} lng={record.longitude} /></div>

          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Assets and photo proof</h4>
            <div className="grid grid-cols-2 gap-3">
              {record.assets.map((x) => (
                <div key={x.asset_type} className="overflow-hidden rounded-lg border border-slate-200">
                  {photos[x.asset_type] ? (
                    <a href={photos[x.asset_type]} target="_blank" rel="noreferrer" title="Open full-size photo">
                      <img src={photos[x.asset_type]} alt={`${assetLabel(x.asset_type)} proof`} className="h-32 w-full object-cover" />
                    </a>
                  ) : (
                    <div className="flex h-32 flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400">
                      {x.photo_id && !photoErrors[x.asset_type] ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
                      {!x.photo_id ? <span className="px-2 text-center text-xs">No photo (distributed item)</span> : null}
                      {photoErrors[x.asset_type] ? <span className="px-2 text-center text-xs text-red-600">{photoErrors[x.asset_type]}</span> : null}
                    </div>
                  )}
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                    <span className="font-medium text-slate-800">{assetLabel(x.asset_type)}</span>
                    <span className="tabular-nums text-slate-500">Qty {x.quantity}</span>
                  </div>
                  <div className="border-t border-slate-100 px-2 py-1 text-xs text-slate-400">
                    {x.captured_at ? `${fmtDate(x.captured_at)} ${fmtTime(x.captured_at)}` : "-"}
                  </div>
                  <div className="grid grid-cols-2 gap-1 border-t border-slate-100 p-2">
                    <button type="button" onClick={() => setAssetStatuses((current) => ({ ...current, [x.asset_type]: "accepted" }))}
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${assetStatuses[x.asset_type] === "accepted" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 text-slate-600 hover:border-emerald-300"}`}>
                      Accept
                    </button>
                    <button type="button" onClick={() => setAssetStatuses((current) => ({ ...current, [x.asset_type]: "rejected" }))}
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${assetStatuses[x.asset_type] === "rejected" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 text-slate-600 hover:border-rose-300"}`}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 p-4">
              <h4 className="text-sm font-semibold text-slate-900">Shop feedback for salesperson</h4>
              <p className="mt-1 text-xs text-slate-500">The rating and comment will be visible to the salesperson on this activation.</p>
              <div className="mt-3 flex gap-1" aria-label="Shop rating">
                {[1,2,3,4,5].map((value) => <button key={value} type="button" onClick={() => setRating(value)}
                  className={`text-2xl ${Number(rating) >= value ? "text-amber-400" : "text-slate-300"}`}
                  aria-label={`${value} star rating`}>★</button>)}
                {rating ? <button type="button" className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setRating("")}>Clear</button> : null}
              </div>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3}
                className={inputCls + " mt-3"} placeholder="Write a comment for the salesperson about this shop" />
              {feedbackMessage ? <p className="mt-2 text-xs font-medium text-emerald-700">{feedbackMessage}</p> : null}
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={saveFeedback} disabled={savingFeedback}>
                  {savingFeedback ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save feedback
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- records -------------------------------- */

function SalespersonProfile({ user, onClose, onOpenRecord }) {
  const [data, setData] = useState({ activations: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.activations({ userId: user.id, limit: 10, offset: 0 })
      .then((result) => live && setData(result))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [user.id]);

  const detail = (label, value) => (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value || "—"}</dd>
    </div>
  );

  return <Modal title="Salesman profile" onClose={onClose} wide>
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{user.name}</h3>
            <p className="text-sm text-slate-500">{user.employeeId} · {roleLabel(user.role)}</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs ${user.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {user.active ? "Active" : "Inactive"}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {detail("Email", user.email)}
          {detail("Contact", user.mobile)}
          {detail("Reporting manager", user.reportingManagerName)}
          {detail("Region", user.region)}
          {detail("State", user.state)}
          {detail("City", user.city)}
          {detail("Area", user.area)}
        </dl>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Recent activations</h4>
            <p className="text-xs text-slate-500">{data.total.toLocaleString("en-IN")} total activation{data.total === 1 ? "" : "s"}</p>
          </div>
        </div>
        {error ? <div className="p-4"><Banner kind="error">{error}</Banner></div> : null}
        {loading ? <div className="flex justify-center py-8 text-slate-400"><Loader2 className="animate-spin" /></div> : (
          <div className="divide-y divide-slate-100">
            {data.activations.map((activation) => <button key={activation.id} type="button"
              onClick={() => onOpenRecord(activation.id)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-teal-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{activation.pharmacy_name}</span>
                <span className="block text-xs text-slate-500">{activation.code} · {activation.city || "City not recorded"}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{fmtDate(activation.occurred_at)}</span>
            </button>)}
            {!data.activations.length && !error ? <p className="px-4 py-8 text-center text-sm text-slate-500">No activations recorded yet.</p> : null}
          </div>
        )}
      </div>
    </div>
  </Modal>;
}

function AdminRecords({ filters, refreshKey, users }) {
  const [search, setSearch] = useState("");
  const [data, setData] = useState({ activations: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [profileUserId, setProfileUserId] = useState("");
  const [error, setError] = useState("");
  const limit = 50;
  const profileUser = users.find((user) => user.id === profileUserId);
  const openProfile = (userId) => {
    if (!userId) return;
    setOpen(null);
    setProfileUserId(userId);
  };

  useEffect(() => { setOffset(0); }, [filters, search]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.activations({ ...filters, search, limit, offset })
        .then((r) => { if (live) { setData(r); setError(""); } })
        .catch((e) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, search ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [filters, search, offset, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by activation ID, shop, city or salesperson" className={inputCls + " pl-9"} />
        </div>
        <ExcelExport filters={{ ...filters, search }} />
      </div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Activation ID</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Shop</th>
                <th className="px-4 py-2 font-medium">City</th>
                <th className="px-4 py-2 font-medium">Salesperson</th>
                <th className="px-4 py-2 text-right font-medium">Units</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.activations.map((a) => (
                <tr key={a.id} onClick={() => setOpen(a.id)} className="cursor-pointer hover:bg-teal-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{a.code}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(a.occurred_at)}</td>
                  <td className="px-4 py-2.5">{a.pharmacy_name}</td>
                  <td className="px-4 py-2.5">{a.city}</td>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={(event) => { event.stopPropagation(); openProfile(a.user_id); }}
                      className="font-medium text-teal-700 hover:underline">
                      {a.user_name}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.units}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(a.status)}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
              {!data.activations.length && !loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No activation records match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{loading ? "Loading" : `${data.total.toLocaleString("en-IN")} records`}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
          <Button variant="ghost" size="sm" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Next</Button>
        </div>
      </div>
      {open ? <RecordDetail id={open} onClose={() => setOpen(null)} onOpenSalesperson={openProfile} /> : null}
      {profileUser ? <SalespersonProfile user={profileUser} onClose={() => setProfileUserId("")}
        onOpenRecord={(id) => { setProfileUserId(""); setOpen(id); }} /> : null}
    </div>
  );
}

/* ---------------------------- plan vs actual ---------------------------- */

const PLAN_HEADERS = ["State", "City", "Area", "Planned Shops"].concat(ASSETS.map((a) => a.label));

function AdminPlan({ a, planCount, filters, onPlansChanged }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = React.useRef(null);

  const upload = async (file) => {
    setBusy(true);
    try {
      const r = await api.importPlans(file, true);
      setMsg({ kind: "success", text: `Replaced the target file with ${r.saved} area rows.` });
      onPlansChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const template = () => {
    const rows = [PLAN_HEADERS.join(","), ["Maharashtra", "Mumbai", "Andheri West", 40, 80, 120, 80, 40, 12, 8, 400].join(",")];
    const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = "planned-targets-template.csv";
    document.body.appendChild(el); el.click(); document.body.removeChild(el);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Planned targets</h3>
            <p className="text-xs text-slate-500">
              {planCount} area rows in the database. Uploading a new file replaces all targets and rebuilds the
              state, city and area lists used across the app.
            </p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.target.value = ""; }} />
            <Button variant="ghost" size="sm" onClick={template}><Download size={15} /> Template</Button>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload targets
            </Button>
          </div>
        </div>
        {msg ? <div className="mt-3"><Banner kind={msg.kind}>{msg.text}</Banner></div> : null}
      </Card>

      <PenTable head="Plan vs actual by state" rows={a.byState} cols={[
        { label: "State", render: (r) => r.key },
        { label: "Planned shops", right: true, render: (r) => r.plannedShops },
        { label: "Actual activated", right: true, render: (r) => r.activatedShops },
        { label: "Gap", right: true, render: (r) => Math.max(0, r.plannedShops - r.activatedShops) },
        { label: "Shop penetration", right: true, render: (r) => <PenCell value={r.shopPen} /> },
      ]} />

      <PenTable head="Plan vs actual by city" rows={a.byCity} cols={[
        { label: "City", render: (r) => r.key },
        { label: "Planned shops", right: true, render: (r) => r.plannedShops },
        { label: "Actual activated", right: true, render: (r) => r.activatedShops },
        { label: "Gap", right: true, render: (r) => Math.max(0, r.plannedShops - r.activatedShops) },
        { label: "Shop penetration", right: true, render: (r) => <PenCell value={r.shopPen} /> },
      ]} />

      <PenTable head="Plan vs actual by area" rows={a.byArea} cols={[
        { label: "Area", render: (r) => r.key },
        { label: "City", render: (r) => r.city },
        { label: "State", render: (r) => r.state },
        { label: "Planned shops", right: true, render: (r) => r.plannedShops },
        { label: "Actual activated", right: true, render: (r) => r.activatedShops },
        { label: "Gap", right: true, render: (r) => Math.max(0, r.plannedShops - r.activatedShops) },
        { label: "Shop penetration", right: true, render: (r) => <PenCell value={r.shopPen} /> },
      ]} />

      <PenTable head="Plan vs actual by asset" rows={a.byAsset} cols={[
        { label: "Asset", render: (r) => r.label },
        { label: "Planned", right: true, render: (r) => r.planned.toLocaleString("en-IN") },
        { label: "Installed", right: true, render: (r) => r.installed.toLocaleString("en-IN") },
        { label: "Remaining", right: true, render: (r) => r.remaining.toLocaleString("en-IN") },
        { label: "Completion", right: true, render: (r) => <PenCell value={r.pen} /> },
      ]} />

      <Button variant="ghost" size="sm"
        onClick={() => api.download("/analytics/export/plan-vs-actual.csv", "plan-vs-actual.csv", filters)}>
        <Download size={15} /> Export plan vs actual
      </Button>
      <ExcelExport filters={filters} />
    </div>
  );
}

/* ----------------------------- data & users ----------------------------- */

const emptyUser = { name: "", employeeId: "", mobile: "", email: "", role: "field", region: "", state: "", city: "", managerId: "", password: "", active: true };
const roleLabel = (role) => ({ admin: "Admin", regional_head: "Regional Head", city_head: "City Head", team_lead: "Team Lead", field: "Salesman" }[role] || role);
const parentRoles = { city_head: ["regional_head"], team_lead: ["regional_head", "city_head"], field: ["regional_head", "city_head", "team_lead"] };

function AdminData({ geo, users, filters, onUsersChanged, masterAdmin }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyUser);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [userView, setUserView] = useState("all");
  const [expandedUsers, setExpandedUsers] = useState(() => new Set());
  const [userSearch, setUserSearch] = useState("");

  const searchedUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return [];
    return users.filter((user) => [
      user.name, user.employeeId, user.email, user.mobile, roleLabel(user.role),
      user.region, user.state, user.city, user.area, user.reportingManagerName,
    ].some((value) => String(value || "").toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, userSearch]);

  const usersByManager = useMemo(() => {
    const grouped = new Map();
    users.forEach((user) => {
      const key = user.managerId || "unassigned";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(user);
    });
    grouped.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name)));
    return grouped;
  }, [users]);

  const toggleUser = (id) => setExpandedUsers((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const territory = (user) => user.role === "admin" ? "PAN India"
    : user.role === "regional_head" ? (user.region || "Region required")
      : [user.city, user.state, user.region].filter(Boolean).join(", ") || "Territory required";

  const editUser = (user) => { setDraft({ ...user, password: "" }); setEditing(user.id); setErr(""); };

  const HierarchyRow = ({ user, depth = 0 }) => {
    const children = user.role === "admin" ? [] : (usersByManager.get(user.id) || []).filter((child) => child.role !== "admin");
    const open = expandedUsers.has(user.id);
    return <>
      <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-3 first:border-t-0 hover:bg-slate-50">
        <div style={{ paddingLeft: `${Math.min(depth, 3) * 24}px` }} className="flex min-w-0 flex-1 items-center gap-2">
          {children.length ? <button type="button" onClick={() => toggleUser(user.id)}
            aria-label={`${open ? "Collapse" : "Expand"} ${user.name}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700">
            {open ? <ChevronUp size={15}/> : <ChevronDown size={15}/>} </button>
          : <span className="h-7 w-7 shrink-0" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{user.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{roleLabel(user.role)}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${user.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{user.active ? "Active" : "Inactive"}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">{user.employeeId} · {territory(user)}{user.reportingManagerName ? ` · Reports to ${user.reportingManagerName}` : ""}</p>
          </div>
        </div>
        {children.length ? <span className="hidden text-xs text-slate-400 sm:inline">{children.length} direct</span> : null}
        <div className="shrink-0 whitespace-nowrap">
          {(user.role !== "admin" || masterAdmin) ? <button onClick={() => editUser(user)} className="mr-3 text-xs font-medium text-teal-700 hover:underline">Edit</button> : null}
          {user.active && (user.role !== "admin" || masterAdmin) && user.employeeId !== "ADMIN001" ? <button onClick={() => deactivate(user.id)} className="text-xs font-medium text-rose-600 hover:underline">Deactivate</button> : null}
        </div>
      </div>
      {open ? children.map((child) => <HierarchyRow key={child.id} user={child} depth={depth + 1}/>) : null}
    </>;
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    if (draft.role === "regional_head" && !draft.region?.trim()) {
      setErr("Enter a Region for the Regional Head.");
      setBusy(false);
      return;
    }
    if (["city_head", "team_lead", "field"].includes(draft.role) && (!draft.state?.trim() || !draft.city?.trim() || !draft.managerId)) {
      setErr("Select a reporting manager and enter both state and city.");
      setBusy(false);
      return;
    }
    try {
      if (editing === "new") await api.createUser(draft);
      else {
        const patch = { ...draft };
        delete patch.id;
        if (!patch.password) delete patch.password;
        await api.updateUser(editing, patch);
      }
      setEditing(null);
      onUsersChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const deactivate = async (id) => {
    try { await api.deactivateUser(id); onUsersChanged(); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Exports</h3>
        <p className="mb-3 text-xs text-slate-500">The activation export follows the filters set at the top of the dashboard.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm"
            onClick={() => api.download("/analytics/export/activations.csv", "activation-records.csv", filters)}>
            <Download size={15} /> Activation data with photo keys
          </Button>
        </div>
      </Card>

      {err ? <Banner kind="error">{err}</Banner> : null}

      <BulkUsers role="admin" onImported={onUsersChanged} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div><h3 className="text-sm font-semibold text-slate-900">Users and reporting hierarchy</h3>
            <p className="text-xs text-slate-500">Only ADMIN001 can create or manage Admin accounts.</p></div>
          <Button size="sm" onClick={() => { setDraft(emptyUser); setEditing("new"); setErr(""); }}>
            <Plus size={15} /> Add user
          </Button>
        </div>
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)}
              className={inputCls + " pl-9"}
              placeholder="Search any name, employee ID, contact, territory or reporting manager" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          {[['all','All'],['regional_head','Regional Heads'],['city_head','City Heads'],['team_lead','Team Leads']].map(([value, label]) => <button key={value} type="button" onClick={() => setUserView(value)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${userView === value ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-teal-300"}`}>{label}</button>)}
        </div>
        {userSearch.trim() ? <div className="p-4">
          <p className="mb-2 text-xs text-slate-500">{searchedUsers.length} matching user{searchedUsers.length === 1 ? "" : "s"}</p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {searchedUsers.map((user) => <HierarchyRow key={user.id} user={user}/>) }
            {!searchedUsers.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">No users match that search.</p> : null}
          </div>
        </div> : userView === "all" ? <div className="p-4">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Admins</h4>
            <div className="overflow-hidden rounded-lg border border-slate-200">{users.filter((u) => u.role === "admin").sort((a,b) => a.name.localeCompare(b.name)).map((u) => <HierarchyRow key={u.id} user={u}/>)}</div>
          </section>
          <section className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Regional hierarchy</h4>
            <p className="mb-2 text-xs text-slate-500">Select a Regional Head to see their City Heads, Team Leads and Salesmen.</p>
            <div className="overflow-hidden rounded-lg border border-slate-200">{users.filter((u) => u.role === "regional_head").sort((a,b) => a.name.localeCompare(b.name)).map((u) => <HierarchyRow key={u.id} user={u}/>)}</div>
          </section>
          {users.filter((u) => !["admin","regional_head"].includes(u.role) && !users.some((parent) => parent.id === u.managerId)).length ? <section className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Reporting manager missing</h4>
            <div className="overflow-hidden rounded-lg border border-amber-200">{users.filter((u) => !["admin","regional_head"].includes(u.role) && !users.some((parent) => parent.id === u.managerId)).map((u) => <HierarchyRow key={u.id} user={u}/>)}</div>
          </section> : null}
        </div> : <div className="p-4">
          <p className="mb-2 text-xs text-slate-500">Showing all {roleLabel(userView)} accounts. Reporting manager and territory remain visible for context.</p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {users.filter((u) => u.role === userView).sort((a,b) => a.name.localeCompare(b.name)).map((u) => <HierarchyRow key={u.id} user={u}/>) }
            {!users.some((u) => u.role === userView) ? <p className="px-4 py-8 text-center text-sm text-slate-500">No {roleLabel(userView)} accounts found.</p> : null}
          </div>
        </div>}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Users are deactivated rather than deleted so their activation history and photo proof stay auditable.
        </p>
      </Card>

      {editing ? (
        <Modal title={editing === "new" ? "Add user" : "Edit user"} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field label="Name" required><TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee ID" required><TextInput value={draft.employeeId} onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })} /></Field>
              <Field label="Mobile"><TextInput value={draft.mobile || ""} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} /></Field>
            </div>
            <Field label="Email"><TextInput value={draft.email || ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value, region: "", state: "", city: "", managerId: "" })} className={inputCls}>
                  <option value="field">Salesman</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="city_head">City Head</option>
                  <option value="regional_head">Regional Head</option>
                  {masterAdmin ? <option value="admin">Admin</option> : null}
                </select>
              </Field>
              <Field label={editing === "new" ? "Initial password" : "Reset password"}
                hint={editing === "new" ? "Minimum 8 characters" : "Leave blank to keep the current one"}>
                <TextInput type="password" value={draft.password || ""} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </Field>
            </div>
            {draft.role === "regional_head" ? <Field label="Region" required hint="Enter the Region manually; this is inherited by everyone below this account.">
              <TextInput value={draft.region || ""} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="e.g. West Region" />
            </Field> : null}
            {["city_head", "team_lead", "field"].includes(draft.role) ? <>
            <Field label="Reporting manager" required>
              <select value={draft.managerId || ""} onChange={(e) => setDraft({ ...draft, managerId: e.target.value })} className={inputCls}>
                <option value="">Select reporting manager</option>
                {users.filter((u) => u.active && (parentRoles[draft.role] || []).includes(u.role) && u.id !== editing).map((u) =>
                  <option key={u.id} value={u.id}>{u.name} · {roleLabel(u.role)} · {u.region || "No Region"}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assigned state" required>
                <ComboInput value={draft.state || ""} onChange={(v) => setDraft({ ...draft, state: v, city: "" })} options={geo.states} placeholder="Type or select state" />
              </Field>
              <Field label="Assigned city" required>
                <ComboInput value={draft.city || ""} onChange={(v) => setDraft({ ...draft, city: v })} options={draft.state ? geo.cities(draft.state) : []} placeholder="Type or select city" />
              </Field>
            </div></> : draft.role === "admin" ? <Banner kind="info">Admins have PAN India access.</Banner> : null}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.active !== false} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Account is active
            </label>
            {err ? <Banner kind="error">{err}</Banner> : null}
            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Save user</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function AdminAuditLog() {
  const [data, setData] = useState({ entries: [], total: 0 });
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;
  useEffect(() => { setOffset(0); }, [search]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api.auditLog({ search, limit, offset }).then((result) => {
        if (live) { setData(result); setError(""); }
      }).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    }, search ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [search, offset]);
  const actionLabel = (action) => String(action || "").split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" · ");
  return <div className="space-y-3">
    <Card className="p-4"><h2 className="font-semibold">Activity log</h2><p className="mt-1 text-sm text-slate-500">A chronological record of account, target, master-data and activation changes.</p>
      <div className="relative mt-3"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input className={inputCls+" pl-9"} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search person, employee ID, action or record ID"/></div>
    </Card>
    {error?<Banner kind="error">{error}</Banner>:null}
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Date and time</th><th className="px-4 py-2">Changed by</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Record</th><th className="px-4 py-2">Details</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{loading?<tr><td colSpan="5" className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto animate-spin"/></td></tr>:data.entries.map((entry)=><tr key={entry.id}>
        <td className="whitespace-nowrap px-4 py-3">{new Date(entry.created_at).toLocaleString()}</td>
        <td className="px-4 py-3"><span className="font-medium">{entry.actor_name||"System"}</span><span className="block text-xs text-slate-500">{entry.actor_employee_id||"—"}</span></td>
        <td className="px-4 py-3 font-medium">{actionLabel(entry.action)}</td>
        <td className="px-4 py-3"><span className="capitalize">{String(entry.entity||"").replaceAll("_"," ")}</span><span className="block max-w-48 truncate text-xs text-slate-500" title={entry.entity_id||""}>{entry.entity_id||"—"}</span></td>
        <td className="px-4 py-3"><code className="block max-w-md whitespace-pre-wrap break-words text-xs text-slate-600">{entry.detail?JSON.stringify(entry.detail):"—"}</code></td>
      </tr>)}{!loading&&!data.entries.length?<tr><td colSpan="5" className="px-4 py-10 text-center text-slate-400">No activity matches this search.</td></tr>:null}</tbody>
    </table></div>
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>{data.total.toLocaleString("en-IN")} changes</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</Button><Button size="sm" variant="ghost" disabled={offset+limit>=data.total} onClick={()=>setOffset(offset+limit)}>Next</Button></div></div>
    </Card>
  </div>;
}


/* ------------------------------ approvals ------------------------------ */
function AdminApprovals({ onApproved }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(() => api.requests().then((r) => setItems(r.requests)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    setBusy(id + action);
    setError("");
    try {
      if (action === "approve") await api.approveRequest(id);
      else await api.rejectRequest(id);
      await load();
      if (onApproved) onApproved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const title = (request) => request.type === "target_change"
    ? "Target change"
    : request.type === "user_create"
      ? "Field user creation (legacy)"
      : "Field user deactivation";

  const requestFields = (request) => {
    const { password, ...payload } = request.payload || {};
    if (request.type === "target_change") {
      const assets = Object.entries(payload.assets || {})
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([asset, quantity]) => `${assetLabel(asset)}: ${quantity}`)
        .join(", ");
      return [
        ["Territory", [payload.area, payload.city, payload.state].filter(Boolean).join(", ") || "—"],
        ["Change", payload.changeType ? `${payload.changeType} target` : "—"],
        ["Planned shops", payload.plannedShops ?? "—"],
        ...(assets ? [["Assets", assets]] : []),
      ];
    }
    if (request.type === "user_create") {
      return [
        ["Salesperson", payload.name || "—"],
        ["Employee ID", payload.employeeId || "—"],
        ["Territory", [payload.city, payload.state].filter(Boolean).join(", ") || "—"],
      ];
    }
    return [["Field user reference", payload.userId || "—"]];
  };

  const RequestCard = ({ request, compact = false }) => (
    <div className={compact ? "px-4 py-3" : "p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{title(request)}</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${
              request.status === "approved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : request.status === "rejected"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
            }`}>{request.status}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {request.requested_by_name} · {new Date(request.created_at).toLocaleString()}
          </p>
        </div>
        {request.status === "pending" ? (
          <div className="flex gap-2">
            <Button size="sm" variant="success" disabled={!!busy} onClick={() => act(request.id, "approve")}>
              {busy === request.id + "approve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
            </Button>
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => act(request.id, "reject")}>
              <XCircle size={14} /> Reject
            </Button>
          </div>
        ) : null}
      </div>

      <dl className={`mt-3 grid gap-x-6 gap-y-2 text-sm ${compact ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {requestFields(request).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {request.reason ? <p className="mt-3 text-sm text-slate-600"><span className="font-medium text-slate-700">Reason:</span> {request.reason}</p> : null}
      {request.review_note ? <p className="mt-1 text-xs text-slate-500">Review note: {request.review_note}</p> : null}
    </div>
  );

  const pending = items.filter((request) => request.status === "pending");
  const history = items.filter((request) => request.status !== "pending");

  return (
    <div className="space-y-4">
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Pending approvals</h3>
            <p className="text-xs text-slate-500">Only target changes need admin action.</p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">{pending.length} pending</span>
        </div>
        <div className="divide-y divide-slate-100">
          {pending.map((request) => <RequestCard key={request.id} request={request} />)}
          {!pending.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <CheckCircle2 size={24} className="text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">You’re all caught up</p>
              <p className="text-xs text-slate-500">There are no target changes waiting for approval.</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <button type="button" onClick={() => setShowHistory((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50">
          <span className="flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Approval history</span>
              <span className="block text-xs text-slate-500">{history.length} completed or rejected requests</span>
            </span>
          </span>
          {showHistory ? <ChevronUp size={17} className="text-slate-400" /> : <ChevronDown size={17} className="text-slate-400" />}
        </button>
        {showHistory ? (
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {history.map((request) => <RequestCard key={request.id} request={request} compact />)}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* -------------------------------- shell --------------------------------- */

export default function AdminApp({ user, geo, planCount, onPlansChanged, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [f, setF] = useState({ from: daysAgoStr(30), to: todayStr(), state: "", city: "", area: "", rhId: "", chId: "", tlId: "", scopeUserId: "", userId: "", asset: "" });
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadUsers = useCallback(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Keep cross-role changes fresh without requiring a full page reload. Focus
  // refreshes are immediate; polling covers a manager/field tab left open.
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "hidden") return;
      loadUsers();
      setRefreshKey((key) => key + 1);
    };
    const interval = window.setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [loadUsers]);

  useEffect(() => {
    let live = true;
    api.summary(f)
      .then((s) => live && (setSummary(s), setError("")))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [f, refreshKey]);

  // The presentational cards expect a flat shape.
  const a = useMemo(() => {
    if (!summary) return null;
    return {
      ...summary,
      plannedShops: summary.totals.plannedShops,
      activatedShops: summary.totals.activatedShops,
      shopPen: summary.totals.shopPen,
      plannedAssets: summary.totals.plannedAssets,
      installedAssets: summary.totals.installedAssets,
      assetPen: summary.totals.assetPen,
      activeUsers: summary.totals.activeUsers,
      todayCount: summary.totals.today,
    };
  }, [summary]);

  // Admin geography is sourced from the current pharmacy master, not the old
  // target upload. The backend returns cascading choices for the active state
  // and city so newly uploaded locations appear without a redeploy.
  const liveGeo = useMemo(() => ({
    states: summary?.filterOptions?.states || geo.states || [],
    cities: () => summary?.filterOptions?.cities || [],
    areas: () => summary?.filterOptions?.areas || [],
  }), [summary, geo]);

  const tabs = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "analytics", label: "Performance", icon: BarChart3 },
    { key: "records", label: "Records", icon: FileText },
    { key: "plan", label: "Plan vs actual", icon: Target },
    { key: "data", label: "Data", icon: Users },
    { key: "approvals", label: "Approvals", icon: ClipboardCheck },
    { key: "activity", label: "Activity log", icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white"><Store size={17} /></span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{APP_NAME}</p>
              <p className="text-xs text-slate-500">{BRAND_LINE}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user.name}</span>
            <Button variant="ghost" size="sm" onClick={onLogout}><LogOut size={15} /> Log out</Button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
                  tab === t.key ? "border-teal-600 font-medium text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}>
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        {tab !== "data" && tab !== "approvals" && tab !== "activity" ? <FilterBar geo={liveGeo} users={users} f={f} setF={setF} /> : null}
        {(tab === "overview" || tab === "analytics") ? <ExcelExport filters={f} /> : null}
        {error ? <Banner kind="error">{error}</Banner> : null}

        {tab !== "data" && tab !== "approvals" && tab !== "activity" && tab !== "records" && !a ? (
          <div className="flex justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>
        ) : null}

        {tab === "overview" && a ? <AdminOverview a={a} /> : null}
        {tab === "analytics" && a ? <AdminAnalytics a={a} /> : null}
        {tab === "records" ? (
          <AdminRecords filters={f} refreshKey={refreshKey} users={users} />
        ) : null}
        {tab === "plan" && a ? (
          <AdminPlan a={a} planCount={planCount} filters={f} onPlansChanged={onPlansChanged} />
        ) : null}
        {tab === "data" ? (
          <AdminData geo={geo} users={users} filters={f} masterAdmin={user.employeeId === "ADMIN001"} onUsersChanged={() => { loadUsers(); setRefreshKey((key) => key + 1); }} />
        ) : null}
        {tab === "approvals" ? <AdminApprovals onApproved={() => { onPlansChanged(); loadUsers(); setRefreshKey((k) => k + 1); }} /> : null}
        {tab === "activity" ? <AdminAuditLog /> : null}
      </main>
    </div>
  );
}
