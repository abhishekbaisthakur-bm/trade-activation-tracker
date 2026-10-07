import React, { useCallback, useEffect, useState } from "react";
import { Store, LogOut, Send, Users, Target, Clock, Loader2, Plus, KeyRound, CheckCircle2, XCircle, Download, Upload, BarChart3 } from "lucide-react";
import { api } from "./api";
import BulkUsers from "./BulkUsers";
import { APP_NAME, BRAND_LINE, ASSETS, inputCls, Field, TextInput, Select, ComboInput, Button, Card, Banner, Modal, PenTable, PenCell, statusTone } from "./ui";

const emptyAssets = Object.fromEntries(ASSETS.map(a => [a.key, 0]));
const emptyTarget = () => ({ state:"", city:"", area:"", plannedShops:0, changeType:"addition", assets:{...emptyAssets} });
const emptyField = () => ({ name:"", employeeId:"", mobile:"", email:"", role:"field", managerId:"", state:"", city:"", password:"" });
const roleLabel = (role) => ({ regional_head:"Regional Head", city_head:"City Head", team_lead:"Team Lead", field:"Salesman" }[role] || role);
const childRoles = { regional_head:["city_head","team_lead","field"], city_head:["team_lead","field"], team_lead:["field"] };
const parentRoles = { city_head:["regional_head"], team_lead:["regional_head","city_head"], field:["regional_head","city_head","team_lead"] };

function PageControls({ pagination, onPage }) {
  if (!pagination?.total) return null;
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.total, pagination.page * pagination.pageSize);
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
    <span>Showing {from}–{to} of {pagination.total.toLocaleString("en-IN")}</span>
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pagination.page <= 1} onClick={()=>onPage(pagination.page - 1)}>Previous</Button>
      <span>Page {pagination.page} of {pagination.pages}</span>
      <Button variant="ghost" size="sm" disabled={pagination.page >= pagination.pages} onClick={()=>onPage(pagination.page + 1)}>Next</Button>
    </div>
  </div>;
}

function RequestHistory({ refresh }) {
  const [items,setItems]=useState([]); const [error,setError]=useState("");
  useEffect(()=>{ api.requests().then(r=>setItems(r.requests)).catch(e=>setError(e.message)); },[refresh]);
  const label = (x) => x.type === 'target_change' ? 'Target change' : x.type === 'user_create' ? 'Add field user' : 'Deactivate field user';
  return <div className="space-y-3">{error?<Banner kind="error">{error}</Banner>:null}<Card className="overflow-hidden">
<div className="border-b border-slate-200 px-4 py-3">
<h3 className="text-sm font-semibold">My requests</h3>
</div>
<div className="overflow-x-auto">
<table className="w-full text-sm">
<thead className="bg-slate-50 text-xs text-slate-500">
<tr>
<th className="px-4 py-2 text-left">Request</th>
<th className="px-4 py-2 text-left">Reason</th>
<th className="px-4 py-2 text-left">Date</th>
<th className="px-4 py-2 text-left">Status</th>
</tr>
</thead>
<tbody className="divide-y divide-slate-100">{items.map(r=>
<tr key={r.id}>
<td className="px-4 py-3 font-medium">{label(r)}</td>
<td className="px-4 py-3">{r.reason}</td>
<td className="px-4 py-3">{new Date(r.created_at).toLocaleString()}</td>
<td className="px-4 py-3 capitalize">{r.status}</td>
</tr>)}{!items.length?<tr>
<td colSpan="4" className="px-4 py-8 text-center text-slate-400">No requests yet.</td>
</tr>:null}</tbody>
</table>
</div>
</Card>
</div>
}

function ReadOnlyMasterList() {
  const [shops, setShops] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => api.masterPharmacies(search, page).then((result) => {
      if (live) { setShops(result.pharmacies); setPagination(result.pagination); setError(""); }
    }).catch((e) => live && setError(e.message)), search ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [search, page]);
  return <div className="space-y-3">
    {error ? <Banner kind="error">{error}</Banner> : null}
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold">Master list</h3>
        <p className="text-xs text-slate-500">Read-only pharmacies for your assigned location.</p>
        <TextInput value={search} onChange={(e)=>{setSearch(e.target.value);setPage(1)}} placeholder="Search pharmacy, RIO ID, Party/Alt Code or city" className="mt-3"/>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Pharmacy</th><th className="px-3 py-2">Geography</th><th className="px-3 py-2">Status</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{shops.map((shop)=><tr key={shop.id}>
          <td className="max-w-xl px-3 py-2"><p className="font-medium">{shop.name}</p><p className="text-xs text-slate-500">RIO: {shop.rio_id||"—"} · Party/Alt: {shop.party_alt_code||"—"}</p><p className="truncate text-xs text-slate-500" title={shop.address||""}>{shop.address||"—"}</p></td>
          <td className="px-3 py-2">{[shop.city,shop.state].filter(Boolean).join(", ")||"—"}</td><td className="px-3 py-2">{shop.active?"Active":"Inactive"}</td>
        </tr>)}{!shops.length?<tr><td colSpan="3" className="px-4 py-8 text-center text-slate-400">No master shops found for your location.</td></tr>:null}</tbody>
      </table></div><PageControls pagination={pagination} onPage={setPage}/>
    </Card>
  </div>;
}

function MasterDataReviews({ canManage }) {
  const [items, setItems] = useState([]);
  const [shops, setShops] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [editing, setEditing] = useState(null);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeOptions, setMergeOptions] = useState([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [draft, setDraft] = useState({ name:"", rioId:"", partyAltCode:"", address:"", state:"", city:"" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = async (nextPage = page) => {
    try {
      const [reviews, master] = await Promise.all([canManage ? api.masterDataReviews() : Promise.resolve({ reviews: [] }), api.masterPharmacies(search, nextPage)]);
      setItems(reviews.reviews); setShops(master.pharmacies); setPagination(master.pagination); setError("");
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => api.masterPharmacies(search, page).then((r) => {setShops(r.pharmacies);setPagination(r.pagination)}).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(timer);
  }, [search, page]);

  useEffect(() => {
    if (!mergeSource) return;
    let live = true;
    const timer = setTimeout(() => api.masterPharmacies(mergeSearch, 1, 25).then((r) => {
      if (live) setMergeOptions(r.pharmacies.filter((shop)=>shop.id!==mergeSource.id&&shop.active));
    }).catch((e)=>live&&setError(e.message)), mergeSearch ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [mergeSource, mergeSearch]);

  const act = async (id, action) => {
    setBusy(`${id}:${action}`);
    setError("");
    try {
      if (action === "approve") await api.approveMasterData(id);
      else await api.rejectMasterData(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const resetDraft = () => { setEditing(null); setDraft({ name:"", rioId:"", partyAltCode:"", address:"", state:"", city:"" }); };
  const saveShop = async () => {
    setBusy("save"); setError("");
    try {
      const payload = { ...draft };
      if (editing) await api.updateMasterPharmacy(editing, payload); else await api.saveMasterPharmacy(payload);
      resetDraft(); await load();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const template = () => {
    const csv = "Pharmacy Name,Rio Id,Party/Alt Code,Address (optional),City (optional),State (Optional)\nExample Pharmacy,RIO12345,DIST-PARTY-101,Shop address,Mumbai,Maharashtra\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "pharmacy-master-template.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const importCsv = async (file) => {
    setBusy("import"); setError("");
    try { await api.importMasterPharmacies(file); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  return (
    <div className="space-y-3">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {canManage ? <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{editing ? "Edit master shop" : "Add to master list"}</h3>
            <p className="text-xs text-slate-500">Manager-added shops and geography are verified immediately.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={template}><Download size={14}/> Template</Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white">
              {busy === "import" ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>} Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e)=>{const file=e.target.files?.[0];if(file)importCsv(file);e.target.value=""}}/>
            </label>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Pharmacy Name" required><TextInput value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})}/></Field>
          <Field label="RIO ID" required><TextInput value={draft.rioId} onChange={(e)=>setDraft({...draft,rioId:e.target.value})}/></Field>
          <Field label="Party/Alt Code" required><TextInput value={draft.partyAltCode} onChange={(e)=>setDraft({...draft,partyAltCode:e.target.value})}/></Field>
          <Field label="Address"><TextInput value={draft.address} onChange={(e)=>setDraft({...draft,address:e.target.value})}/></Field>
          <Field label="City (optional)"><TextInput value={draft.city} onChange={(e)=>setDraft({...draft,city:e.target.value})}/></Field>
          <Field label="State (optional)"><TextInput value={draft.state} onChange={(e)=>setDraft({...draft,state:e.target.value})}/></Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button disabled={!!busy} onClick={saveShop}>{busy === "save" ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} {editing ? "Save changes" : "Add verified shop"}</Button>
          {editing ? <Button variant="ghost" onClick={resetDraft}>Cancel</Button> : null}
        </div>
      </Card> : null}
      {canManage ? <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold">Shop and geography verification</h3>
          <p className="text-xs text-slate-500">
            New values remain usable on the activation, but only approved values become future suggestions.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {items.map((item) => {
            const p = item.payload || {};
            return (
              <div key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{p.pharmacyName}</p>
                    <p className="text-sm text-slate-600">{[p.area, p.city, p.state].filter(Boolean).join(", ")}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.activation_code} · {item.submitted_by_name} ({item.submitted_by_employee_id})
                    </p>
                  </div>
                  <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{item.status}</span>
                </div>
                {p.address ? <p className="mt-2 text-sm text-slate-600"><b>Address:</b> {p.address}</p> : null}
                {item.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="success" disabled={!!busy} onClick={() => act(item.id, "approve")}>
                      {busy === `${item.id}:approve` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve master data
                    </Button>
                    <Button size="sm" variant="danger" disabled={!!busy} onClick={() => act(item.id, "reject")}>
                      <XCircle size={14} /> Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!items.length ? <div className="p-10 text-center text-sm text-slate-400">No master-data reviews.</div> : null}
        </div>
      </Card> : null}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold">Territory master list</h3>
          <TextInput value={search} onChange={(e)=>{setSearch(e.target.value);setPage(1)}} placeholder="Search pharmacy, RIO ID, Party/Alt Code or city" className="mt-3"/>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Shop</th><th className="px-3 py-2">Geography</th><th className="px-3 py-2">Status</th>{canManage?<th className="px-3 py-2">Actions</th>:null}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shops.map((shop)=><tr key={shop.id}>
                <td className="max-w-xl px-3 py-2"><p className="font-medium">{shop.name}</p><p className="text-xs text-slate-500">RIO: {shop.rio_id||"—"} · Party/Alt: {shop.party_alt_code||"—"}</p><p className="truncate text-xs text-slate-500" title={shop.address||""}>{shop.address||"—"}</p></td>
                <td className="whitespace-nowrap px-3 py-2">{[shop.city,shop.state].filter(Boolean).join(", ")||"—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{shop.active ? "Active" : "Inactive"}</td>
                {canManage?<td className="px-3 py-2"><div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={()=>{setEditing(shop.id);setDraft({name:shop.name,rioId:shop.rio_id||"",partyAltCode:shop.party_alt_code||"",address:shop.address||"",state:shop.state||"",city:shop.city||""})}}>Edit</Button>
                  {shop.active?<Button variant="danger" size="sm" onClick={async()=>{setBusy(shop.id);try{await api.deactivateMasterPharmacy(shop.id);await load()}catch(e){setError(e.message)}finally{setBusy("")}}}>Deactivate</Button>:null}
                  <Button variant="ghost" size="sm" onClick={()=>{setMergeSource(shop);setMergeSearch("");setMergeTarget("")}}>Merge duplicate</Button>
                </div></td>:null}
              </tr>)}
              {!shops.length?<tr><td colSpan={canManage?4:3} className="px-4 py-8 text-center text-slate-400">No master shops found for your location.</td></tr>:null}
            </tbody>
          </table>
        </div>
        <PageControls pagination={pagination} onPage={setPage}/>
      </Card>
      {mergeSource ? <Modal title={`Merge ${mergeSource.name}`} onClose={()=>setMergeSource(null)}>
        <p className="mb-3 text-sm text-slate-600">Choose the verified shop to keep. Activations will move to it and this duplicate will be deactivated.</p>
        <Field label="Search target shop"><TextInput value={mergeSearch} onChange={(e)=>{setMergeSearch(e.target.value);setMergeTarget("")}} placeholder="Search name, RIO ID or Party/Alt Code"/></Field>
        <Field label="Keep this shop" required>
          <select className={inputCls} value={mergeTarget} onChange={(e)=>setMergeTarget(e.target.value)}>
            <option value="">Select a target shop</option>
            {mergeOptions.map((shop)=><option key={shop.id} value={shop.id}>{shop.name} · RIO {shop.rio_id||"—"} · {shop.city||"—"}</option>)}
          </select>
        </Field>
        <div className="mt-4 flex gap-2">
          <Button disabled={!mergeTarget||busy===`merge:${mergeSource.id}`} onClick={async()=>{setBusy(`merge:${mergeSource.id}`);try{await api.mergeMasterPharmacy(mergeSource.id,mergeTarget);setMergeSource(null);await load()}catch(e){setError(e.message)}finally{setBusy("")}}}>Merge duplicate</Button>
          <Button variant="ghost" onClick={()=>setMergeSource(null)}>Cancel</Button>
        </div>
      </Modal> : null}
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
    <Card className="p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Change password</h2>
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

        <Button onClick={submit} disabled={busy}>
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <KeyRound size={16} />
          )}
          Change password
        </Button>
      </div>
      <Button className="mt-3" variant="ghost" size="sm" onClick={() => api.download("/analytics/export/performance.xlsx", "performance-report.xlsx", filters)}>
        <Download size={15}/> Download Excel
      </Button>
    </Card>
  );
}

function ManagerPerformance({ user, geo }) {
  const [filters, setFilters] = useState({ city: user.city || "", area: "" });
  const [peopleRole, setPeopleRole] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setData(null);
    api.managerSummary(filters)
      .then((result) => { if (live) { setData(result); setError(""); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [filters]);

  return <div className="space-y-4">
    <Card className="p-4">
      <p className="text-sm font-semibold text-slate-900">Territory target performance</p>
      <p className="mt-1 text-xs text-slate-500">Scope: {user.region || "Assigned hierarchy"}{user.state ? ` · ${user.state}` : ""}{user.city ? ` · ${user.city}` : ""}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="City">
          <Select value={filters.city} onChange={(city) => setFilters({ city, area: "" })}
            options={geo.cities(user.state || "")} placeholder="All cities" disabled={!!user.city} />
        </Field>
        <Field label="Area">
          <Select value={filters.area} onChange={(area) => setFilters((f) => ({ ...f, area }))}
            options={geo.areas(filters.city, user.state)} placeholder="All areas" />
        </Field>
      </div>
    </Card>
    {error ? <Banner kind="error">{error}</Banner> : null}
    {!data ? <div className="flex justify-center py-12 text-slate-400"><Loader2 className="animate-spin" size={22}/></div> : <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-slate-500">Planned shops</p><p className="mt-1 text-2xl font-semibold">{data.totals.plannedShops}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Activated shops</p><p className="mt-1 text-2xl font-semibold">{data.totals.activatedShops}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Shop penetration</p><p className="mt-1 text-2xl font-semibold">{data.totals.shopPen}%</p></Card>
      </div>
      <PenTable head="State-wise plan vs actual" rows={data.byState} cols={[
        { label: "State", render: (r) => r.key },
        { label: "Planned", right: true, render: (r) => r.plannedShops },
        { label: "Activated", right: true, render: (r) => r.activatedShops },
        { label: "Penetration", right: true, render: (r) => <PenCell value={r.shopPen}/> },
      ]}/>
      <PenTable head="City-wise plan vs actual" rows={data.byCity} cols={[
        { label: "City", render: (r) => r.key },
        { label: "Planned", right: true, render: (r) => r.plannedShops },
        { label: "Activated", right: true, render: (r) => r.activatedShops },
        { label: "Penetration", right: true, render: (r) => <PenCell value={r.shopPen}/> },
      ]}/>
      <PenTable head="Area-wise plan vs actual" rows={data.byArea} cols={[
        { label: "Area", render: (r) => r.key },
        { label: "City", render: (r) => r.city },
        { label: "Planned", right: true, render: (r) => r.plannedShops },
        { label: "Activated", right: true, render: (r) => r.activatedShops },
        { label: "Penetration", right: true, render: (r) => <PenCell value={r.shopPen}/> },
      ]}/>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">People performance</p><p className="text-xs text-slate-500">You and only the people below you in the reporting hierarchy.</p></div>
          <select className={`${inputCls} sm:w-52`} value={peopleRole} onChange={(event)=>setPeopleRole(event.target.value)}>
            <option value="">All hierarchy levels</option>
            <option value="regional_head">Regional Heads</option>
            <option value="city_head">City Heads</option>
            <option value="team_lead">Team Leads</option>
            <option value="field">Salesmen</option>
          </select>
        </div>
      </Card>
      <PenTable head="Hierarchy performance" rows={(data.byPeople || []).filter((person)=>!peopleRole||person.role===peopleRole)} cols={[
        { label:"Person", render:(r)=><span><span className="font-medium">{r.name}</span><span className="block text-xs text-slate-500">{r.employeeId}</span></span> },
        { label:"Level", render:(r)=>r.roleLabel },
        { label:"Reports to", render:(r)=>r.reportingManager||"—" },
        { label:"Salespeople", right:true, render:(r)=>r.teamSize },
        { label:"Shops", right:true, render:(r)=>r.shops },
        { label:"Assets", right:true, render:(r)=>r.installed },
        { label:"Completion", right:true, render:(r)=><PenCell value={r.completion}/> },
      ]}/>
    </>}
  </div>;
}

export default function ManagerApp({ user, geo, onLogout }) {
  const [tab,setTab]=useState("overview"), [refresh,setRefresh]=useState(0), [msg,setMsg]=useState(null), [busy,setBusy]=useState(false);
  const [teamData, setTeamData] = useState({ totals: { members: 0, salesmen: 0, storesActivated: 0, activations: 0 }, members: [], salesmen: [] });
  const [selectedSalesman, setSelectedSalesman] = useState(null);
  const [salesmanDetails, setSalesmanDetails] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});
  const newTarget = () => ({ ...emptyTarget(), state: user.state || "", city: user.city || "" });
  const newField = () => ({ ...emptyField(), role: (childRoles[user.role] || ["field"])[0], managerId: user.id, state: user.state || "", city: user.city || "" });
  const [target,setTarget]=useState(newTarget), [field,setField]=useState(newField), [fieldUsers,setFieldUsers]=useState([]), [deactivateId,setDeactivateId]=useState("");
  const loadFieldUsers = useCallback(() =>
    api.managedUsers().then((r) => setFieldUsers(r.users)), []);
  const loadTeam = useCallback(() =>
    api.managerTeam()
      .then((r) => setTeamData(r))
      .catch((e) => setMsg({ kind: "error", text: e.message })), []);

  useEffect(() => { loadFieldUsers().catch(() => {}); }, [loadFieldUsers]);
  useEffect(() => {
    loadTeam();
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") {
        loadTeam();
        loadFieldUsers().catch(() => {});
      }
    };
    const interval = window.setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [loadTeam, loadFieldUsers]);
  const submit=async(type,payload,reason)=>{ setBusy(true);setMsg(null);try{await api.createRequest(type,payload,reason);setMsg({kind:'success',text:'Request submitted for admin approval. No live data has changed.'});setRefresh(x=>x+1);if(type==='target_change')setTarget(newTarget());if(type==='user_create')setField(newField());}catch(e){setMsg({kind:'error',text:e.message})}finally{setBusy(false)}};
  const createFieldUser = async () => {
  setBusy(true);
  setMsg(null);

  try {
    await api.createManagedUser(field);

    setMsg({
      kind: "success",
      text: `${roleLabel(field.role)} created successfully.`
    });

    setField(newField());

    const [fields, team] = await Promise.all([api.managedUsers(), api.managerTeam()]);
    setFieldUsers(fields.users);
    setTeamData(team);
  } catch (e) {
    setMsg({
      kind: "error",
      text: e.message
    });
  } finally {
    setBusy(false);
  }
};

const openSalesman = async (salesman) => {
  setSelectedSalesman(salesman);
  setSalesmanDetails(null);
  setPhotoUrls({});
  setMsg(null);

  try {
    const data = await api.managerSalesmanActivations(salesman.id);
    setSalesmanDetails(data);

    const urls = {};

    for (const activation of data.activations || []) {
      for (const asset of activation.assets || []) {
        if (asset.hasPhoto) {
          try {
            const url = await api.photoUrl(
              activation.id,
              asset.assetType
            );

            urls[`${activation.id}-${asset.assetType}`] = url;
          } catch (e) {
            console.error(
              "Could not load activation photo:",
              activation.id,
              asset.assetType,
              e
            );
          }
        }
      }
    }

    setPhotoUrls(urls);
  } catch (e) {
    setMsg({ kind: "error", text: e.message });
  }
};

const reviewActivation = async (activationId, status) => {
  setBusy(true);
  setMsg(null);
  try {
    await api.setStatus(activationId, status);
    setSalesmanDetails((current) => current ? {
      ...current,
      activations: current.activations.map((activation) =>
        activation.id === activationId ? { ...activation, status } : activation
      )
    } : current);
    await loadTeam();
    setMsg({ kind: "success", text: `Activation marked ${status.toLowerCase()}.` });
  } catch (e) {
    setMsg({ kind: "error", text: e.message });
  } finally {
    setBusy(false);
  }
};

const deactivateFieldUser = async () => {
  if (!deactivateId) {
    setMsg({
      kind: "error",
      text: "Please select a field user."
    });
    return;
  }

  setBusy(true);
  setMsg(null);

  try {
    await api.deactivateFieldUser(deactivateId);

    setMsg({
      kind: "success",
      text: "Field user deactivated successfully."
    });

    setDeactivateId("");

    const [fields, team] = await Promise.all([api.managedUsers(), api.managerTeam()]);
    setFieldUsers(fields.users);
    setTeamData(team);
  } catch (e) {
    setMsg({
      kind: "error",
      text: e.message
    });
  } finally {
    setBusy(false);
  }
};

const tabs=[['overview','Overview',Store],['performance','Performance',BarChart3],['master',user.role==='regional_head'?'Master data':'Master list',CheckCircle2],['field','Users',Users],...(user.role==='regional_head'?[['target','Targets',Target]]:[]),['requests','Requests',Clock]];
  return <div className="min-h-screen bg-slate-50">
<header className="border-b border-slate-200 bg-white">
<div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
<div className="flex items-center gap-3">
<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white">
<Store size={17}/>
</span>
<div>
<p className="text-sm font-semibold">{APP_NAME}</p>
<p className="text-xs text-slate-500">{roleLabel(user.role)} workspace</p>
</div>
</div>
<div className="flex items-center gap-3">
<span className="text-sm text-slate-600">{user.name}</span>
<Button variant="ghost" size="sm" onClick={()=>setShowPassword(true)}>
<KeyRound size={15}/>Change password</Button>
<Button variant="ghost" size="sm" onClick={onLogout}>
<LogOut size={15}/>Log out</Button>
</div>
</div>
<div className="mx-auto max-w-6xl px-4">
<div className="flex gap-1">{tabs.map(([k,l,I])=>
<button key={k} onClick={()=>setTab(k)} className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${tab===k?'border-teal-600 text-teal-700':'border-transparent text-slate-500'}`}>
<I size={15}/>{l}</button>)}</div>
</div>
</header>
<main className="mx-auto max-w-3xl space-y-4 px-4 py-5">{showPassword?<ChangePassword onClose={()=>setShowPassword(false)}/>:<>{msg?<Banner kind={msg.kind}>{msg.text}</Banner>:null}{tab==='overview'?<div className="space-y-4">
<div className="grid gap-3 md:grid-cols-3">
<Card className="p-4">
<p className="text-sm text-slate-500">My team</p>
<p className="mt-1 text-2xl font-semibold">{teamData.totals.members ?? teamData.totals.salesmen}</p>
<p className="text-xs text-slate-500">{teamData.totals.salesmen} salesmen</p>
</Card>
<Card className="p-4">
<p className="text-sm text-slate-500">Stores activated</p>
<p className="mt-1 text-2xl font-semibold">{teamData.totals.storesActivated}</p>
</Card>
<Card className="p-4">
<p className="text-sm text-slate-500">Total activations</p>
<p className="mt-1 text-2xl font-semibold">{teamData.totals.activations}</p>
</Card>
</div>
<Card className="overflow-hidden">
<div className="border-b border-slate-200 px-4 py-3">
<h2 className="font-semibold">Team hierarchy and performance</h2>
</div>
<div className="overflow-x-auto">
<table className="w-full text-sm">
<thead className="bg-slate-50 text-slate-500">
<tr>
<th className="px-4 py-3 text-left">Person</th>
<th className="px-4 py-3 text-left">Employee ID</th>
<th className="px-4 py-3 text-left">Role</th>
<th className="px-4 py-3 text-left">Reports to</th>
<th className="px-4 py-3 text-left">Territory</th>
<th className="px-4 py-3 text-right">Stores activated</th>
<th className="px-4 py-3 text-right">Activations</th>
</tr>
</thead>
<tbody className="divide-y divide-slate-100">{(teamData.members||teamData.salesmen).map(s=>
<tr key={s.id}>
<td className="px-4 py-3 font-medium">
{s.role==='field'?<button type="button" className="text-teal-700 hover:underline" onClick={()=>openSalesman({...s,employee_id:s.employeeId,state:s.state,city:s.city})}>{s.name}</button>:s.name}
</td>
<td className="px-4 py-3">{s.employeeId||s.employee_id}</td>
<td className="px-4 py-3">{s.roleLabel||'Salesman'}</td>
<td className="px-4 py-3">{s.reportingManager||'—'}</td>
<td className="px-4 py-3">{[s.city,s.state,s.region].filter(Boolean).join(', ')||'—'}</td>
<td className="px-4 py-3 text-right font-medium">{s.shops??s.shops_activated}</td>
<td className="px-4 py-3 text-right">{s.activations}</td>
</tr>)}{!(teamData.members||teamData.salesmen).length?<tr>
<td colSpan="7" className="px-4 py-8 text-center text-slate-400">No City Heads, Team Leads or Salesmen are assigned below you yet.</td>
</tr>:null}</tbody>
</table>
</div>
</Card>{selectedSalesman?<Card className="p-5">
<div className="mb-4 flex items-center justify-between">
<div>
<h2 className="text-lg font-semibold">{selectedSalesman.name}</h2>
<p className="text-sm text-slate-500">{selectedSalesman.employee_id} · {[selectedSalesman.city,selectedSalesman.state].filter(Boolean).join(', ')}</p>
</div>
<Button variant="ghost" size="sm" onClick={()=>{setSelectedSalesman(null);setSalesmanDetails(null)}}>Close</Button>
</div>{salesmanDetails?salesmanDetails.activations.length?<div className="space-y-3">{salesmanDetails.activations.map(a=>
<div key={a.id} className="rounded-lg border border-slate-200 p-4">
<div className="flex items-start justify-between gap-4">
<div>
<p className="font-semibold">{a.pharmacy_name}</p>
<p className="text-sm text-slate-500">{[a.area,a.city,a.state].filter(Boolean).join(', ')}</p>
</div>
<p className="text-xs text-slate-500">{new Date(a.occurred_at).toLocaleString()}</p>
</div>
<p className="mt-2 text-sm">
<span className="font-medium">Address:</span> {a.address||'—'}</p>
<p className="mt-1 text-sm"><span className="font-medium">Party Code (Alter Code):</span> {a.party_code||'—'}</p>
{a.party_code_duplicate ? <div className="mt-2"><Banner kind="warn">Flagged: another salesman previously submitted this Party Code (Alter Code).</Banner></div> : null}
<p className="mt-1 text-sm">
<span className="font-medium">GPS:</span> {a.latitude&&a.longitude?`${a.latitude}, ${a.longitude}`:'—'}</p>
<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 py-3">
<div className="flex flex-wrap gap-2">
<span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(a.status)}`}>{a.status}</span>
{a.master_data_status !== 'verified'?<span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Master data: {a.master_data_status}</span>:null}
</div>
<div className="flex flex-wrap gap-2">
<Button variant="success" size="sm" disabled={busy} onClick={()=>reviewActivation(a.id,"Approved")}>
<CheckCircle2 size={15}/> Approve
</Button>
<Button variant="ghost" size="sm" disabled={busy} onClick={()=>reviewActivation(a.id,"Pending Review")}>
<Clock size={15}/> Mark pending
</Button>
<Button variant="danger" size="sm" disabled={busy} onClick={()=>reviewActivation(a.id,"Rejected")}>
<XCircle size={15}/> Reject
</Button>
</div>
</div>
<div className="mt-3">
<p className="text-sm font-medium">Assets:</p>{a.assets?.length?<div className="mt-2 grid gap-3 sm:grid-cols-2">{a.assets.map(x=>{const photoKey=`${a.id}-${x.assetType}`;const photoUrl=photoUrls[photoKey];return <div key={x.assetType} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
<p className="text-sm font-medium">{x.assetType} ({x.quantity})</p>{photoUrl?<a href={photoUrl} target="_blank" rel="noreferrer" className="mt-2 block">
<img src={photoUrl} alt={`${x.assetType} proof`} className="h-40 w-full rounded-lg border border-slate-200 object-cover"/>
<p className="mt-1 text-xs text-teal-700">Click photo to view full size</p>
</a>:x.hasPhoto?<p className="mt-2 text-xs text-slate-500">Loading photo...</p>:<p className="mt-2 text-xs text-slate-400">No proof photo</p>}</div>})}</div>:<p className="mt-1 text-sm text-slate-500">None</p>}</div>
</div>)}</div>:<div className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No activations yet for this salesperson.</div>:<div className="py-8 text-center text-sm text-slate-500">Loading activation details...</div>}</Card>:null}</div>:null}{tab==='performance'?<ManagerPerformance user={user} geo={geo}/>:null}{tab==='master'?(user.role==='regional_head'?<MasterDataReviews canManage/>:<ReadOnlyMasterList/>):null}{tab==='requests'?<RequestHistory refresh={refresh}/>:null}{tab==='target'&&user.role==='regional_head'?<Card className="p-5">
<h2 className="mb-1 text-lg font-semibold">Suggest a target change</h2>
<p className="mb-4 text-sm text-slate-500">Your suggestion remains pending until an Admin approves it. Approved changes are added to history and never silently overwrite old data.</p>
<div className="grid gap-3 md:grid-cols-3">
<Field label="State">
{user.state ? <Select value={target.state} onChange={()=>{}} options={[user.state]} placeholder="Assigned state" disabled/> :
<TextInput value={target.state} onChange={e=>setTarget({...target,state:e.target.value,city:"",area:""})} placeholder="Enter state"/>}
</Field>
<Field label="City">
{user.city ? <Select value={target.city} onChange={()=>{}} options={[user.city]} placeholder="Assigned city" disabled/> :
<ComboInput value={target.city} onChange={v=>setTarget({...target,city:v,area:''})} options={geo.cities(target.state)} placeholder="Type or select city" />}
</Field>
<Field label="Area">
<TextInput value={target.area} onChange={e=>setTarget({...target,area:e.target.value})} placeholder="Existing or new area"/>
</Field>
</div>
<div className="grid gap-3 md:grid-cols-2">
<Field label="Change type">
<select className={inputCls} value={target.changeType} onChange={e=>setTarget({...target,changeType:e.target.value})}>
<option value="addition">Addition (+ to current target)</option>
<option value="revision">Revision (new target for this area)</option>
<option value="base">New base target</option>
</select>
</Field>
<Field label="Planned shops">
<TextInput type="number" value={target.plannedShops} onChange={e=>setTarget({...target,plannedShops:e.target.value})}/>
</Field>
</div>
<div className="mt-3 grid gap-3 md:grid-cols-3">{ASSETS.map(a=>
<Field key={a.key} label={a.label}>
<TextInput type="number" value={target.assets[a.key]} onChange={e=>setTarget({...target,assets:{...target.assets,[a.key]:e.target.value}})}/>
</Field>)}</div>
<Field label="Reason" required>
<textarea className={inputCls} rows="3" id="target-reason" placeholder="Why is this change needed?"/>
</Field>
<Button disabled={busy} onClick={()=>{const reason=document.getElementById('target-reason').value.trim();submit('target_change',target,reason)}}>{busy?<Loader2 className="animate-spin" size={15}/>:<Send size={15}/>} Submit for approval</Button>
</Card>:null}{tab==='field'?<Card className="p-5">
<h2 className="mb-1 text-lg font-semibold">Add team member</h2>
<p className="mb-4 text-sm text-slate-500">Create an account below you and select its reporting manager.</p>
<BulkUsers inline role={user.role} onImported={async () => {
  const [fields, team] = await Promise.all([api.managedUsers(), api.managerTeam()]);
  setFieldUsers(fields.users);
  setTeamData(team);
  setRefresh(value => value + 1);
}} />
<div className="grid gap-3 md:grid-cols-2">
<Field label="Role" required>
<select className={inputCls} value={field.role} onChange={e=>setField({...field,role:e.target.value,managerId:user.id})}>
{(childRoles[user.role]||[]).map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}
</select>
</Field>
<Field label="Reporting manager" required>
<select className={inputCls} value={field.managerId} onChange={e=>setField({...field,managerId:e.target.value})}>
<option value="">Select reporting manager</option>
{fieldUsers.filter(u=>u.active&&(parentRoles[field.role]||[]).includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.name} · {roleLabel(u.role)}</option>)}
</select>
</Field>
<Field label="Name" required>
<TextInput value={field.name} onChange={e=>setField({...field,name:e.target.value})}/>
</Field>
<Field label="Employee ID" required>
<TextInput value={field.employeeId} onChange={e=>setField({...field,employeeId:e.target.value})}/>
</Field>
<Field label="Mobile">
<TextInput value={field.mobile} onChange={e=>setField({...field,mobile:e.target.value})}/>
</Field>
<Field label="Email">
<TextInput value={field.email} onChange={e=>setField({...field,email:e.target.value})}/>
</Field>
<Field label="Initial password">
<TextInput type="password" value={field.password} onChange={e=>setField({...field,password:e.target.value})}/>
</Field>
<Field label="State" required><TextInput value={field.state} onChange={e=>setField({...field,state:e.target.value})} placeholder="Enter state"/></Field>
<Field label="City" required><TextInput value={field.city} onChange={e=>setField({...field,city:e.target.value})} placeholder="Enter city"/></Field>
</div>
<Button disabled={busy} onClick={createFieldUser}>{busy?<Loader2 className="animate-spin" size={15}/>:<Plus size={15}/>} Add team member</Button>
<div className="mt-8 border-t border-slate-200 pt-5">
<div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-semibold">My reporting hierarchy</h3><p className="text-sm text-slate-500">Everyone assigned below you, including indirect reports.</p></div><Button variant="ghost" size="sm" onClick={()=>loadFieldUsers().catch(e=>setMsg({kind:'error',text:e.message}))}>Refresh</Button></div>
<div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm">
<thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Reports to</th><th className="px-3 py-2">Territory</th><th className="px-3 py-2">Status</th></tr></thead>
<tbody className="divide-y divide-slate-100">{fieldUsers.filter(u=>u.id!==user.id).map(u=><tr key={u.id}>
<td className="px-3 py-2"><span className="font-medium">{u.name}</span><span className="block text-xs text-slate-500">{u.employee_id}</span></td>
<td className="px-3 py-2">{roleLabel(u.role)}</td><td className="px-3 py-2">{u.reporting_manager_name||'—'}</td>
<td className="px-3 py-2">{[u.assigned_city,u.assigned_state,u.region].filter(Boolean).join(', ')||'—'}</td><td className="px-3 py-2">{u.active?'Active':'Inactive'}</td>
</tr>)}{!fieldUsers.some(u=>u.id!==user.id)?<tr><td colSpan="5" className="px-3 py-8 text-center text-slate-400">No users are currently assigned below you.</td></tr>:null}</tbody>
</table></div>
</div>
<div className="mt-8 border-t border-slate-200 pt-5">
<h3 className="font-semibold">Deactivate field user</h3>
<p className="mb-3 text-sm text-slate-500">Deactivate a salesperson from your team. Their past activation history will be preserved.</p>
<select className={inputCls} value={deactivateId} onChange={e=>setDeactivateId(e.target.value)}>
<option value="">Select field user</option>{fieldUsers.filter(u=>u.active&&u.role==='field').map(u=>
<option key={u.id} value={u.id}>{u.name} ({u.employee_id})</option>)}</select>
<div className="mt-3">
<Button variant="danger" disabled={busy||!deactivateId} onClick={deactivateFieldUser}>{busy?<Loader2 className="animate-spin" size={15}/>:null} Deactivate field user</Button>
</div>
</div>
</Card>:null}</>}</main>
</div>
}
