import { useMemo, useState } from 'react';
import sampleJavaMcqs from './bank/sampleJavaMcqs.json';

const SAMPLE_JSON = JSON.stringify(sampleJavaMcqs, null, 2);
const bankQuizzesByPath = import.meta.glob('./bank/**/*.json', {
  eager: true,
  import: 'default',
});

const BANK_QUIZZES = Object.entries(bankQuizzesByPath)
  .map(([path, data]) => {
    const fileName = path.split('/').pop() || path;
    const label = fileName
      .replace(/\.json$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    return {
      path,
      fileName,
      label,
      data,
    };
  })
  .sort((a, b) => a.fileName.localeCompare(b.fileName));

const parseQuestions = (rawInput) => {
  const parsed = JSON.parse(rawInput);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Input must be a non-empty JSON array.');
  }

  const rawAnswers = parsed.map((item) => item.answer);
  const hasZeroBasedSignal = rawAnswers.some((value) => value === 0);

  // Ambiguous values (1..3) are interpreted as 1-based unless at least one
  // explicit 0 appears, which signals the quiz is using 0-based indexing.
  const normalizeByQuizFormat = (value) => {
    if (!Number.isInteger(value)) return -1;
    if (hasZeroBasedSignal) {
      return value >= 0 && value <= 3 ? value : -1;
    }
    return value >= 1 && value <= 4 ? value - 1 : -1;
  };

  return parsed.map((item, index) => {
    const optionError = !Array.isArray(item.options) || item.options.length !== 4;
    const answerIndex = normalizeByQuizFormat(item.answer);

    if (
      typeof item.question !== 'string' ||
      optionError ||
      answerIndex < 0 ||
      typeof item.explanation !== 'string'
    ) {
      throw new Error(`Invalid question format at item ${index + 1}.`);
    }

    return {
      ...item,
      answer: answerIndex,
    };
  });
};

function App() {
  const [inputText, setInputText] = useState(SAMPLE_JSON);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeSource, setActiveSource] = useState('');
  const [isBankOpen, setIsBankOpen] = useState(false);

  const parseInputText = (rawText) => {
    try {
      const parsedQuestions = parseQuestions(rawText);
      setQuestions(parsedQuestions);
      setAnswers({});
      setQuizSubmitted(false);
      setError('');
    } catch (parseError) {
      setQuestions([]);
      setAnswers({});
      setQuizSubmitted(false);
      setError(parseError.message || 'Unable to parse input JSON.');
    }
  };

  const parseInput = () => {
    parseInputText(inputText);
  };

  const loadBankQuiz = (quiz) => {
    const quizText = JSON.stringify(quiz.data, null, 2);
    setInputText(quizText);
    setActiveSource(quiz.path);
    parseInputText(quizText);
    setIsBankOpen(false);
  };

  const scoreData = useMemo(() => {
    if (questions.length === 0) {
      return {
        total: 0,
        attempted: 0,
        correct: 0,
        wrong: 0,
        unattempted: 0,
        percentage: 0,
        wrongItems: [],
      };
    }

    let correct = 0;
    let attempted = 0;

    const wrongItems = questions
      .map((question, questionIndex) => {
        const selected = answers[questionIndex];
        const hasAnswered = Number.isInteger(selected);

        if (hasAnswered) attempted += 1;
        if (hasAnswered && selected === question.answer) {
          correct += 1;
          return null;
        }

        if (!hasAnswered) return null;

        return {
          questionIndex,
          question,
          selected,
        };
      })
      .filter(Boolean);

    const total = questions.length;
    const wrong = attempted - correct;
    const unattempted = total - attempted;
    const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);

    return {
      total,
      attempted,
      correct,
      wrong,
      unattempted,
      percentage,
      wrongItems,
    };
  }, [answers, questions]);

  return (
    <div className="page-shell">
      <div className="app-layout">
        {isBankOpen && (
          <button
            className="bank-backdrop"
            onClick={() => setIsBankOpen(false)}
            aria-label="Close question bank"
          />
        )}

        <aside className={`card bank-sidebar ${isBankOpen ? 'open' : ''}`}>
          <div className="bank-sidebar-head">
            <p className="eyebrow">Question Bank</p>
            <button className="bank-close" onClick={() => setIsBankOpen(false)}>
              Close
            </button>
          </div>
          <h2>Load Quiz JSON</h2>
          <p className="sidebar-note">
            Drop files in <strong>src/bank</strong>. They appear here automatically.
          </p>

          <div className="bank-list" role="list" aria-label="JSON bank files">
            {BANK_QUIZZES.map((quiz) => (
              <button
                key={quiz.path}
                className={`bank-item ${activeSource === quiz.path ? 'active' : ''}`}
                onClick={() => loadBankQuiz(quiz)}
              >
                {quiz.label}
              </button>
            ))}
          </div>

          {BANK_QUIZZES.length === 0 && (
            <p className="sidebar-empty">No files yet. Add .json files inside src/bank.</p>
          )}
        </aside>

        <div className="content-pane">
          <header className="hero">
            <div className="hero-top">
              <p className="eyebrow">JSON-powered learning workflow</p>
              <button className="bank-toggle" onClick={() => setIsBankOpen(true)}>
                Open Question Bank
              </button>
            </div>
            <h1>React Quiz Application</h1>
            <p>
              Paste MCQs as JSON, parse instantly, answer all questions, and get score,
              wrong-answer review, and live statistics.
            </p>
          </header>

          <main className="grid-layout">
            <section className="card input-card">
              <h2>1) Paste JSON</h2>
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                spellCheck={false}
                aria-label="Quiz JSON input"
              />
              <div className="actions-row">
                <button onClick={parseInput}>Parse</button>
                <button className="ghost" onClick={() => setInputText(SAMPLE_JSON)}>
                  Reset Editor to Sample
                </button>
              </div>
              {error && <p className="error-text">{error}</p>}
              {questions.length > 0 && (
                <p className="hint-text">
                  Parsed {questions.length} questions. Answers accept index format 0-3 or
                  1-4.
                </p>
              )}
            </section>

            <section className="card stats-card">
              <h2>2) Statistics</h2>
              <div className="stats-grid">
                <Stat label="Total" value={scoreData.total} />
                <Stat label="Attempted" value={scoreData.attempted} />
                <Stat label="Correct" value={scoreData.correct} />
                <Stat label="Wrong" value={scoreData.wrong} />
                <Stat label="Unattempted" value={scoreData.unattempted} />
                <Stat label="Score" value={`${scoreData.percentage}%`} />
              </div>
            </section>
          </main>

          {questions.length > 0 && (
            <section className="card quiz-card">
              <div className="quiz-headline">
                <h2>3) Display Questions and Select Answers</h2>
                <button
                  onClick={() => setQuizSubmitted(true)}
                  disabled={quizSubmitted}
                  className={quizSubmitted ? 'disabled' : ''}
                >
                  {quizSubmitted ? 'Submitted' : 'Submit Quiz'}
                </button>
              </div>

              <div className="question-list">
                {questions.map((question, questionIndex) => (
                  <article key={questionIndex} className="question-item">
                    <p className="question-title">
                      {questionIndex + 1}. {question.question}
                    </p>
                    <div className="options-grid">
                      {question.options.map((option, optionIndex) => {
                        const isSelected = answers[questionIndex] === optionIndex;
                        const isCorrect = quizSubmitted && question.answer === optionIndex;
                        const isWrong =
                          quizSubmitted && isSelected && optionIndex !== question.answer;

                        return (
                          <label
                            key={optionIndex}
                            className={`option-chip ${isSelected ? 'selected' : ''} ${
                              isCorrect ? 'correct' : ''
                            } ${isWrong ? 'wrong' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`q-${questionIndex}`}
                              checked={isSelected}
                              onChange={() => setAnswer(questionIndex, optionIndex)}
                              disabled={quizSubmitted}
                            />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                    {quizSubmitted && (
                      <p className="explanation">
                        <strong>Explanation:</strong> {question.explanation}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {quizSubmitted && scoreData.wrongItems.length > 0 && (
            <section className="card review-card">
              <h2>4) Review Wrong Answers</h2>
              {scoreData.wrongItems.map(({ questionIndex, question, selected }) => (
                <article key={questionIndex} className="review-item">
                  <p>
                    <strong>Q{questionIndex + 1}:</strong> {question.question}
                  </p>
                  <p>
                    <strong>Your answer:</strong> {question.options[selected]}
                  </p>
                  <p>
                    <strong>Correct answer:</strong> {question.options[question.answer]}
                  </p>
                  <p>
                    <strong>Why:</strong> {question.explanation}
                  </p>
                </article>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
