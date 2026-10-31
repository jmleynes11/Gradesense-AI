import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, Gamepad2, Medal, Play, Target, Trophy, Volume2, VolumeX, Zap } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Panel from "../../components/Panel";
import BrandLogo from "../../components/BrandLogo";
import { api } from "../../services/api";
import { useQuizGameSounds } from "../../hooks/useQuizGameSounds";

function secondsLabel(value) {
  return Number(value) === 0 ? "No Timer" : `${value} Seconds Per Question`;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function localPoints(game, isCorrect, timeTaken, combo) {
  if (!isCorrect || !game?.enablePoints) return 0;
  const scoring = game.scoring || {};
  let points = scoring.correctPoints || 100;
  if (timeTaken <= 5) points += scoring.speedBonusWithin5 || 0;
  else if (timeTaken <= 10) points += scoring.speedBonusWithin10 || 0;
  if (game.enableStreak) {
    if (combo === 2) points += scoring.streakBonus2 || 0;
    if (combo === 3) points += scoring.streakBonus3 || 0;
    if (combo === 5) points += scoring.streakBonus5 || 0;
  }
  return points;
}

function comboLabel(combo) {
  if (combo >= 10) return "QUIZ MASTER";
  if (combo >= 8) return "UNSTOPPABLE";
  if (combo >= 5) return "ON FIRE";
  return "COMBO";
}

function ArenaLoading({ label = "Loading Quiz Arena..." }) {
  const messages = [
    "Loading Quiz Arena...",
    "Preparing your challenge...",
    "Shuffling questions...",
    "Loading game data...",
    "Setting up your challenge...",
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
            animation: `quizArenaFloat ${2.8 + (dot % 5) * 0.45}s ease-in-out infinite`,
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
          <div className="h-full w-3/4 rounded-full bg-[#FF6B00] shadow-[0_0_22px_rgba(255,107,0,0.8)]" style={{ animation: "quizArenaLoad 1.1s ease-in-out infinite alternate" }} />
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-[#FFB36B]">Entering Quiz Arena</p>
      </div>
      <style>{`
        @keyframes quizArenaFloat {
          0%, 100% { transform: translateY(0) scale(1); opacity: .35; }
          50% { transform: translateY(-18px) scale(1.4); opacity: .9; }
        }
        @keyframes quizArenaLoad {
          from { transform: translateX(-28%); width: 42%; }
          to { transform: translateX(82%); width: 72%; }
        }
      `}</style>
    </div>
  );
}

function TimerRing({ total, remaining }) {
  const value = total ? Math.max(0, Math.min(1, remaining / total)) : 1;
  const degrees = Math.round(value * 360);
  const critical = total && remaining <= 4;
  const warning = total && remaining <= 9;
  return (
    <div className={`grid h-24 w-24 place-items-center rounded-full ${critical ? "animate-pulse" : ""}`} style={{ background: `conic-gradient(#FF6B00 ${degrees}deg, rgba(255,255,255,0.12) 0deg)` }}>
      <div className={`grid h-[76px] w-[76px] place-items-center rounded-full bg-[#101010] text-center shadow-inner ${warning ? "shadow-[#FF6B00]/30" : ""}`}>
        <Clock className="mx-auto text-[#FFB36B]" size={16} />
        <p className="text-lg font-black">{total ? remaining : "--"}</p>
        <p className="text-[10px] font-bold uppercase text-slate-400">SEC</p>
      </div>
    </div>
  );
}

export default function StudentQuizGames({ initialView = "dashboard", initialGameId = "" }) {
  const [dashboard, setDashboard] = useState({ games: [], stats: {}, recentGames: [] });
  const [session, setSession] = useState(null);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const [answers, setAnswers] = useState([]);
  const [locked, setLocked] = useState(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [result, setResult] = useState(null);
  const [leaderboardResult, setLeaderboardResult] = useState({ gameId: "", rows: [] });
  const [leaderboardGameId, setLeaderboardGameId] = useState(initialGameId);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [view, setView] = useState(initialView);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [initialResultLoading, setInitialResultLoading] = useState(initialView === "complete" && Boolean(initialGameId));
  const [loadingLabel, setLoadingLabel] = useState("Loading Quiz Arena...");
  const [arenaActive, setArenaActive] = useState(true);
  const sounds = useQuizGameSounds();
  const playedQuestionRef = useRef("");
  const playedTimerStartRef = useRef("");
  const playedWarning10Ref = useRef("");
  const playedWarning5Ref = useRef("");
  const playedCountdownRef = useRef("");
  const playedTimeoutRef = useRef("");
  const playedCompletionRef = useRef("");
  const playedAnswerRef = useRef("");
  const current = session?.game.questions[index];
  const total = session?.game.questions.length || 0;
  const leaderboardGames = Array.from(new Map([
    ...(dashboard.games || []),
    ...(dashboard.recentGames || []).map((attempt) => attempt.quizGame),
    session?.game,
  ].filter((game) => game?._id).map((game) => [String(game._id), game])).values());
  const displayedLeaderboardGameId = String((view === "complete" ? session?.game._id : leaderboardGameId || session?.game._id || leaderboardGames[0]?._id) || "");
  const leaderboard = leaderboardResult.gameId === displayedLeaderboardGameId ? leaderboardResult.rows : [];

  useEffect(() => {
    if (!["leaderboard", "complete"].includes(view) || !displayedLeaderboardGameId) return undefined;
    if (view === "complete" && session?.game.showLeaderboard === false) return undefined;
    let active = true;
    setLeaderboardLoading(true);
    setLeaderboardError("");
    setLeaderboardResult({ gameId: displayedLeaderboardGameId, rows: [] });
    api.quizGameLeaderboard(displayedLeaderboardGameId).then((rows) => {
      if (active) setLeaderboardResult({ gameId: displayedLeaderboardGameId, rows });
    }).catch((error) => {
      if (active) setLeaderboardError(error.message || "Unable to load quiz game leaderboard.");
    }).finally(() => {
      if (active) setLeaderboardLoading(false);
    });
    return () => { active = false; };
  }, [view, displayedLeaderboardGameId, session?.game.showLeaderboard]);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (loading || !initialGameId || initialView === "complete") return;
    const card = document.getElementById(`quiz-game-${initialGameId}`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    card?.focus({ preventScroll: true });
    if (!dashboard.games.some((game) => String(game._id) === initialGameId)) setMessage("This quiz game is no longer available.");
  }, [loading, initialGameId, initialView]);

  useEffect(() => {
    if (initialView !== "complete" || !initialGameId) return undefined;
    let active = true;
    api.quizGameStudentResult(initialGameId).then((data) => {
      if (!active) return;
      setSession({ game: data.game });
      setResult(data.result);
    }).catch((error) => { if (active) { setMessage(error.message); setView("stats"); } })
      .finally(() => { if (active) setInitialResultLoading(false); });
    return () => { active = false; };
  }, [initialGameId, initialView]);

  useEffect(() => {
    if (!session || result) return undefined;
    if (!session.game.timePerQuestion) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          timeoutQuestion();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.attemptId, index, result, locked]);

  useEffect(() => {
    if (!session?.attemptId || result) return;
    sounds.play("start");
    sounds.startMusic();
  }, [session?.attemptId]);

  useEffect(() => {
    const questionId = current?._id;
    if (!questionId || view !== "gameplay" || playedQuestionRef.current === questionId) return;
    playedQuestionRef.current = questionId;
    sounds.play("question", index === 0 ? 0.36 : 0);
    if (session?.game.timePerQuestion && playedTimerStartRef.current !== questionId) {
      playedTimerStartRef.current = questionId;
      sounds.play("timerStart", index === 0 ? 0.5 : 0.12);
    }
  }, [current?._id, view]);

  useEffect(() => {
    const questionId = current?._id;
    if (!questionId || !session?.game.timePerQuestion || locked || remaining <= 0) return;
    if (remaining === 10 && playedWarning10Ref.current !== questionId) {
      playedWarning10Ref.current = questionId;
      sounds.play("warning10");
    }
    if (remaining === 5 && playedWarning5Ref.current !== questionId) {
      playedWarning5Ref.current = questionId;
      sounds.play("warning5");
    }
    const countdownEvent = `${questionId}:${remaining}`;
    if (remaining <= 3 && playedCountdownRef.current !== countdownEvent) {
      playedCountdownRef.current = countdownEvent;
      sounds.play("countdown");
    }
  }, [current?._id, remaining, locked, session?.game.timePerQuestion]);

  useEffect(() => {
    if (!result || !session?.attemptId || playedCompletionRef.current === session.attemptId) return;
    playedCompletionRef.current = session.attemptId;
    sounds.stopMusic();
    sounds.play(result.accuracy >= 50 ? "complete" : "completeLow");
  }, [result, session?.attemptId]);

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
    await withLoading("Loading Quiz Arena...", async () => {
      setDashboard(await api.quizGameStudentDashboard());
    });
  }

  async function startGame(gameId) {
    await sounds.unlock();
    sounds.play("loading");
    const started = await withLoading("Loading game data...", () => api.startQuizGame(gameId));
    setSession(started);
    setIndex(0);
    setAnswers([]);
    setLocked(null);
    setScore(0);
    setCombo(0);
    setBestCombo(0);
    setResult(null);
    setLeaderboardResult({ gameId: "", rows: [] });
    setMessage("");
    setQuestionStartedAt(Date.now());
    setRemaining(Number(started.game.timePerQuestion || 0));
    setView("gameplay");
    setArenaActive(true);
  }

  const progress = total ? Math.round(((index + (locked ? 1 : 0)) / total) * 100) : 0;
  const startedAt = useMemo(() => Date.now(), [session?.attemptId]);
  const xp = dashboard.stats?.bestScore || 0;
  const level = Math.max(1, Math.floor(xp / 300) + 1);
  const nextLevelXp = level * 300;
  const currentLevelXp = (level - 1) * 300;
  const xpProgress = Math.min(100, Math.round(((xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100));

  function answerQuestion(choice) {
    if (!current || locked) return;
    const timeTaken = Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000));
    const isCorrect = choice.label === current.correctAnswer;
    const nextCombo = isCorrect ? combo + 1 : 0;
    const pointsEarned = localPoints(session.game, isCorrect, timeTaken, nextCombo);
    const answerEvent = `${session.attemptId}:${current._id}`;
    if (playedAnswerRef.current !== answerEvent) {
      playedAnswerRef.current = answerEvent;
      sounds.play("select");
      sounds.play(isCorrect ? "correct" : "incorrect", 0.09);
      if (pointsEarned) sounds.play("points", 0.37);
      if ([2, 3, 5, 8, 10].includes(nextCombo)) sounds.play("streak", 0.62);
    }
    const entry = {
      questionId: current._id,
      selectedChoiceId: choice._id,
      selectedAnswer: choice.value,
      correctAnswer: current.correctAnswerValue,
      isCorrect,
      pointsEarned,
      timeTaken,
    };
    setLocked(entry);
    setAnswers((items) => [...items, entry]);
    setScore((value) => value + pointsEarned);
    setCombo(nextCombo);
    setBestCombo((value) => Math.max(value, nextCombo));
  }

  function timeoutQuestion() {
    if (!current || locked) return;
    const timeoutEvent = `${session?.attemptId}:${current._id}`;
    if (playedTimeoutRef.current !== timeoutEvent) {
      playedTimeoutRef.current = timeoutEvent;
      sounds.play("timeout");
    }
    const entry = {
      questionId: current._id,
      selectedAnswer: "",
      correctAnswer: current.correctAnswerValue,
      isCorrect: false,
      pointsEarned: 0,
      timeTaken: Number(session?.game.timePerQuestion || 0),
    };
    setLocked(entry);
    setAnswers((items) => [...items, entry]);
    setCombo(0);
  }

  async function nextQuestion() {
    if (index < total - 1) {
      setIndex(index + 1);
      setLocked(null);
      setQuestionStartedAt(Date.now());
      setRemaining(Number(session.game.timePerQuestion || 0));
      return;
    }
    const completionTime = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const completed = await withLoading("Finalizing results...", () => api.submitQuizGameAttempt(session.attemptId, { answers, completionTime }));
    setResult(completed);
    await loadDashboard();
    setView("complete");
  }

  function leaveGameplay(nextView = "dashboard") {
    sounds.stopAll();
    setView(nextView);
  }

  function openLeaderboard(gameId) {
    setLeaderboardGameId(String(gameId));
    setView("leaderboard");
    setArenaActive(true);
  }

  function renderLeaderboard() {
    return (
      <>
        <div className="grid gap-4 md:grid-cols-3">
          {leaderboard.slice(0, 3).map((row, index) => (
            <div className={`rounded-2xl border p-5 text-center ${index === 0 ? "border-yellow-400/50 bg-yellow-400/10 md:-mt-4" : "border-white/10 bg-white/5"}`} key={row._id}>
              <Medal className="mx-auto text-[#FFB36B]" size={42} />
              <p className="mt-2 text-sm font-black text-slate-400">Rank #{row.rank}</p>
              <h3 className="mt-1 text-xl font-black">{row.student?.name || row.student?.email}</h3>
              <p className="mt-2 text-2xl font-black text-[#FFB36B]">{row.score} XP</p>
              <p className="text-sm text-slate-400">{row.accuracy}% accuracy - {formatTime(row.completionTime)}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {leaderboard.slice(3).map((row) => (
            <div className={`flex items-center justify-between rounded-xl border p-3 ${row.isCurrentStudent ? "border-[#FF6B00] bg-[#FF6B00]/12" : "border-white/10 bg-white/5"}`} key={row._id}>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-black text-sm font-black">#{row.rank}</div>
                <div>
                  <p className="font-black">{row.isCurrentStudent ? "You" : row.student?.name || row.student?.email}</p>
                  <p className="text-sm text-slate-400">{row.accuracy}% accuracy - {formatTime(row.completionTime)}</p>
                </div>
              </div>
              <p className="text-lg font-black text-[#FFB36B]">{row.score} XP</p>
            </div>
          ))}
          {leaderboardError && <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-slate-300">{leaderboardError}</div>}
          {!leaderboard.length && !leaderboardError && <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-slate-300">{leaderboardLoading ? "Loading leaderboard..." : "No completed attempts yet."}</div>}
        </div>
      </>
    );
  }

  if (!arenaActive) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Quiz Game" title="Quiz Games" description="The Quiz Arena is available as a separate mini-game experience." actions={<button className="btn-primary px-4 py-2 text-sm" onClick={() => setArenaActive(true)} type="button">Enter Quiz Arena</button>} />
        <Panel title="Quiz Arena" eyebrow="Game mode">
          <p className="text-sm text-slate-600">Game mode is closed. The normal GradeSense AI dashboard interface is active.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#060606] text-white">
      {(loading || initialResultLoading) && <ArenaLoading label={loadingLabel} />}
      <div className="min-h-screen bg-[radial-gradient(circle_at_20%_10%,rgba(255,107,0,0.17),transparent_28%),linear-gradient(180deg,#090909,#151515_48%,#090909)]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandLogo variant="icon" className="h-11 w-11 rounded-xl bg-white object-contain p-1 shadow-[0_0_26px_rgba(255,107,0,0.45)]" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">GradeSense</p>
                <h1 className="text-xl font-black tracking-wide">QUIZ ARENA</h1>
              </div>
            </div>
            <nav className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1" role="group" aria-label="Quiz Arena audio controls">
                <button aria-label={sounds.musicEnabled ? "Mute Quiz Arena music" : "Enable Quiz Arena music"} className="rounded-md p-2 text-[#FFB36B] hover:bg-white/10" onClick={() => {
                  if (sounds.musicEnabled) sounds.setMusicEnabled(false);
                  else {
                    sounds.setMusicEnabled(true);
                    sounds.unlock().then(() => window.setTimeout(sounds.startMusic, 0));
                  }
                }} type="button">
                  {sounds.musicEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <input aria-label="Quiz Arena music volume" className="h-1 w-12 accent-[#FF6B00]" disabled={!sounds.musicEnabled} max="1" min="0" onChange={(event) => sounds.setMusicVolume(event.target.value)} step="0.05" type="range" value={sounds.musicVolume} />
                <button aria-label={sounds.effectsEnabled ? "Mute Quiz Arena sound effects" : "Enable Quiz Arena sound effects"} className="rounded-md p-2 text-[#FFB36B] hover:bg-white/10" onClick={() => sounds.setEffectsEnabled(!sounds.effectsEnabled)} type="button">
                  {sounds.effectsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <input aria-label="Quiz Arena sound effects volume" className="h-1 w-12 accent-[#FF6B00]" disabled={!sounds.effectsEnabled} max="1" min="0" onChange={(event) => sounds.setEffectsVolume(event.target.value)} step="0.05" type="range" value={sounds.effectsVolume} />
              </div>
              <button className={`rounded-lg px-3 py-2 text-sm font-bold ${view === "dashboard" ? "bg-[#FF6B00] text-white" : "bg-white/10 text-slate-200"}`} onClick={() => leaveGameplay()} type="button">Game Lobby</button>
              <button className={`rounded-lg px-3 py-2 text-sm font-bold ${view === "stats" ? "bg-[#FF6B00] text-white" : "bg-white/10 text-slate-200"}`} onClick={() => view === "gameplay" ? leaveGameplay("stats") : setView("stats")} type="button">My Stats</button>
              <button className={`rounded-lg px-3 py-2 text-sm font-bold ${view === "leaderboard" ? "bg-[#FF6B00] text-white" : "bg-white/10 text-slate-200"}`} onClick={() => view === "gameplay" ? leaveGameplay("leaderboard") : setView("leaderboard")} type="button">Leaderboard</button>
              <button className="rounded-lg border border-white/15 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-white/10" onClick={() => { sounds.stopAll(); setArenaActive(false); }} type="button"><ArrowLeft className="mr-2 inline" size={16} />Back to GradeSense</button>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          {message && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm font-bold text-red-200">{message}</div>}

          {view === "dashboard" && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.26em] text-[#FFB36B]">Game Lobby</p>
                    <h2 className="mt-2 text-4xl font-black md:text-6xl">GRADE SENSE QUIZ ARENA</h2>
                    <p className="mt-3 max-w-2xl text-slate-300">Practice multiple-choice challenges, earn XP, build combos, and climb the leaderboard.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#FF6B00]/30 bg-[#FF6B00]/10 p-4"><p className="text-sm text-[#FFB36B]">Game Streak</p><p className="text-3xl font-black">{dashboard.stats?.bestStreak || 0}</p></div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-sm text-slate-400">Current XP</p><p className="text-3xl font-black text-[#FFB36B]">{xp}</p></div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-sm text-slate-400">Level</p><p className="text-3xl font-black">{level}</p></div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-sm text-slate-400">Games Played</p><p className="text-3xl font-black">{dashboard.stats?.gamesPlayed || 0}</p></div>
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">AVAILABLE GAMES</h2>
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/15" onClick={() => setView("stats")} type="button">MY STATS</button>
                    <button className="rounded-lg bg-[#FF6B00] px-3 py-2 text-sm font-bold text-white hover:bg-[#D94F00]" onClick={() => setView("leaderboard")} type="button">LEADERBOARD</button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(dashboard.games || []).map((game, gameIndex) => (
                    <article id={`quiz-game-${game._id}`} tabIndex={initialGameId === game._id ? -1 : undefined} className="group overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-xl transition hover:-translate-y-1 hover:border-[#FF6B00]/60 hover:shadow-[0_0_38px_rgba(255,107,0,0.16)]" key={game._id}>
                      <div className="h-32 bg-[radial-gradient(circle_at_30%_20%,rgba(255,107,0,0.45),transparent_26%),linear-gradient(135deg,#1f1f1f,#090909)] p-4">
                        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-black/40 text-[#FFB36B]"><Gamepad2 size={34} /></div>
                      </div>
                      <div className="p-5">
                        {game.completed && game.showLeaderboard !== false && <button className="mb-4 rounded-xl border border-[#FF6B00] px-5 py-3 font-black text-[#FFB36B] hover:bg-[#FF6B00]/10" onClick={() => openLeaderboard(game._id)} type="button"><Trophy className="mr-2 inline" size={18} />VIEW LEADERBOARD</button>}
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FFB36B]">{game.subject || "Challenge"} - {game.className || "Class Game"}</p>
                        <div className="mt-2 flex items-start justify-between gap-3">
                          <h3 className="text-xl font-black">{game.title || ["Math Master", "History Quest", "English Adventure"][gameIndex % 3]}</h3>
                          {game.completed && <span className="inline-flex items-center gap-1 rounded-full border border-green-400/35 bg-green-500/15 px-2.5 py-1 text-xs font-black uppercase text-green-200"><CheckCircle2 size={13} />Completed</span>}
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div><dt className="text-slate-400">Questions</dt><dd className="font-bold">{game.numberOfQuestions}</dd></div>
                          <div><dt className="text-slate-400">Timer</dt><dd className="font-bold">{secondsLabel(game.timePerQuestion)}</dd></div>
                          <div><dt className="text-slate-400">Max Points</dt><dd className="font-bold text-[#FFB36B]">{game.maximumPoints || game.numberOfQuestions * 100}</dd></div>
                          <div><dt className="text-slate-400">Players</dt><dd className="font-bold">{game.participants}</dd></div>
                          <div className="col-span-2"><dt className="text-slate-400">Status</dt><dd className={game.completed ? "font-bold text-green-200" : "font-bold text-[#FFB36B]"}>{game.completed ? "Completed" : "Ready to play"}</dd></div>
                        </dl>
                        <button
                          className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-black transition ${game.completed ? "cursor-not-allowed bg-green-500/20 text-green-100" : "bg-[#FF6B00] text-white hover:bg-[#D94F00] hover:shadow-[0_0_24px_rgba(255,107,0,0.35)]"}`}
                          disabled={!!game.completed}
                          onClick={() => startGame(game._id).catch((error) => setMessage(error.message))}
                          type="button"
                        >
                          {game.completed ? <CheckCircle2 size={18} /> : <Play size={18} />}
                          {game.completed ? "COMPLETED" : "PLAY NOW"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {!dashboard.games?.length && <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-slate-300">No active quiz games are assigned to your class.</div>}
                </div>
              </section>
            </div>
          )}

          {view === "gameplay" && session && current && (
            <div className="mx-auto max-w-5xl space-y-5">
              <section className="rounded-2xl border border-white/10 bg-black/55 p-4 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <button className="rounded-lg border border-white/15 px-3 py-2 text-sm font-bold text-white hover:bg-white/10" onClick={() => leaveGameplay()} type="button"><ArrowLeft className="mr-2 inline" size={16} />Lobby</button>
                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FFB36B]">{session.game.title}</p>
                    <h2 className="truncate text-2xl font-black">QUESTION {String(index + 1).padStart(2, "0")} / {total}</h2>
                  </div>
                  <TimerRing total={Number(session.game.timePerQuestion || 0)} remaining={remaining} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-slate-400">POINTS</p><p className="text-2xl font-black text-[#FFB36B]">{score}</p></div>
                  <div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-slate-400">{comboLabel(combo)}</p><p className="text-2xl font-black">x{combo}</p></div>
                  <div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-slate-400">PROGRESS</p><p className="text-2xl font-black">{progress}%</p></div>
                </div>
                <div className="mt-4 h-3 rounded-full bg-white/10"><div className="h-3 rounded-full bg-[#FF6B00] shadow-[0_0_18px_rgba(255,107,0,0.75)] transition-all" style={{ width: `${progress}%` }} /></div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#101010] p-5 shadow-2xl md:p-8">
                <h2 className="text-2xl font-black leading-9 md:text-3xl">{current.questionText}</h2>
                <div className="mt-6 grid gap-3">
                  {(current.choices || []).map((choice, choiceIndex) => {
                    const selected = locked?.selectedChoiceId === choice._id;
                    const correct = locked && session.game.showCorrectAnswer && choice.label === current.correctAnswer;
                    const wrong = selected && locked && !locked.isCorrect;
                    return (
                      <button
                        className={`flex min-h-16 items-center gap-4 rounded-xl border px-4 py-3 text-left transition hover:-translate-y-0.5 disabled:hover:translate-y-0 ${correct ? "border-green-400 bg-green-500/15 text-green-100" : wrong ? "border-red-400 bg-red-500/15 text-red-100" : selected ? "border-[#FF6B00] bg-[#FF6B00]/15 text-[#FFB36B] shadow-[0_0_24px_rgba(255,107,0,0.18)]" : "border-white/10 bg-white/[0.04] text-slate-100 hover:border-[#FF6B00]/70 hover:bg-[#FF6B00]/10"}`}
                        disabled={!!locked}
                        key={choice._id}
                        onClick={() => answerQuestion(choice)}
                        type="button"
                      >
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/45 text-sm font-black">{String.fromCharCode(65 + choiceIndex)}</span>
                        <span className="font-black uppercase tracking-wide">{choice.value}</span>
                      </button>
                    );
                  })}
                </div>
                {locked && (
                  <div className={`mt-6 rounded-2xl border p-5 ${locked.isCorrect ? "border-green-400/40 bg-green-500/10 text-green-100" : "border-red-400/40 bg-red-500/10 text-red-100"}`}>
                    <h3 className="text-3xl font-black">{locked.isCorrect ? "PERFECT!" : locked.selectedAnswer ? "NOT QUITE!" : "TIME'S UP!"}</h3>
                    <p className="mt-2 text-xl font-black">{locked.isCorrect ? `+${locked.pointsEarned} XP` : session.game.showCorrectAnswer ? `Correct Answer: ${current.correctAnswerValue}` : "+0 XP"}</p>
                    {locked.isCorrect && combo > 1 && <p className="mt-1 text-[#FFB36B]">COMBO x{combo} - {comboLabel(combo)}</p>}
                    {!locked.isCorrect && session.game.showCorrectAnswer && <p className="mt-2 text-sm text-slate-200">Review the correct answer before continuing.</p>}
                    <button className="mt-4 rounded-xl bg-[#FF6B00] px-5 py-3 font-black text-white hover:bg-[#D94F00]" onClick={nextQuestion} type="button">{index < total - 1 ? "CONTINUE" : "COMPLETE CHALLENGE"}</button>
                  </div>
                )}
              </section>
            </div>
          )}

          {view === "complete" && result && (
            <div className="mx-auto max-w-5xl space-y-5">
              {session.game.showLeaderboard !== false && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-[#FFB36B]">{session.game.title}</p>
                    <h2 className="text-4xl font-black">LEADERBOARD</h2>
                  </div>
                  {renderLeaderboard()}
                </section>
              )}
              <section className="mx-auto max-w-5xl rounded-2xl border border-[#FF6B00]/30 bg-[#101010] p-8 text-center shadow-[0_0_50px_rgba(255,107,0,0.13)]">
                <Trophy className="mx-auto text-[#FFB36B]" size={72} />
                <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">Challenge Complete</p>
                <h1 className="mt-2 text-6xl font-black text-white">{result.score}</h1>
                <p className="text-sm font-black uppercase tracking-[0.22em] text-slate-400">Final Score</p>
                <div className="mt-8 grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-slate-400">Correct</p><p className="text-2xl font-black">{result.correctAnswers} / {session.game.questions.length}</p></div>
                  <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-slate-400">Accuracy</p><p className="text-2xl font-black">{result.accuracy}%</p></div>
                  <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-slate-400">Best Combo</p><p className="text-2xl font-black">x{result.bestStreak || bestCombo}</p></div>
                  <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-slate-400">Time Taken</p><p className="text-2xl font-black">{formatTime(result.completionTime)}</p></div>
                  <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-slate-400">Rank</p><p className="text-2xl font-black">#{result.rank || "-"}</p></div>
                </div>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <button className="cursor-not-allowed rounded-xl bg-green-500/20 px-5 py-3 font-black text-green-100" disabled type="button"><CheckCircle2 className="mr-2 inline" size={18} />COMPLETED</button>
                  <button className="rounded-xl border border-[#FF6B00] px-5 py-3 font-black text-[#FFB36B] hover:bg-[#FF6B00]/10" onClick={() => openLeaderboard(session.game._id)} type="button"><Trophy className="mr-2 inline" size={18} />VIEW LEADERBOARD</button>
                  <button className="rounded-xl border border-white/15 px-5 py-3 font-black text-white hover:bg-white/10" onClick={() => setView("dashboard")} type="button">BACK TO LOBBY</button>
                </div>
              </section>
            </div>
          )}

          {view === "leaderboard" && (
            <section className="space-y-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-[#FFB36B]">Arena Rankings</p>
                <h2 className="text-4xl font-black">LEADERBOARD</h2>
                <select aria-label="Quiz Game leaderboard" className="mt-3 rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 text-sm font-semibold text-white focus:border-[#FF6B00]" value={displayedLeaderboardGameId} onChange={(event) => setLeaderboardGameId(event.target.value)}>
                  {!leaderboardGames.length && <option value="">No quiz games available</option>}
                  {leaderboardGames.map((game) => <option key={game._id} value={game._id}>{game.title}</option>)}
                </select>
              </div>
              {renderLeaderboard()}
            </section>
          )}

          {view === "stats" && (
            <section className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFB36B]">My Stats</p>
                <h2 className="mt-2 text-4xl font-black">LEVEL {level}</h2>
                <div className="mt-4 h-4 rounded-full bg-white/10"><div className="h-4 rounded-full bg-[#FF6B00]" style={{ width: `${xpProgress}%` }} /></div>
                <p className="mt-2 text-sm text-slate-400">{xp} / {nextLevelXp} XP</p>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4"><Trophy className="text-[#FFB36B]" /><p className="mt-3 text-sm text-slate-400">Best Score</p><p className="text-3xl font-black">{dashboard.stats?.bestScore || 0}</p></div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4"><Target className="text-[#FFB36B]" /><p className="mt-3 text-sm text-slate-400">Best Accuracy</p><p className="text-3xl font-black">{dashboard.stats?.bestAccuracy || 0}%</p></div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4"><Zap className="text-[#FFB36B]" /><p className="mt-3 text-sm text-slate-400">Best Combo</p><p className="text-3xl font-black">x{dashboard.stats?.bestStreak || 0}</p></div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4"><Gamepad2 className="text-[#FFB36B]" /><p className="mt-3 text-sm text-slate-400">Games Played</p><p className="text-3xl font-black">{dashboard.stats?.gamesPlayed || 0}</p></div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="font-black">RECENT GAMES</h3>
                <div className="mt-4 space-y-2">
                  {(dashboard.recentGames || []).map((attempt) => (
                    <div className="grid gap-2 rounded-xl bg-black/30 p-3 text-sm md:grid-cols-4" key={attempt._id}>
                      <p className="font-black">{attempt.quizGame?.title}</p>
                      <p className="text-slate-400">{attempt.completedAt ? new Date(attempt.completedAt).toLocaleDateString() : ""}</p>
                      <p className="text-[#FFB36B]">{attempt.score} XP</p>
                      <p>Rank #{attempt.rank || "-"}</p>
                    </div>
                  ))}
                  {!dashboard.recentGames?.length && <p className="text-sm text-slate-400">No recent games yet.</p>}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
