import React, { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { api } from "./api";
import { Banner, Button, Card } from "./ui";

const roleGuidance = {
  admin: "Add Regional Heads, City Heads, Team Leads and Salesmen. Select each reporting manager by name in the template; new Regional Heads report to you.",
  regional_head: "Add City Heads, Team Leads and Salesmen. You are the default reporting manager; choose an eligible manager from your hierarchy when needed.",
  city_head: "Add Team Leads and Salesmen. You are the default reporting manager; Salesmen can also report to a Team Lead under you.",
  team_lead: "Add Salesmen directly to your team. Their role, reporting manager, Region, State and City are filled automatically from your account.",
};

export default function BulkUsers({ role, onImported, inline = false }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState([]);
  const [imported, setImported] = useState(null);
  const [refreshWarning, setRefreshWarning] = useState("");

  if (!roleGuidance[role]) return null;

  const resetFeedback = () => {
    setError("");
    setRowErrors([]);
    setImported(null);
    setRefreshWarning("");
  };

  const download = async () => {
    setBusy("download");
    resetFeedback();
    try {
      await api.download("/bulk-users/template", "user-upload-template.xlsx");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetFeedback();
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Choose an Excel (.xlsx) file using the downloaded user template.");
      return;
    }
    setBusy("upload");
    try {
      const result = await api.importUsers(file);
      setImported(result.imported);
      try {
        await onImported?.();
      } catch {
        setRefreshWarning("The accounts were created, but the list could not refresh. Refresh the page to see them; do not upload the file again.");
      }
    } catch (e) {
      setError(e.message);
      setRowErrors(Array.isArray(e.body?.errors) ? e.body.errors.slice(0, 100) : []);
    } finally {
      setBusy("");
    }
  };

  const Wrapper = inline ? "section" : Card;
  return <Wrapper className={inline ? "my-5 border-y border-slate-200 py-4" : "p-4"}>
    <h3 className="text-sm font-semibold text-slate-900">Bulk add employees</h3>
    <p className="mt-1 text-sm text-slate-600">{roleGuidance[role]}</p>
    <p className="mt-2 text-xs text-slate-500">
      Download a fresh Excel template for the latest Role and Reporting Manager dropdowns. Territory is inherited wherever the selected manager has an assignment. Area is optional.
    </p>
    <p className="mt-1 text-xs text-slate-500">
      Initial Password defaults to 12345678 and can be changed in each row. Upload creates all valid accounts together; if any row is invalid, no accounts are created.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={download}>
        {busy === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {busy === "download" ? "Preparing template…" : "Download employee template"}
      </Button>
      <Button size="sm" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
        {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {busy === "upload" ? "Validating and importing…" : "Upload employees"}
      </Button>
      <input ref={fileInput} type="file" className="hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={upload} aria-label="Upload user Excel template" disabled={Boolean(busy)} />
    </div>
    <div className="mt-3 space-y-2" aria-live="polite">
      {imported !== null ? <Banner kind="success">{imported} {imported === 1 ? "account created" : "accounts created"}. New users can sign in with their Employee ID and initial password.</Banner> : null}
      {refreshWarning ? <Banner kind="info">{refreshWarning}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {rowErrors.length ? <div className="overflow-x-auto rounded-lg border border-rose-200">
        <p className="px-3 py-2 text-xs text-rose-700">Correct these rows in Excel, then upload the file again. Showing up to 100 errors.</p>
        <table className="w-full text-sm">
          <thead className="bg-rose-50 text-left text-xs text-slate-600"><tr><th className="px-3 py-2">Excel row</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Correction needed</th></tr></thead>
          <tbody className="divide-y divide-rose-100">{rowErrors.map((item, index) => <tr key={`${item.row}-${item.field}-${index}`}>
            <td className="px-3 py-2 align-top">{item.row || "—"}</td>
            <td className="px-3 py-2 align-top">{item.field || "—"}</td>
            <td className="px-3 py-2 text-slate-700">{item.message}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
    </div>
  </Wrapper>;
}
