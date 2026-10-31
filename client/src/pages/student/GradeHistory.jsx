import { useEffect, useState } from "react";
import LoadingState from "../../components/LoadingState";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { displayScore, displayPercentage } from "../../services/gradeDisplay";
import AssessmentResults from "./AssessmentResults";

export default function GradeHistory({ initialSubmissionId = "", initialAssessmentId = "" }) {
  const { data, loading, error } = useAsyncData(api.studentHistory, []);
  const [submissionId, setSubmissionId] = useState(initialSubmissionId);
  useEffect(() => {
    if (!initialSubmissionId && initialAssessmentId) {
      const match = data?.submissions?.find((item) => String(item.assessment?._id || item.assessment) === initialAssessmentId);
      if (match) setSubmissionId(match._id);
    }
  }, [data, initialAssessmentId, initialSubmissionId]);
  if (submissionId) return <AssessmentResults key={submissionId} submissionId={submissionId} onBack={() => setSubmissionId("")} />;
  if (loading || error) return <LoadingState label="Loading records" error={error} />;
  return (
    <Panel title="Grade History">
      <SimpleTable columns={[
        { key: "assessment", label: "Assessment", render: (row) => row.assessment?.title },
        { key: "score", label: "Score", render: (row) => displayScore(row) },
        { key: "percentage", label: "Percentage", render: (row) => displayPercentage(row) },
        { key: "status", label: "Status" },
        { key: "results", label: "Results", render: (row) => <button className="btn-neutral px-3 py-2 text-sm" onClick={() => setSubmissionId(row._id)} type="button">View Results</button> }
      ]} rows={data?.submissions || []} />
    </Panel>
  );
}
