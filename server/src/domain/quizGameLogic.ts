import type { Game, Player, PlayerResult, Question } from '../types';

export const generateRoomCode = (): string => {
  const allowedCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomCode = '';
  for (let index = 0; index < 6; index++) {
    roomCode += allowedCharacters[Math.floor(Math.random() * allowedCharacters.length)]!;
  }
  return roomCode;
}

export const validateQuestionsList = (questions: unknown): { ok: true; questions: Question[] } | { ok: false; error: string } => {
  if (!Array.isArray(questions)) {
    return { ok: false, error: 'Invalid questions' };
  }
  const list = questions as Question[];
  if (list.length === 0) {
    return { ok: false, error: 'Add at least one question' };
  }
  for (const question of list) {
    if (
      !question?.text ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      typeof question.correctIndex !== 'number' ||
      question.correctIndex < 0 ||
      question.correctIndex > 3 ||
      typeof question.timeLimitSec !== 'number' ||
      question.timeLimitSec < 1
    ) {
      return { ok: false, error: 'Invalid question format' };
    }
  }
  return { ok: true, questions: list };
}

export const nonHostPlayers = (game: Game): Player[] => {
  return game.players;
}

export const serializePlayersForClient = (game: Game): Player[] => {
  return game.players.map((player) => ({
    name: player.name,
    index: player.index,
    score: player.score,
  }));
}

export const buildQuestionPayload = (game: Game, questionIndex: number) => {
  const question = game.questions[questionIndex]!;
  return {
    questionNumber: questionIndex + 1,
    totalQuestions: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitSec: question.timeLimitSec,
  };
}


export const computeRoundResults = (game: Game): PlayerResult[] => {
  const currentQuestionIndex = game.currentQuestion;
  if (currentQuestionIndex < 0) return [];

  const question = game.questions[currentQuestionIndex]!;
  const questionStartedAt = game.questionStartTime ?? Date.now();
  const results: PlayerResult[] = [];

  for (const player of game.players) {
    const answerRecord = game.playerAnswers.get(player.index);
    const answered = answerRecord !== undefined;
    const correct = answered && answerRecord.answerIndex === question.correctIndex;
    let pointsEarned = 0;
    if (correct && answerRecord) {
      const elapsedSeconds = Math.min(
        question.timeLimitSec,
        (answerRecord.timestamp - questionStartedAt) / 1000,
      );
      const speedBonus = Math.floor(
        ((question.timeLimitSec - elapsedSeconds) / question.timeLimitSec) * 5,
      );
      pointsEarned = 10 + Math.max(0, speedBonus);
      player.score += pointsEarned;
    }

    results.push({
      name: player.name,
      answered,
      correct,
      pointsEarned,
      totalScore: player.score,
    });
  }

  return results;
}

export const buildFinishedScoreboard = (game: Game): { name: string; score: number; rank: number }[] => {
  const sortedByScore = [...game.players].sort((left, right) => right.score - left.score);
  return sortedByScore.map((player, rankIndex) => ({
    name: player.name,
    score: player.score,
    rank: rankIndex + 1,
  }));
}
