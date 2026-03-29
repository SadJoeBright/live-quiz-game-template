import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { Login } from './components/Login';
import { RoleSelection } from './components/RoleSelection';
import { CreateGame } from './components/CreateGame';
import { JoinGame } from './components/JoinGame';
import { Lobby } from './components/Lobby';
import { GamePlay } from './components/GamePlay';
import { QuestionResult } from './components/QuestionResult';
import { FinalResults } from './components/FinalResults';
import type {
  Question,
  Player,
  QuestionMessage,
  QuestionResultMessage,
  GameFinishedMessage,
} from './types';

type Screen =
  | 'login'
  | 'role-selection'
  | 'create-game'
  | 'join-game'
  | 'lobby'
  | 'game-play'
  | 'question-result'
  | 'final-results';

const WS_URL = 'ws://localhost:3000';

function App() {
  const { isConnected, lastMessage, sendMessage } = useWebSocket(WS_URL);

  const [screen, setScreen] = useState<Screen>('login');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [gameId, setGameId] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState('');

  // Game state
  const [currentQuestion, setCurrentQuestion] = useState<QuestionMessage | null>(null);
  const [questionResult, setQuestionResult] = useState<QuestionResultMessage | null>(null);
  const [finalResults, setFinalResults] = useState<GameFinishedMessage | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const { type, data } = lastMessage;
    console.log('Handling message:', type, data);

    switch (type) {
      case 'reg':
        if (data.error) {
          setError(data.errorText || 'Registration failed');
        } else {
          setPlayerName(data.name);
          setScreen('role-selection');
          setError('');
        }
        break;

      case 'game_created':
        setGameId(data.gameId);
        setGameCode(data.code);
        setIsHost(true);
        setScreen('lobby');
        setError('');
        break;

      case 'game_joined':
        setGameId(data.gameId);
        setScreen('lobby');
        setError('');
        break;

      case 'player_joined':
        // { playerName, playerCount } — informational broadcast
        break;

      case 'update_players':
        // data is Player[] directly
        setPlayers(Array.isArray(data) ? data : []);
        break;

      case 'answer_accepted':
        // confirmation from server — we already set hasAnswered optimistically
        break;

      case 'question':
        setCurrentQuestion(data as QuestionMessage);
        setQuestionResult(null);
        setHasAnswered(false);
        setScreen('game-play');
        break;

      case 'question_result':
        setQuestionResult(data as QuestionResultMessage);
        setScreen('question-result');
        break;

      case 'game_finished':
        setFinalResults(data as GameFinishedMessage);
        setScreen('final-results');
        break;

      case 'error':
        setError(data.message || 'Unknown error');
        break;

      default:
        console.log('Unhandled message type:', type);
    }
  }, [lastMessage]);

  // Handlers
  const handleLogin = (name: string, password: string) => {
    setPlayerName(name);
    sendMessage('reg', { name, password });
  };

  const handleSelectHost = () => {
    setScreen('create-game');
  };

  const handleSelectPlayer = () => {
    setScreen('join-game');
  };

  const handleCreateGame = (questions: Question[]) => {
    sendMessage('create_game', { questions });
  };

  const handleJoinGame = (code: string) => {
    setGameCode(code);
    sendMessage('join_game', { code });
  };

  const handleStartGame = () => {
    sendMessage('start_game', { gameId });
  };

  const handleAnswer = (answerIndex: number) => {
    if (currentQuestion && !hasAnswered) {
      sendMessage('answer', {
        gameId,
        questionIndex: currentQuestion.questionNumber - 1,
        answerIndex,
      });
      setHasAnswered(true);
    }
  };

  const handlePlayAgain = () => {
    setScreen('role-selection');
    setGameId('');
    setGameCode('');
    setPlayers([]);
    setCurrentQuestion(null);
    setQuestionResult(null);
    setFinalResults(null);
    setIsHost(false);
  };

  const handleBack = () => {
    setScreen('role-selection');
    setError('');
  };

  // Connection status
  if (!isConnected) {
    return (
      <div style={styles.loading}>
        <h1>Connecting to server...</h1>
        <p>Please make sure the WebSocket server is running on {WS_URL}</p>
      </div>
    );
  }

  // Error display
  const errorDisplay = error && (
    <div style={styles.error}>
      <p>{error}</p>
      <button onClick={() => setError('')} style={styles.closeError}>
        Close
      </button>
    </div>
  );

  // Render current screen
  return (
    <>
      {errorDisplay}
      {screen === 'login' && <Login onLogin={handleLogin} />}
      {screen === 'role-selection' && (
        <RoleSelection
          playerName={playerName}
          onSelectHost={handleSelectHost}
          onSelectPlayer={handleSelectPlayer}
        />
      )}
      {screen === 'create-game' && (
        <CreateGame onCreateGame={handleCreateGame} onBack={handleBack} />
      )}
      {screen === 'join-game' && <JoinGame onJoinGame={handleJoinGame} onBack={handleBack} />}
      {screen === 'lobby' && (
        <Lobby
          gameCode={gameCode}
          players={players}
          isHost={isHost}
          onStartGame={handleStartGame}
        />
      )}
      {screen === 'game-play' && currentQuestion && (
        <GamePlay
          questionNumber={currentQuestion.questionNumber}
          text={currentQuestion.text}
          options={currentQuestion.options}
          timeLimitSec={currentQuestion.timeLimitSec}
          totalQuestions={currentQuestion.totalQuestions}
          onAnswer={handleAnswer}
          isHost={isHost}
          hasAnswered={hasAnswered}
        />
      )}
      {screen === 'question-result' && questionResult && currentQuestion && (
        <QuestionResult
          questionIndex={questionResult.questionIndex}
          correctIndex={questionResult.correctIndex}
          playerResults={questionResult.playerResults}
          options={currentQuestion.options}
        />
      )}
      {screen === 'final-results' && finalResults && (
        <FinalResults scoreboard={finalResults.scoreboard} onPlayAgain={handlePlayAgain} />
      )}
    </>
  );
}

const styles = {
  loading: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '20px',
    textAlign: 'center' as const,
  },
  error: {
    position: 'fixed' as const,
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '1rem 2rem',
    borderRadius: '8px',
    border: '1px solid #f5c6cb',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    maxWidth: '90%',
  },
  closeError: {
    padding: '4px 12px',
    backgroundColor: '#721c24',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default App;
