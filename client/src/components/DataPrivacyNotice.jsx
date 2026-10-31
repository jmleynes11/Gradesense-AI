import { ShieldCheck } from "lucide-react";

export default function DataPrivacyNotice({ role, onClose }) {
  if (!["teacher", "student"].includes(role)) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded border border-slate-200 bg-white p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="rounded bg-slate-100 p-2">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Data Privacy Notice</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              GradeSense AI collects and processes account details, class records, assessment answers, grades, uploaded files, and feedback only for academic grading, progress tracking, report generation, and system security. Authorized school personnel may access records based on role permissions. Do not upload sensitive personal information that is not required for class assessment.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              By continuing, you acknowledge that your activity may be recorded in audit logs and that your data will be handled according to school data privacy policies.
            </p>
          </div>
        </div>
        <button className="mt-4 w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={onClose} type="button">
          I Understand
        </button>
      </div>
    </div>
  );
}
