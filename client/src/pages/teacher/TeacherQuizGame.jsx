import { useEffect, useState } from "react";
import { Archive, ArrowLeft, BarChart3, Edit3, Eye, Gamepad2, Medal, Plus, Save, Send, Trash2, Trophy, Users, XCircle } from "lucide-react";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import BrandLogo from "../../components/BrandLogo";

const labels = ["A", "B", "C", "D"];

const blankGame = {
  title: "",
  subject: "",
  instructions: "Answer each multiple-choice question as quickly and accurately as you can.",
  timePerQuestion: 15,
  randomizeQuestions: true,
  randomizeChoices: true,
  enablePoints: true,
  enableStreak: true,
  showCorrectAnswer: true,
  showLeaderboard: true,
  allowReplay: false,
  status: "draft",
};

const blankQuestion = {
  questionText: "",
  choices: ["", "", "", ""],
  correctAnswer: "",
};

function secondsLabel(value) {
  return Number(value) === 0 ? "No Timer" : `${value} Seconds`;
}

function choicesForDisplay(question) {
  const choices = question?.choices || [];
  return labels.map((label, index) => {
    const match = choices.find((choice) => choice.label === label) || choices[index] || "";
    return typeof match === "string" ? match : match.value || "";
  });
}

function validateQuestion(question) {
  const values = question.choices.map((choice) => String(choice || "").trim());
  if (!question.questionText.trim()) return "Please enter a question.";
  if (values.some((choice) => !choice)) return "All four choices are required.";
  if (new Set(values.map((choice) => choice.toLowerCase())).size !== 4) return "Duplicate choices are not allowed.";
  if (!labels.includes(question.correctAnswer)) return "Please select the correct answer.";
  return "";
}

function payload(question) {
  return {
    questionText: question.questionText.trim(),
    choices: question.choices.map((choice) => choice.trim()),
    correctAnswer: question.correctAnswer,
  };
}

function ArenaLoading({ label = "Loading Quiz Arena..." }) {
  const messages = [
    "Loading Quiz Arena...",
    "Preparing the arena...",
    "Loading your quiz games...",
    "Setting up your challenges...",
    "Almost ready...",
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % messages.length), 900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,107,0,0.18),transparent_28%),radial-gradient(circle_at_70%_80%,rgba(255,107,0,0.12),transparent_30%)]" />
      {Array.from({ length: 18 }).map((_, dot) => (
        <span
          className="absolute h-1 w-1 rounded-full bg-[#FF6B00] opacity-60"
          key={dot}
          style={{
            left: `${(dot * 37) % 100}%`,
            top: `${(dot * 23) % 100}%`,
            boxShadow: "0 0 18px rgba(255,107,0,0.9)",
            animation: `teacherArenaFloat ${2.8 + (dot % 5) * 0.45}s ease-in-out infinite`,
          }}
        />
      ))}
      <div className="relative w-[min(92vw,520px)] text-center">
        <BrandLogo variant="icon" className="mx-auto mb-6 h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-[0_0_40px_rgba(255,107,0,0.4)]" />
        <h1 className="mt-2 text-4xl font-black tracking-wide md:text-6xl">QUIZ ARENA</h1>
        <div className="mx-auto mt-8 grid h-32 w-32 place-items-center rounded-full border border-[#FF6B00]/40 bg-[#111]/80 shadow-[0_0_50px_rgba(255,107,0,0.25)]">
          <div className="grid h-24 w-24 animate-spin place-items-center rounded-full border-4 border-[#FF6B00] border-t-transparent">
            <Gamepad2 className="animate-pulse text-[#FFB36B]" size={34} />
          </div>
        </div>
        <p className="mt-8 text-lg font-bold text-slate-100">{label || messages[index]}</p>
        <p className="mt-2 text-sm text-slate-400">{messages[index]}</p>
        <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-3/4 rounded-full bg-[#FF6B00] shadow-[0_0_22px_rgba(255,107,0,0.8)]" style={{ animation: "teacherArenaLoad 1.1s ease-in-out infinite alternate" }} />
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-[#FFB36B]">READY! ENTERING QUIZ ARENA...</p>
      </div>
      <style>{`
        @keyframes teacherArenaFloat {
          0%, 100% { transform: translateY(0) scale(1); opacity: .35; }
          50% { transform: translateY(-18px) scale(1.4); opacity: .9; }
        }
        @keyframes teacherArenaLoad {
          from { transform: translateX(-28%); width: 42%; }
          to { transform: translateX(82%); width: 72%; }
        }
      `}</style>
    </div>
  );
}

function ArenaStat({ label, value, icon: Icon, hot = false }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-xl ${hot ? "border-[#FF6B00]/35 bg-[#FF6B00]/12" : "border-white/10 bg-white/[0.05]"}`}>
      <Icon className={hot ? "text-[#FFB36B]" : "text-slate-300"} size={26} />
      <p className="mt-5 text-4xl font-black text-white">{value ?? 0}</p>
      <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
    </div>
  );
}

export default function TeacherQuizGame({ onExit }) {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [dashboard, setDashboard] = useState({ summary: {}, games: [] });
  const [form, setForm] = useState(blankGame);
  const [selected, setSelected] = useState(null);
  const [draftQuestions, setDraftQuestions] = useState([{ ...blankQuestion }]);
  const [editing, setEditing] = useState({});
  const [results, setResults] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardGame, setLeaderboardGame] = useState(null);
  const [attemptDetail, setAttemptDetail] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState("Loading Quiz Arena...");
  const [view, setView] = useState("lobby");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingGameId, setDeletingGameId] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function withLoading(label, task) {
    setLoadingLabel(label);
    setLoading(true);
    try {
      return await task();
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard() {
    await withLoading("Loading your quiz games...", async () => {
      setDashboard(await api.quizGameTeacherDashboard());
    });
  }

  async function loadGame(id) {
    setLeaderboardGame(null);
    const item = await withLoading("Loading game data...", async () => {
      const game = await api.quizGame(id);
      if (game.status === "completed") {
        try {
          const data = await api.quizGameTeacherLeaderboard(id);
          setLeaderboardGame(data.game);
          setLeaderboard(data.leaderboard || []);
        } catch {
          setLeaderboard([]);
        }
      }
      return game;
    });
    setSelected(item);
    setDraftQuestions([{ ...blankQuestion }]);
    setEditing({});
    setResults(null);
    setAttemptDetail(null);
    setMessage("");
    setView("manage");
  }

  async function createGame(event) {
    event.preventDefault();
    const created = await withLoading("Setting up your challenge...", () => api.createQuizGame(form));
    setForm(blankGame);
    setSelected(created);
    await loadDashboard();
    setView("manage");
  }

  async function saveGame(patch) {
    const updated = await api.updateQuizGame(selected._id, patch);
    setSelected(updated);
    await loadDashboard();
  }

  async function publishGame(id) {
    try {
      await withLoading("Publishing challenge...", () => api.publishQuizGame(id));
      await loadDashboard();
      if (selected?._id === id) await loadGame(id);
      setMessage("Quiz game published.");
    } catch (error) {
      setMessage(error.message);
      setLoading(false);
    }
  }

  async function closeGame(id) {
    await withLoading("Closing challenge...", () => api.closeQuizGame(id));
    await loadDashboard();
    if (selected?._id === id) await loadGame(id);
  }

  async function archiveGame(id) {
    await withLoading("Archiving challenge...", () => api.archiveQuizGame(id));
    await loadDashboard();
    if (selected?._id === id) await loadGame(id);
  }

  async function deleteGame() {
    if (!deleteTarget || deletingGameId) return;
    const id = deleteTarget._id;
    setDeletingGameId(id);
    setMessage("");
    try {
      await api.deleteQuizGame(id);
      setDashboard((current) => ({
        ...current,
        games: (current.games || []).filter((game) => game._id !== id),
        summary: {
          ...(current.summary || {}),
          quizGamesCreated: Math.max(0, Number(current.summary?.quizGamesCreated || 0) - 1),
        },
      }));
      if (selected?._id === id) {
        setSelected(null);
        setView("lobby");
      }
      setDeleteTarget(null);
      setMessage("Quiz game deleted.");
    } catch (error) {
      setMessage(error.message || "Quiz game deletion failed.");
    } finally {
      setDeletingGameId("");
    }
  }

  async function addQuestion(event, draftIndex) {
    event.preventDefault();
    const question = draftQuestions[draftIndex];
    const error = validateQuestion(question);
    if (error) {
      setMessage(error);
      return;
    }
    const created = await api.addQuizGameQuestion(selected._id, payload(question));
    setSelected({ ...selected, questions: [...(selected.questions || []), created] });
    setDraftQuestions((current) => current.filter((_, index) => index !== draftIndex).concat({ ...blankQuestion }));
    setMessage("Question added.");
  }

  async function saveQuestion(questionId) {
    const draft = editing[questionId];
    const error = validateQuestion(draft);
    if (error) {
      setMessage(error);
      return;
    }
    const updated = await api.updateQuizGameQuestion(selected._id, questionId, payload(draft));
    setSelected({
      ...selected,
      questions: selected.questions.map((item) => item._id === questionId ? updated : item),
    });
    setEditing((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setMessage("Question saved.");
  }

  async function removeQuestion(questionId) {
    if (!window.confirm("Delete this question?")) return;
    setSelected(await api.removeQuizGameQuestion(selected._id, questionId));
  }

  async function moveQuestion(index, direction) {
    const next = [...(selected.questions || [])];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelected({ ...selected, questions: next });
    await api.reorderQuizGameQuestions(selected._id, next.map((item) => item._id));
  }

  async function openResults(gameId) {
    setMessage("");
    setAttemptDetail(null);
    try {
      await withLoading("Loading results...", async () => {
        const data = await api.quizGameResults(gameId);
        setResults(data);
        setLeaderboard((data.results || []).filter((row) => row.status === "completed"));
        setView("results");
      });
    } catch (error) {
      setMessage(error.message || "Unable to load quiz game results.");
    }
  }

  async function openLeaderboard(gameId) {
    setMessage("");
    setAttemptDetail(null);
    try {
      await withLoading("Loading leaderboard...", async () => {
        const data = await api.quizGameTeacherLeaderboard(gameId);
        setLeaderboardGame(data.game);
        setLeaderboard(data.leaderboard || []);
        setView("leaderboard");
      });
    } catch (error) {
      setMessage(error.message || "Unable to load quiz game leaderboard.");
    }
  }

  async function openAttempt(attemptId) {
    setMessage("");
    setAttemptDetail(null);
    try {
      setAttemptDetail(await api.quizGameAttemptDetail(attemptId));
    } catch (error) {
      setMessage(error.message || "Unable to load student answers.");
    }
  }

  function setChoice(nextQuestion, index, value) {
    const nextChoices = [...nextQuestion.choices];
    nextChoices[index] = value;
    return { ...nextQuestion, choices: nextChoices };
  }

  function updateDraftQuestion(index, nextQuestion) {
    setDraftQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? nextQuestion : item));
  }

  function addDraftQuestion() {
    setDraftQuestions((current) => [...current, { ...blankQuestion }]);
  }

  function deleteDraftQuestion(index) {
    if (draftQuestions.length === 1) {
      setDraftQuestions([{ ...blankQuestion }]);
      return;
    }
    setDraftQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function fieldClass() {
    return "w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-slate-500 focus:border-[#FF6B00] focus:shadow-[0_0_0_3px_rgba(255,107,0,0.16)]";
  }

  function renderLeaderboard() {
    return (
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#101010] p-4">
        <table className="w-full min-w-[500px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-400"><tr>{["Rank", "Student", "Score", "Accuracy", "Time"].map((head) => <th className="border-b border-white/10 p-3" key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {leaderboard.map((row) => (
              <tr key={row._id}>
                <td className="border-b border-white/10 p-3">#{row.rank}</td>
                <td className="border-b border-white/10 p-3 font-black">{row.student?.name || row.student?.email || "Deleted student"}</td>
                <td className="border-b border-white/10 p-3 font-black text-[#FFB36B]">{row.score} XP</td>
                <td className="border-b border-white/10 p-3">{row.accuracy}%</td>
                <td className="border-b border-white/10 p-3">{row.completionTime}s</td>
              </tr>
            ))}
            {!leaderboard.length && <tr><td className="p-3 text-slate-400" colSpan={5}>No completed attempts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  function questionForm(state, setState, submitLabel, onSubmit) {
    return (
      <form className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" onSubmit={onSubmit}>
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-black text-slate-300">Question Text<textarea className={fieldClass()} rows="2" value={state.questionText} onChange={(e) => setState({ ...state, questionText: e.target.value })} /></label>
          <div className="grid gap-3 md:grid-cols-2">
            {labels.map((label, index) => (
              <label className="grid gap-2 text-sm font-black text-slate-300" key={label}>Choice {label}<input className={fieldClass()} value={state.choices[index]} onChange={(e) => setState(setChoice(state, index, e.target.value))} placeholder={`Choice ${label}`} /></label>
            ))}
          </div>
          <label className="grid gap-2 text-sm font-black text-slate-300">Correct Answer
            <select className={fieldClass()} value={state.correctAnswer} onChange={(e) => setState({ ...state, correctAnswer: e.target.value })}>
              <option className="bg-[#111]" value="">Select Correct Answer</option>
              {labels.map((label) => <option className="bg-[#111]" key={label} value={label}>{label}</option>)}
            </select>
          </label>
          <button className="flex w-fit items-center gap-2 rounded-xl bg-[#FF6B00] px-4 py-2.5 text-sm font-black text-white hover:bg-[#D94F00]" type="submit"><Plus size={16} />{submitLabel}</button>
        </div>
      </form>
    );
  }

  const summary = dashboard.summary || {};
  const games = dashboard.games || [];

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#060606] text-white">
      {loading && <ArenaLoading label={loadingLabel} />}
      <div className="min-h-screen bg-[radial-gradient(circle_at_20%_10%,rgba(255,107,0,0.17),transparent_28%),linear-gradient(180deg,#090909,#151515_48%,#090909)]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandLogo variant="icon" className="h-11 w-11 rounded-xl bg-white object-contain p-1 shadow-[0_0_26px_rgba(255,107,0,0.45)]" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">GradeSense</p>
                <h1 className="text-xl font-black tracking-wide">TEACHER QUIZ ARENA</h1>
              </div>
            </div>
            <nav className="flex flex-wrap gap-2">
              <button className={`rounded-lg px-3 py-2 text-sm font-bold ${view === "lobby" ? "bg-[#FF6B00] text-white" : "bg-white/10 text-slate-200"}`} onClick={() => { setSelected(null); setView("lobby"); }} type="button">Game Lobby</button>
              <button className={`rounded-lg px-3 py-2 text-sm font-bold ${view === "create" ? "bg-[#FF6B00] text-white" : "bg-white/10 text-slate-200"}`} onClick={() => { setSelected(null); setView("create"); }} type="button">+ Create Quiz Game</button>
              <button className="rounded-lg border border-white/15 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-white/10" onClick={onExit || (() => setView("lobby"))} type="button"><ArrowLeft className="mr-2 inline" size={16} />Back to GradeSense</button>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          {message && <div className="mb-4 rounded-xl border border-[#FF6B00]/35 bg-[#FF6B00]/10 p-3 text-sm font-black text-[#FFB36B]">{message}</div>}
          {deleteTarget && (
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-[#1a0d0d] p-4 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-white">Are you sure you want to delete this Quiz Game?</h3>
                  <p className="mt-1 text-sm text-slate-300">{deleteTarget.title}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-slate-100 hover:bg-white/10" disabled={!!deletingGameId} onClick={() => setDeleteTarget(null)} type="button">Cancel</button>
                  <button className="rounded-xl border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-black text-red-100 hover:bg-red-500/30" disabled={deletingGameId === deleteTarget._id} onClick={deleteGame} type="button">
                    {deletingGameId === deleteTarget._id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === "lobby" && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
                <p className="text-xs font-black uppercase tracking-[0.26em] text-[#FFB36B]">Teacher Arena Control</p>
                <h2 className="mt-2 text-4xl font-black md:text-6xl">QUIZ ARENA</h2>
                <p className="mt-3 max-w-2xl text-slate-300">Create, publish, monitor, and rank gamified multiple-choice challenges.</p>
              </section>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ArenaStat label="Quiz Games Created" value={summary.quizGamesCreated || games.length} icon={Gamepad2} hot />
                <ArenaStat label="Total Players" value={summary.totalParticipants} icon={Users} />
                <ArenaStat label="Average Score" value={summary.averageScore} icon={BarChart3} />
                <ArenaStat label="Top Score" value={summary.highestScore} icon={Trophy} hot />
              </section>

              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">CREATED QUIZ GAMES</h2>
                  <button className="rounded-xl bg-[#FF6B00] px-4 py-3 text-sm font-black text-white hover:bg-[#D94F00]" onClick={() => setView("create")} type="button"><Plus className="mr-2 inline" size={18} />CREATE QUIZ GAME</button>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {games.map((game) => (
                    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-xl transition hover:-translate-y-1 hover:border-[#FF6B00]/60 hover:shadow-[0_0_38px_rgba(255,107,0,0.16)]" key={game._id}>
                      <div className="h-28 bg-[radial-gradient(circle_at_30%_20%,rgba(255,107,0,0.45),transparent_26%),linear-gradient(135deg,#1f1f1f,#090909)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-black/40 text-[#FFB36B]"><Gamepad2 size={30} /></div>
                          <button
                            className="grid h-10 w-10 place-items-center rounded-xl border border-red-400/30 bg-black/50 text-red-200 hover:bg-red-500/20"
                            onClick={() => setDeleteTarget(game)}
                            title="Delete quiz game"
                            type="button"
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                      <div className="p-5">
                        {game.status === "completed" && <button className="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-100 hover:bg-white/10" onClick={() => openLeaderboard(game._id)} type="button">LEADERBOARD</button>}
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FFB36B]">{game.class?.className || "No class"}</p>
                            <h3 className="mt-2 text-xl font-black">{game.title}</h3>
                          </div>
                          <span className="rounded-full border border-[#FF6B00]/30 bg-[#FF6B00]/10 px-2.5 py-1 text-xs font-black uppercase text-[#FFB36B]">{game.status}</span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div><dt className="text-slate-400">Players</dt><dd className="font-black">{game.participants}</dd></div>
                          <div><dt className="text-slate-400">Questions</dt><dd className="font-black">{game.numberOfQuestions}</dd></div>
                          <div><dt className="text-slate-400">Completed</dt><dd className="font-black text-green-300">{game.completedPlayers || 0}</dd></div>
                          <div><dt className="text-slate-400">Top Score</dt><dd className="font-black text-[#FFB36B]">{game.highestScore}</dd></div>
                        </dl>
                        <div className="mt-5 grid gap-2">
                          <button className="rounded-xl bg-[#FF6B00] px-4 py-2.5 text-sm font-black text-white hover:bg-[#D94F00]" onClick={() => loadGame(game._id)} type="button">VIEW GAME</button>
                          <div className="grid grid-cols-2 gap-2">
                            <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-100 hover:bg-white/10" onClick={() => openResults(game._id)} type="button">VIEW RESULTS</button>
                            {game.status !== "completed" && <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-100 hover:bg-white/10" onClick={() => openLeaderboard(game._id)} type="button">LEADERBOARD</button>}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!games.length && <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-slate-300">No quiz games created yet.</div>}
                </div>
              </section>
            </div>
          )}

          {view === "create" && (
            <section className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">Create Challenge</p>
              <h2 className="mt-2 text-3xl font-black">CREATE QUIZ GAME</h2>
              <form className="mt-5 grid gap-3 md:grid-cols-3" onSubmit={createGame}>
                <input className={fieldClass()} placeholder="Quiz Game Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                <select className={fieldClass()} value={form.subjectRef || ""} onChange={(e) => {
                  const item = (subjects.data || []).find((entry) => entry._id === e.target.value);
                  setForm({ ...form, subjectRef: e.target.value, subject: item?.name || "" });
                }} required>
                  <option className="bg-[#111]" value="">Subject</option>
                  {(subjects.data || []).map((item) => <option className="bg-[#111]" key={item._id} value={item._id}>{item.name}</option>)}
                </select>
                <input className={fieldClass()} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
                <select className={fieldClass()} value={form.timePerQuestion} onChange={(e) => setForm({ ...form, timePerQuestion: Number(e.target.value) })}>
                  {[0, 10, 15, 20, 30, 60].map((value) => <option className="bg-[#111]" key={value} value={value}>{secondsLabel(value)}</option>)}
                </select>
                {[
                  ["randomizeQuestions", "Randomize Question Order"],
                  ["randomizeChoices", "Randomize Answer Choices"],
                  ["enablePoints", "Enable Points System"],
                  ["enableStreak", "Enable Combo Bonus"],
                  ["showCorrectAnswer", "Show Correct Answer After Each Question"],
                  ["showLeaderboard", "Show Leaderboard After Completion"],
                ].map(([key, label]) => (
                  <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-black text-slate-200" key={key}>
                    <input checked={!!form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} type="checkbox" />
                    {label}
                  </label>
                ))}
                <button className="flex items-center justify-center gap-2 rounded-xl bg-[#FF6B00] px-4 py-3 text-sm font-black text-white hover:bg-[#D94F00] md:col-span-3" type="submit"><Save size={16} />SAVE QUIZ GAME</button>
              </form>
            </section>
          )}

          {view === "manage" && selected && (
            <section className="mx-auto max-w-6xl space-y-5">
              {selected.status === "completed" && (
                <section className="space-y-5">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]"><Medal className="mr-2 inline" size={18} />Leaderboard</p>
                  {leaderboardGame?._id === selected._id ? renderLeaderboard() : <p className="text-sm text-slate-400">Unable to load quiz game leaderboard.</p>}
                </section>
              )}
              <div className="rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">Manage Challenge</p>
                    <h2 className="mt-2 text-3xl font-black">{selected.title || "Untitled Quiz Game"}</h2>
                    <p className="mt-1 text-slate-400">{selected.subject} - {selected.questions?.length || 0} questions</p>
                  </div>
                  <span className="rounded-full border border-[#FF6B00]/30 bg-[#FF6B00]/10 px-3 py-1 text-xs font-black uppercase text-[#FFB36B]">{selected.status}</span>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => { setSelected(null); setView("lobby"); }} type="button"><ArrowLeft className="mr-2 inline" size={16} />Lobby</button>
                  <button className="rounded-xl bg-[#FF6B00] px-3 py-2 text-sm font-black text-white hover:bg-[#D94F00]" onClick={() => publishGame(selected._id)} type="button"><Send className="mr-2 inline" size={16} />Publish Quiz Game</button>
                  <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => closeGame(selected._id)} type="button"><XCircle className="mr-2 inline" size={16} />Close Game</button>
                  <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => archiveGame(selected._id)} type="button"><Archive className="mr-2 inline" size={16} />Archive Game</button>
                  <button className="rounded-xl border border-[#FF6B00]/40 bg-[#FF6B00]/10 px-3 py-2 text-sm font-black text-[#FFB36B] hover:bg-[#FF6B00]/15" onClick={() => openResults(selected._id)} type="button"><Eye className="mr-2 inline" size={16} />View Results</button>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <input className={fieldClass()} value={selected.title} onChange={(e) => saveGame({ title: e.target.value })} placeholder="Quiz Game Title" />
                  <input className={fieldClass()} value={selected.subject || ""} onChange={(e) => saveGame({ subject: e.target.value })} placeholder="Subject" />
                  <select className={fieldClass()} value={selected.timePerQuestion} onChange={(e) => saveGame({ timePerQuestion: Number(e.target.value) })}>
                    {[0, 10, 15, 20, 30, 60].map((value) => <option className="bg-[#111]" key={value} value={value}>{secondsLabel(value)}</option>)}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl">
                <h3 className="text-xl font-black">QUESTIONS</h3>
                <div className="mt-4 space-y-3">
                  {draftQuestions.map((draft, draftIndex) => (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3" key={draftIndex}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-black uppercase tracking-[0.18em] text-[#FFB36B]">New Question {draftIndex + 1}</p>
                        <button className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs font-black text-red-200" onClick={() => deleteDraftQuestion(draftIndex)} type="button">Delete Question</button>
                      </div>
                      {questionForm(draft, (next) => updateDraftQuestion(draftIndex, next), "Save Question", (event) => addQuestion(event, draftIndex))}
                    </div>
                  ))}
                  <button className="rounded-xl border border-[#FF6B00]/40 bg-[#FF6B00]/10 px-4 py-2.5 text-sm font-black text-[#FFB36B] hover:bg-[#FF6B00]/15" onClick={addDraftQuestion} type="button"><Plus className="mr-2 inline" size={16} />Add Question</button>
                </div>
                <div className="mt-5 space-y-3">
                  {(selected.questions || []).map((item, index) => {
                    const draft = editing[item._id];
                    const displayChoices = choicesForDisplay(item);
                    return (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" key={item._id}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#FFB36B]">Question {index + 1}</p>
                            {!draft && <h4 className="font-black text-white">{item.questionText}</h4>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-black hover:bg-white/10" onClick={() => moveQuestion(index, -1)} type="button">Up</button>
                            <button className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-black hover:bg-white/10" onClick={() => moveQuestion(index, 1)} type="button">Down</button>
                            {!draft && <button className="rounded-lg border border-[#FF6B00]/40 bg-[#FF6B00]/10 px-2 py-1 text-xs font-black text-[#FFB36B]" onClick={() => setEditing({ ...editing, [item._id]: { questionText: item.questionText, choices: displayChoices, correctAnswer: item.correctAnswer } })} type="button"><Edit3 className="mr-1 inline" size={12} />Edit</button>}
                            <button className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs font-black text-red-200" onClick={() => removeQuestion(item._id)} type="button"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        {draft ? (
                          <div className="space-y-3">
                            {questionForm(draft, (next) => setEditing({ ...editing, [item._id]: next }), "Save Question", (event) => {
                              event.preventDefault();
                              saveQuestion(item._id);
                            })}
                            <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => {
                              const next = { ...editing };
                              delete next[item._id];
                              setEditing(next);
                            }} type="button">Cancel</button>
                          </div>
                        ) : (
                          <dl className="grid gap-2 text-sm md:grid-cols-2">
                            {labels.map((label, choiceIndex) => <div className="rounded-xl bg-black/30 p-3" key={label}><dt className="font-black text-slate-400">{label}</dt><dd>{displayChoices[choiceIndex]}</dd></div>)}
                            <div className="rounded-xl border border-[#FF6B00]/25 bg-[#FF6B00]/10 p-3 md:col-span-2"><dt className="font-black text-[#FFB36B]">Correct Answer</dt><dd>{item.correctAnswer}</dd></div>
                          </dl>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {view === "results" && results && (
            <section className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">Results and Leaderboard</p>
                    <h2 className="mt-2 text-3xl font-black">{results.game?.title}</h2>
                  </div>
                  <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => setView("lobby")} type="button"><ArrowLeft className="mr-2 inline" size={16} />Lobby</button>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
                  {[
                    ["Total Players", results.summary.totalParticipants || results.summary.participants],
                    ["Average Score", results.summary.averageScore],
                    ["Average Accuracy", `${results.summary.averageAccuracy}%`],
                    ["Top Score", results.summary.highestScore],
                    ["Top Accuracy", `${results.summary.highestAccuracy}%`],
                    ["Best Combo", results.summary.bestStreak],
                    ["Fastest Time", `${results.summary.fastestCompletionTime || 0}s`],
                  ].map(([label, value]) => <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3" key={label}><p className="text-xs text-slate-400">{label}</p><p className="text-lg font-black text-white">{value}</p></div>)}
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101010] p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead className="text-xs uppercase text-slate-400"><tr>{["Rank", "Student", "Status", "Score", "Correct", "Accuracy", "Best Combo", "Time", "Date", "Answers"].map((head) => <th className="border-b border-white/10 p-2" key={head}>{head}</th>)}</tr></thead>
                      <tbody>
                        {(results.results || []).map((row) => (
                          <tr key={row._id}>
                            <td className="border-b border-white/10 p-2">{row.rank ? `#${row.rank}` : "—"}</td>
                            <td className="border-b border-white/10 p-2 font-black">{row.student?.name || row.student?.email || "Deleted student"}</td>
                            <td className="border-b border-white/10 p-2">{row.status === "completed" ? "Completed" : "In progress"}</td>
                            <td className="border-b border-white/10 p-2 text-[#FFB36B]">{row.score}</td>
                            <td className="border-b border-white/10 p-2">{row.correctAnswers}</td>
                            <td className="border-b border-white/10 p-2">{row.accuracy}%</td>
                            <td className="border-b border-white/10 p-2">{row.bestStreak}</td>
                            <td className="border-b border-white/10 p-2">{row.completionTime}s</td>
                            <td className="border-b border-white/10 p-2">{row.completedAt ? new Date(row.completedAt).toLocaleString() : ""}</td>
                            <td className="border-b border-white/10 p-2">{row.status === "completed" ? <button className="rounded-lg border border-[#FF6B00]/40 bg-[#FF6B00]/10 px-2 py-1 text-xs font-black text-[#FFB36B]" onClick={() => openAttempt(row._id)} type="button">View</button> : "—"}</td>
                          </tr>
                        ))}
                        {!results.results?.length && <tr><td className="p-3 text-slate-400" colSpan={10}>No students have participated in this game yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-[#101010] p-4">
                    <h3 className="font-black"><Medal className="mr-2 inline text-[#FFB36B]" size={18} />Leaderboard</h3>
                    <div className="mt-3 space-y-2">
                      {leaderboard.map((row) => <p className="rounded-xl bg-white/[0.04] p-2 text-sm" key={row._id}>#{row.rank} {row.student?.name || row.student?.email} - <span className="font-black text-[#FFB36B]">{row.score} XP</span> - {row.accuracy}%</p>)}
                      {!leaderboard.length && <p className="text-sm text-slate-400">No completed attempts yet.</p>}
                    </div>
                  </div>
                  {attemptDetail && (
                    <div className="rounded-2xl border border-white/10 bg-[#101010] p-4">
                      <h3 className="font-black">{attemptDetail.attempt.student?.name || "Student"} Result</h3>
                      <p className="mt-1 text-sm text-slate-400">Final Score: {attemptDetail.attempt.score} - Accuracy: {attemptDetail.attempt.accuracy}% - Best Combo: {attemptDetail.attempt.bestStreak} - Rank: #{attemptDetail.attempt.rank}</p>
                      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                        {attemptDetail.questions.map((item, index) => (
                          <div className="rounded-xl bg-white/[0.04] p-3 text-sm" key={index}>
                            <p className="font-black">{item.question}</p>
                            <p className="text-slate-300">Selected: {item.selectedAnswer || "Unanswered"}</p>
                            <p className="text-slate-300">Correct: {item.correctAnswer}</p>
                            <p className={item.isCorrect ? "text-green-300" : "text-red-300"}>{item.isCorrect ? "Correct" : "Incorrect"} - {item.pointsEarned} points - {item.timeTaken}s</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
          {view === "leaderboard" && leaderboardGame && (
            <section className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]"><Medal className="mr-2 inline" size={18} />Leaderboard</p>
                    <h2 className="mt-2 text-3xl font-black">{leaderboardGame.title}</h2>
                    <p className="mt-2 text-sm text-slate-400">Completed attempts ranked by score, then accuracy and completion time.</p>
                  </div>
                  <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black hover:bg-white/10" onClick={() => setView("lobby")} type="button"><ArrowLeft className="mr-2 inline" size={16} />Lobby</button>
                </div>
              </div>
              {renderLeaderboard()}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
