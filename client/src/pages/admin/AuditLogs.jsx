import LoadingState from "../../components/LoadingState";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";

export default function AuditLogs() {
  const { data, loading, error } = useAsyncData(api.auditLogs, []);
  if (loading || error) return <LoadingState label="Loading records" error={error} />;
  return (
    <Panel title="Audit Logs">
      <SimpleTable columns={[
        { key: "createdAt", label: "Date", render: (row) => new Date(row.createdAt).toLocaleString() },
        { key: "actor", label: "Actor", render: (row) => row.actor?.email || "System" },
        { key: "action", label: "Action" },
        { key: "module", label: "Module" },
        { key: "details", label: "Details" }
      ]} rows={data || []} />
    </Panel>
  );
}
