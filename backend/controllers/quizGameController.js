const Subject = require("../models/Subject");
const QuizGame = require("../models/QuizGame");
const QuizGameAttempt = require("../models/QuizGameAttempt");
const QuizGameQuestion = require("../models/QuizGameQuestion");
const { notifyStudents } = require("../services/notificationService");
const { notifyGameAvailable } = require("../services/notificationEvents");

function seededShuffle(items, seed) {
  const result = [...items];
  let state = Array.from(String(seed)).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const target = Math.floor((state / 233280) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function normalizeQuestionPayload(body, userId) {
  const labels = ["A", "B", "C", "D"];
  const rawChoices = Array.isArray(body.choices)
    ? body.choices
    : labels.map((label) => body.choices?.[label] || body[label] || "");
  const choices = labels.map((label, index) => {
    const source = rawChoices[index] || {};
    if (typeof source === "string") return { label, value: source.trim() };
    return { _id: source._id, label: source.label || label, value: String(source.value || "").trim() };
  });

  if (!body.questionText?.trim()) throw Object.assign(new Error("Question text is required."), { status: 400 });
  if (choices.some((choice) => !choice.value)) throw Object.assign(new Error("All four choices are required."), { status: 400 });
  const uniqueChoices = new Set(choices.map((choice) => choice.value.toLowerCase()));
  if (uniqueChoices.size !== 4) throw Object.assign(new Error("Duplicate choices are not allowed."), { status: 400 });

  const rawCorrectAnswer = String(body.correctAnswer || "").trim();
  let correctAnswer = rawCorrectAnswer.toUpperCase();
  if (!labels.includes(correctAnswer)) {
    const matchingChoice = choices.find((choice) => choice.value.toLowerCase() === rawCorrectAnswer.toLowerCase());
    correctAnswer = matchingChoice?.label || correctAnswer;
  }
  if (!labels.includes(correctAnswer)) throw Object.assign(new Error("Please select the correct answer."), { status: 400 });
  const correctChoice = choices.find((choice) => choice.label === correctAnswer);

  return {
    questionText: body.questionText.trim(),
    choices,
    correctChoiceId: correctChoice._id,
    subject: body.subject || "",
    correctAnswer,
    createdBy: userId,
  };
}

function getCorrectChoice(question) {
  return (question.choices || []).find((choice) => choice.label === question.correctAnswer)
    || (question.choices || []).find((choice) => choice.value === question.correctAnswer);
}

function getCorrectLabel(question) {
  return getCorrectChoice(question)?.label || question.correctAnswer;
}

function serializeQuestionForGame(question) {
  const correctChoice = getCorrectChoice(question);
  return {
    ...question.toObject(),
    correctAnswerValue: correctChoice?.value || "",
  };
}

function gameStats(game, attempts) {
  const completed = attempts.filter((attempt) => attempt.completedAt);
  const scores = completed.map((attempt) => Number(attempt.score || 0));
  const accuracies = completed.map((attempt) => Number(attempt.accuracy || 0));
  return {
    participants: new Set(attempts.map((attempt) => String(attempt.student?._id || attempt.student))).size,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    highestScore: scores.length ? Math.max(...scores) : 0,
    averageAccuracy: accuracies.length ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length) : 0,
    highestAccuracy: accuracies.length ? Math.max(...accuracies) : 0,
    bestStreak: completed.length ? Math.max(...completed.map((attempt) => Number(attempt.bestStreak || 0))) : 0,
    fastestCompletionTime: completed.length ? Math.min(...completed.map((attempt) => Number(attempt.completionTime || 0)).filter(Boolean)) : 0,
    completedAttempts: completed.length,
  };
}

async function recalculateRanks(gameId) {
  const attempts = await QuizGameAttempt.find({ quizGame: gameId, completedAt: { $ne: null } }).sort({
    score: -1,
    accuracy: -1,
    completionTime: 1,
  });
  await Promise.all(attempts.map((attempt, index) => QuizGameAttempt.findByIdAndUpdate(attempt._id, { rank: index + 1 })));
}

async function teacherDashboard(req, res) {
  const games = await QuizGame.find({ teacher: req.user._id }).populate("subjectRef", "name code").sort({ updatedAt: -1 });
  const attempts = await QuizGameAttempt.find({ quizGame: { $in: games.map((game) => game._id) } }).select("-answers -questionSequence").populate("student", "name email");
  const attemptsByGame = attempts.reduce((map, attempt) => {
    const id = String(attempt.quizGame);
    if (!map[id]) map[id] = [];
    map[id].push(attempt);
    return map;
  }, {});
  const completed = attempts.filter((attempt) => attempt.completedAt);
  const scores = completed.map((attempt) => Number(attempt.score || 0));

  res.json({
    summary: {
      quizGamesCreated: games.length,
      activeGames: games.filter((game) => game.status === "active").length,
      completedGames: games.filter((game) => game.status === "completed").length,
      draftGames: games.filter((game) => game.status === "draft").length,
      totalParticipants: new Set(attempts.map((attempt) => String(attempt.student?._id || attempt.student))).size,
      averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
      highestScore: scores.length ? Math.max(...scores) : 0,
    },
    games: games.map((game) => {
      const stats = gameStats(game, attemptsByGame[String(game._id)] || []);
      return {
        ...game.toObject(),
        numberOfQuestions: game.questions.length,
        participants: stats.participants,
        completedPlayers: stats.completedAttempts,
        averageScore: stats.averageScore,
        highestScore: stats.highestScore,
      };
    }),
  });
}

async function createGame(req, res) {
  const subject = await Subject.findOne({ _id: req.body.subjectRef, teacher: req.user._id, archived: { $ne: true } });
  if (!subject) return res.status(400).json({ message: "Select an existing subject." });
  const game = await QuizGame.create({ ...req.body, subjectRef: subject._id, subject: subject.name, teacher: req.user._id, status: req.body.status || "draft" });
  await notifyGameAvailable(game);
  res.status(201).json(await QuizGame.findById(game._id).populate("subjectRef", "name code").populate("questions"));
}

async function getGame(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id }).populate("subjectRef", "name code").populate("questions");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  res.json(game);
}

async function updateGame(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  if (game.status === "active" && !["completed", "archived", "active"].includes(req.body.status || game.status)) {
    return res.status(400).json({ message: "Active quiz games can only be updated for status controls." });
  }
  Object.assign(game, req.body);
  await game.save();
  await notifyGameAvailable(game);
  res.json(await QuizGame.findById(game._id).populate("class", "className subject").populate("questions"));
}

async function deleteGame(req, res) {
  const game = await QuizGame.findOneAndDelete({ _id: req.params.id, teacher: req.user._id });
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  await QuizGameAttempt.deleteMany({ quizGame: game._id });
  await QuizGameQuestion.deleteMany({ _id: { $in: game.questions || [] }, createdBy: req.user._id });
  res.json({ message: "Quiz game deleted" });
}

async function publishGame(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id }).populate("questions");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  if (!game.questions.length) return res.status(400).json({ message: "Add at least one multiple-choice question before publishing." });
  for (const question of game.questions) {
    try {
      normalizeQuestionPayload(question.toObject ? question.toObject() : question, req.user._id);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  }
  game.status = "active";
  game.publishedAt = new Date();
  await game.save();
  await notifyGameAvailable(game);
  res.json(game);
}

async function setStatus(req, res) {
  const allowed = { close: "completed", archive: "archived" };
  const action = req.params.action || (req.path.endsWith("/close") ? "close" : req.path.endsWith("/archive") ? "archive" : "");
  const status = allowed[action];
  if (!status) return res.status(400).json({ message: "Invalid status action" });
  const game = await QuizGame.findOneAndUpdate(
    { _id: req.params.id, teacher: req.user._id },
    { status, ...(status === "completed" ? { closedAt: new Date() } : {}) },
    { new: true },
  ).populate("class", "className subject").populate("questions");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  res.json(game);
}

async function addManualQuestion(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const question = await QuizGameQuestion.create(normalizeQuestionPayload({ ...req.body, subject: game.subject }, req.user._id));
  game.questions.push(question._id);
  await game.save();
  res.status(201).json(question);
}

async function updateGameQuestion(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!game || !game.questions.map(String).includes(String(req.params.questionId))) return res.status(404).json({ message: "Question not found" });
  const question = await QuizGameQuestion.findOne({ _id: req.params.questionId, createdBy: req.user._id });
  if (!question) return res.status(404).json({ message: "Question not found" });
  Object.assign(question, normalizeQuestionPayload({ ...req.body, subject: game.subject }, req.user._id));
  await question.save();
  res.json(question);
}

async function reorderGameQuestions(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const existing = new Set(game.questions.map(String));
  const ordered = (req.body.orderedQuestionIds || []).filter((id) => existing.has(String(id)));
  game.questions = ordered;
  await game.save();
  res.json(await QuizGame.findById(game._id).populate("questions").populate("class", "className subject"));
}

async function removeGameQuestion(req, res) {
  const game = await QuizGame.findOneAndUpdate(
    { _id: req.params.id, teacher: req.user._id },
    { $pull: { questions: req.params.questionId } },
    { new: true },
  ).populate("questions").populate("class", "className subject");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  res.json(game);
}

async function studentDashboard(req, res) {
  const subjects = await Subject.find({ students: req.user._id }).select("_id");
  const games = await QuizGame.find({ subjectRef: { $in: subjects.map((item) => item._id) }, status: "active" }).sort({ publishedAt: -1 });
  const attempts = await QuizGameAttempt.find({ student: req.user._id }).select("-answers -questionSequence").populate("quizGame", "title subject").sort({ completedAt: -1, createdAt: -1 });
  const participants = await QuizGameAttempt.aggregate([
    { $match: { quizGame: { $in: games.map((game) => game._id) } } },
    { $group: { _id: { game: "$quizGame", student: "$student" } } },
    { $group: { _id: "$_id.game", count: { $sum: 1 } } },
  ]);
  const participantsByGame = new Map(participants.map((row) => [String(row._id), row.count]));
  const completed = attempts.filter((attempt) => attempt.completedAt);
  const attemptsByGame = attempts.reduce((map, attempt) => {
    map[String(attempt.quizGame?._id || attempt.quizGame)] = attempt;
    return map;
  }, {});
  res.json({
    games: games.map((game) => {
      const attempt = attemptsByGame[String(game._id)];
      const isCompleted = !!attempt?.completedAt || attempt?.status === "completed";
      return {
          _id: game._id,
          title: game.title,
          subject: game.subject,
          numberOfQuestions: game.questions.length,
          timePerQuestion: game.timePerQuestion,
          participants: participantsByGame.get(String(game._id)) || 0,
          status: game.status,
          studentStatus: isCompleted ? "completed" : attempt ? "in_progress" : "not_started",
          completed: isCompleted,
          showLeaderboard: game.showLeaderboard,
          attemptId: attempt?._id,
          maximumPoints: game.questions.length * Number(game.scoring?.correctPoints || 100),
        };
    }),
    stats: {
      bestScore: completed.length ? Math.max(...completed.map((attempt) => attempt.score || 0)) : 0,
      bestAccuracy: completed.length ? Math.max(...completed.map((attempt) => attempt.accuracy || 0)) : 0,
      bestStreak: completed.length ? Math.max(...completed.map((attempt) => attempt.bestStreak || 0)) : 0,
      gamesPlayed: completed.length,
    },
    recentGames: completed.slice(0, 8),
  });
}

async function startGame(req, res) {
  const subjects = await Subject.find({ students: req.user._id }).select("_id");
  const game = await QuizGame.findOne({ _id: req.params.id, subjectRef: { $in: subjects.map((item) => item._id) }, status: "active" }).populate("questions");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const prior = await QuizGameAttempt.findOne({ quizGame: game._id, student: req.user._id });
  if (prior?.completedAt || prior?.status === "completed") {
    return res.status(400).json({ message: "You have already used your attempt for this Quiz Game." });
  }
  if (prior) {
    return res.status(400).json({ message: "You already have an attempt in progress for this Quiz Game." });
  }

  let attempt;
  try {
    attempt = await QuizGameAttempt.create({ quizGame: game._id, student: req.user._id, startedAt: new Date(), status: "in_progress" });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "You have already used your attempt for this Quiz Game." });
    }
    throw error;
  }
  const questions = game.randomizeQuestions ? seededShuffle(game.questions, `${game._id}:${req.user._id}:${attempt._id}:questions`) : game.questions;
  attempt.questionSequence = questions.map((question) => String(question._id));
  await attempt.save();

  res.status(201).json({
    attemptId: attempt._id,
    game: {
      _id: game._id,
      title: game.title,
      instructions: game.instructions,
      timePerQuestion: game.timePerQuestion,
      enablePoints: game.enablePoints,
      enableStreak: game.enableStreak,
      showCorrectAnswer: game.showCorrectAnswer,
      showLeaderboard: game.showLeaderboard,
      scoring: game.scoring,
      questions: questions.map((question) => {
        const choices = game.randomizeChoices ? seededShuffle(question.choices || [], `${attempt._id}:${question._id}:choices`) : question.choices || [];
        const correctChoice = getCorrectChoice(question);
        return {
          _id: question._id,
          questionText: question.questionText,
          choices: choices.map((choice) => ({ _id: choice._id, label: choice.label, value: choice.value })),
          correctAnswer: getCorrectLabel(question),
          correctAnswerValue: correctChoice?.value || "",
        };
      }),
    },
  });
}

async function submitAttempt(req, res) {
  const attempt = await QuizGameAttempt.findOne({ _id: req.params.attemptId, student: req.user._id });
  if (!attempt) return res.status(404).json({ message: "Attempt not found" });
  if (attempt.completedAt) return res.status(400).json({ message: "Attempt already completed." });

  const game = await QuizGame.findById(attempt.quizGame).populate("questions");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const submitted = req.body.answers || [];
  const submittedByQuestion = submitted.reduce((map, answer) => ({ ...map, [String(answer.questionId)]: answer }), {});
  const questionMap = game.questions.reduce((map, question) => ({ ...map, [String(question._id)]: question }), {});
  const sequence = attempt.questionSequence.length ? attempt.questionSequence : game.questions.map((question) => String(question._id));

  let score = 0;
  let correctAnswers = 0;
  let incorrectAnswers = 0;
  let unansweredQuestions = 0;
  let currentStreak = 0;
  let bestStreak = 0;

  attempt.answers = sequence.map((questionId) => {
    const question = questionMap[String(questionId)];
    const submittedAnswer = submittedByQuestion[String(questionId)] || {};
    const selectedChoice = (question.choices || []).find((choice) => String(choice._id) === String(submittedAnswer.selectedChoiceId));
    const selectedAnswer = selectedChoice?.value || submittedAnswer.selectedAnswer || "";
    const correctChoice = getCorrectChoice(question);
    const correctAnswerValue = correctChoice?.value || "";
    const isAnswered = !!selectedAnswer;
    const correctLabel = getCorrectLabel(question);
    const isCorrect = isAnswered && selectedChoice?.label === correctLabel;
    const timeTaken = Math.max(0, Number(submittedAnswer.timeTaken || 0));
    let pointsEarned = 0;

    if (isCorrect) {
      correctAnswers += 1;
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      if (game.enablePoints) {
        pointsEarned += game.scoring.correctPoints || 100;
        if (timeTaken > 0 && timeTaken <= 5) pointsEarned += game.scoring.speedBonusWithin5 || 0;
        else if (timeTaken > 0 && timeTaken <= 10) pointsEarned += game.scoring.speedBonusWithin10 || 0;
        if (game.enableStreak) {
          if (currentStreak === 2) pointsEarned += game.scoring.streakBonus2 || 0;
          if (currentStreak === 3) pointsEarned += game.scoring.streakBonus3 || 0;
          if (currentStreak === 5) pointsEarned += game.scoring.streakBonus5 || 0;
        }
      }
    } else {
      if (isAnswered) incorrectAnswers += 1;
      else unansweredQuestions += 1;
      currentStreak = 0;
    }

    score += pointsEarned;
    return {
      questionId: question._id,
      selectedChoiceId: selectedChoice?._id,
      selectedAnswer,
      correctChoiceId: question.correctChoiceId,
      correctAnswer: correctAnswerValue,
      isCorrect,
      pointsEarned,
      timeTaken,
    };
  });

  attempt.score = score;
  attempt.correctAnswers = correctAnswers;
  attempt.incorrectAnswers = incorrectAnswers;
  attempt.unansweredQuestions = unansweredQuestions;
  attempt.accuracy = sequence.length ? Math.round((correctAnswers / sequence.length) * 100) : 0;
  attempt.bestStreak = bestStreak;
  attempt.completionTime = Math.max(0, Number(req.body.completionTime || 0));
  attempt.status = "completed";
  attempt.completedAt = new Date();
  await attempt.save();
  await recalculateRanks(game._id);
  await notifyStudents([attempt.student], {
    subject: game.subjectRef, quizGame: game._id, type: "quiz_games", action: "results",
    eventKey: `quiz-game:results:${attempt._id}`,
    title: "Quiz game results available",
    message: `Your results for ${game.title} are available.`,
  });
  res.json(await QuizGameAttempt.findById(attempt._id).populate("quizGame", "title subject showLeaderboard"));
}

async function studentResult(req, res) {
  const result = await QuizGameAttempt.findOne({ quizGame: req.params.id, student: req.user._id, completedAt: { $ne: null } })
    .select("-answers -questionSequence").lean();
  if (!result) return res.status(404).json({ message: "Quiz game results not found." });
  const game = await QuizGame.findById(result.quizGame).select("title subject questions showLeaderboard").lean();
  if (!game) return res.status(404).json({ message: "Quiz game not found." });
  res.json({ result, game });
}

async function leaderboard(req, res) {
  if (req.user.role === "teacher") {
    const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id }).select("_id");
    if (!game) return res.status(404).json({ message: "Quiz game not found" });
  }
  const attempts = await QuizGameAttempt.find({ quizGame: req.params.id, completedAt: { $ne: null } })
    .populate("student", "name email avatar")
    .sort({ score: -1, accuracy: -1, completionTime: 1, _id: 1 });
  res.json(attempts.map((attempt, index) => ({
    _id: attempt._id,
    rank: index + 1,
    student: attempt.student,
    score: attempt.score,
    accuracy: attempt.accuracy,
    completionTime: attempt.completionTime,
    isCurrentStudent: String(attempt.student?._id) === String(req.user._id),
  })));
}

async function teacherResults(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id }).populate("questions").populate("subjectRef", "name code");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const attempts = await QuizGameAttempt.find({ quizGame: game._id }).select("-answers -questionSequence").populate("student", "name email").sort({ score: -1, accuracy: -1, completionTime: 1, _id: 1 });
  const completed = attempts.filter((attempt) => attempt.completedAt);
  const inProgress = attempts.filter((attempt) => !attempt.completedAt);
  const stats = gameStats(game, attempts);
  res.json({
    game,
    summary: { ...stats, fastestCompletionTime: Number.isFinite(stats.fastestCompletionTime) ? stats.fastestCompletionTime : 0 },
    results: [
      ...completed.map((attempt, index) => ({ ...attempt.toObject(), status: "completed", rank: index + 1 })),
      ...inProgress.map((attempt) => ({ ...attempt.toObject(), status: "in_progress", rank: null })),
    ],
  });
}

async function teacherLeaderboard(req, res) {
  const game = await QuizGame.findOne({ _id: req.params.id, teacher: req.user._id }).select("title subject");
  if (!game) return res.status(404).json({ message: "Quiz game not found" });
  const attempts = await QuizGameAttempt.find({ quizGame: game._id, completedAt: { $ne: null } })
    .select("student score accuracy completionTime")
    .populate("student", "name email")
    .sort({ score: -1, accuracy: -1, completionTime: 1, _id: 1 });
  res.json({
    game,
    leaderboard: attempts.map((attempt, index) => ({
      _id: attempt._id,
      rank: index + 1,
      student: attempt.student,
      score: attempt.score,
      accuracy: attempt.accuracy,
      completionTime: attempt.completionTime,
    })),
  });
}

async function teacherAttemptDetail(req, res) {
  const attempt = await QuizGameAttempt.findById(req.params.attemptId).populate("student", "name email").populate("quizGame");
  if (!attempt || String(attempt.quizGame.teacher) !== String(req.user._id)) return res.status(404).json({ message: "Attempt not found" });
  const game = await QuizGame.findById(attempt.quizGame._id).populate("questions");
  const questionMap = game.questions.reduce((map, question) => ({ ...map, [String(question._id)]: question }), {});
  res.json({
    attempt,
    questions: attempt.answers.map((answer) => ({
      question: questionMap[String(answer.questionId)]?.questionText || "",
      selectedAnswer: answer.selectedAnswer,
      correctAnswer: answer.correctAnswer,
      isCorrect: answer.isCorrect,
      pointsEarned: answer.pointsEarned,
      timeTaken: answer.timeTaken,
    })),
  });
}

module.exports = {
  studentResult,
  teacherDashboard,
  createGame,
  getGame,
  updateGame,
  deleteGame,
  publishGame,
  setStatus,
  addManualQuestion,
  updateGameQuestion,
  reorderGameQuestions,
  removeGameQuestion,
  studentDashboard,
  startGame,
  submitAttempt,
  leaderboard,
  teacherResults,
  teacherLeaderboard,
  teacherAttemptDetail,
};
