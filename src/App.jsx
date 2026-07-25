import { useMemo, useRef, useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';

const bankQuizzesByPath = import.meta.glob('./bank/**/*.json', {
  eager: true,
  import: 'default',
});

const LOCAL_BANK_KEY = 'quiz-bank-v1';

const parseTimestampFromFileName = (fileName) => {
  const match = fileName.match(/^(\d{14})[_-]/);
  if (!match) return null;

  const stamp = match[1];
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6)) - 1;
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));

  const parsedDate = new Date(year, month, day, hour, minute, second);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const parseIsoDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTimestampForDisplay = (dateValue) => {
  if (!dateValue) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);
};

const buildLabelFromFileName = (fileName) =>
  fileName
    .replace(/\.json$/i, '')
    .replace(/^\d{14}[_-]/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const sortByNewest = (a, b) => {
  const aTime = parseIsoDate(a.createdAt)?.getTime() ?? 0;
  const bTime = parseIsoDate(b.createdAt)?.getTime() ?? 0;
  if (bTime !== aTime) return bTime - aTime;
  return b.fileName.localeCompare(a.fileName);
};

const SEED_BANK_QUIZZES = Object.entries(bankQuizzesByPath)
  .map(([path, data]) => {
    const fileName = path.split('/').pop() || path;
    const timestamp = parseTimestampFromFileName(fileName);
    const label = buildLabelFromFileName(fileName);

    return {
      id: path,
      path,
      fileName,
      label,
      createdAt: timestamp?.toISOString() ?? new Date(0).toISOString(),
      formattedTime: formatTimestampForDisplay(timestamp),
      data,
    };
  })
  .sort(sortByNewest);

const SAMPLE_JSON = JSON.stringify(SEED_BANK_QUIZZES[0]?.data ?? [], null, 2);

const mapLocalRecordToQuiz = (record) => {
  const createdDate = parseIsoDate(record.createdAt);
  return {
    id: record.id,
    path: record.id,
    fileName: record.fileName || `${record.name || 'quiz'}.json`,
    label: record.name || buildLabelFromFileName(record.fileName || 'quiz.json'),
    createdAt: record.createdAt,
    formattedTime: formatTimestampForDisplay(createdDate),
    data: record.quizJson,
  };
};

const loadLocalBank = () => {
  if (typeof window === 'undefined') return SEED_BANK_QUIZZES;

  try {
    const raw = window.localStorage.getItem(LOCAL_BANK_KEY);
    if (!raw) return SEED_BANK_QUIZZES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return SEED_BANK_QUIZZES;

    const mapped = parsed
      .filter((item) => item && Array.isArray(item.quizJson))
      .map(mapLocalRecordToQuiz)
      .sort(sortByNewest);

    return mapped.length > 0 ? mapped : SEED_BANK_QUIZZES;
  } catch {
    return SEED_BANK_QUIZZES;
  }
};

const saveLocalBank = (quizzes) => {
  if (typeof window === 'undefined') return;
  const records = quizzes.map((quiz) => ({
    id: quiz.id,
    name: quiz.label,
    fileName: quiz.fileName,
    createdAt: quiz.createdAt,
    quizJson: quiz.data,
  }));
  window.localStorage.setItem(LOCAL_BANK_KEY, JSON.stringify(records));
};

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
  const [bankQuizzes, setBankQuizzes] = useState(SEED_BANK_QUIZZES);
  const [storageMode, setStorageMode] = useState(supabase ? 'cloud' : 'local');
  const [bankNotice, setBankNotice] = useState('');
  const [isBankBusy, setIsBankBusy] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeSource, setActiveSource] = useState('');
  const [isBankOpen, setIsBankOpen] = useState(false);
  const importFileRef = useRef(null);

  useEffect(() => {
    const hydrateBank = async () => {
      if (!supabase) {
        const localQuizzes = loadLocalBank();
        setBankQuizzes(localQuizzes);
        setStorageMode('local');
        return;
      }

      setIsBankBusy(true);
      const { data, error: fetchError } = await supabase
        .from('quiz_banks')
        .select('id, name, quiz_json, created_at')
        .order('created_at', { ascending: false });

      if (fetchError) {
        const localQuizzes = loadLocalBank();
        setBankQuizzes(localQuizzes);
        setStorageMode('local');
        setBankNotice('Supabase unavailable. Using local browser storage.');
        setIsBankBusy(false);
        return;
      }

      const cloudQuizzes = (data || []).map((item) => {
        const createdDate = parseIsoDate(item.created_at);
        const fileName = `${item.name || 'quiz'}.json`;
        return {
          id: item.id,
          path: item.id,
          fileName,
          label: item.name || buildLabelFromFileName(fileName),
          createdAt: item.created_at,
          formattedTime: formatTimestampForDisplay(createdDate),
          data: item.quiz_json,
        };
      });

      setBankQuizzes(cloudQuizzes);
      setStorageMode('cloud');
      setBankNotice('');
      setIsBankBusy(false);
    };

    hydrateBank();
  }, []);

  const resetEditorToLatest = () => {
    const latest = bankQuizzes[0]?.data ?? [];
    setInputText(JSON.stringify(latest, null, 2));
  };

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

  const setAnswer = (questionIndex, optionIndex) => {
    setAnswers((previous) => ({
      ...previous,
      [questionIndex]: optionIndex,
    }));
  };

  const loadBankQuiz = (quiz) => {
    const quizText = JSON.stringify(quiz.data, null, 2);
    setInputText(quizText);
    setActiveSource(quiz.id);
    parseInputText(quizText);
    setIsBankOpen(false);
  };

  const saveQuizToBank = async (quizData, proposedName) => {
    const fallbackStamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);

    const sanitized = (proposedName || `quiz_${fallbackStamp}`)
      .toLowerCase()
      .replace(/\.json$/i, '')
      .replace(/[^a-z0-9_\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '_');

    const label = sanitized || `quiz_${fallbackStamp}`;
    const createdAt = new Date().toISOString();

    setIsBankBusy(true);
    if (supabase && storageMode === 'cloud') {
      const { data, error: insertError } = await supabase
        .from('quiz_banks')
        .insert({
          name: label,
          quiz_json: quizData,
        })
        .select('id, name, quiz_json, created_at')
        .single();

      if (insertError) {
        setBankNotice(insertError.message);
        setIsBankBusy(false);
        return false;
      }

      const createdDate = parseIsoDate(data.created_at);
      const newQuiz = {
        id: data.id,
        path: data.id,
        fileName: `${data.name}.json`,
        label: data.name,
        createdAt: data.created_at,
        formattedTime: formatTimestampForDisplay(createdDate),
        data: data.quiz_json,
      };

      setBankQuizzes((previous) => [newQuiz, ...previous].sort(sortByNewest));
      setBankNotice('Saved to Supabase.');
      setIsBankBusy(false);
      return true;
    }

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const localQuiz = {
      id,
      path: id,
      fileName: `${label}.json`,
      label,
      createdAt,
      formattedTime: formatTimestampForDisplay(parseIsoDate(createdAt)),
      data: quizData,
    };

    setBankQuizzes((previous) => {
      const next = [localQuiz, ...previous].sort(sortByNewest);
      saveLocalBank(next);
      return next;
    });

    setBankNotice('Saved to local browser storage.');
    setIsBankBusy(false);
    return true;
  };

  const addCurrentJsonToBank = async () => {
    let quizData;
    try {
      parseQuestions(inputText);
      quizData = JSON.parse(inputText);
    } catch {
      setBankNotice('Current JSON is invalid. Fix it before saving.');
      return;
    }

    const suggestedName = window.prompt('Enter quiz name (topic_subtopic)', 'quiz_topic');
    if (suggestedName === null) return;

    await saveQuizToBank(quizData, suggestedName);
  };

  const importJsonFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const rawText = await file.text();
    let quizData;

    try {
      parseQuestions(rawText);
      quizData = JSON.parse(rawText);
    } catch {
      setBankNotice('Imported file has invalid quiz JSON format.');
      event.target.value = '';
      return;
    }

    await saveQuizToBank(quizData, file.name.replace(/\.json$/i, ''));
    event.target.value = '';
  };

  const deleteBankQuiz = async (quiz) => {
    const shouldDelete = window.confirm(`Delete quiz \"${quiz.label}\"?`);
    if (!shouldDelete) return;

    setIsBankBusy(true);
    if (supabase && storageMode === 'cloud') {
      const { error: deleteError } = await supabase.from('quiz_banks').delete().eq('id', quiz.id);
      if (deleteError) {
        setBankNotice(deleteError.message);
        setIsBankBusy(false);
        return;
      }
    }

    setBankQuizzes((previous) => {
      const next = previous.filter((item) => item.id !== quiz.id);
      if (storageMode === 'local') saveLocalBank(next);
      return next;
    });

    if (activeSource === quiz.id) {
      setActiveSource('');
    }

    setBankNotice(storageMode === 'cloud' ? 'Deleted from Supabase.' : 'Deleted locally.');
    setIsBankBusy(false);
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
            Mode: <strong>{storageMode === 'cloud' ? 'Supabase Cloud' : 'Local Browser'}</strong>
          </p>

          <div className="bank-actions">
            <button className="bank-action" onClick={addCurrentJsonToBank} disabled={isBankBusy}>
              Save Current JSON
            </button>
            <button
              className="bank-action ghost"
              onClick={() => importFileRef.current?.click()}
              disabled={isBankBusy}
            >
              Import JSON File
            </button>
            <input
              ref={importFileRef}
              className="bank-file-input"
              type="file"
              accept=".json,application/json"
              onChange={importJsonFile}
            />
          </div>

          {bankNotice && <p className="bank-notice">{bankNotice}</p>}

          <div className="bank-list" role="list" aria-label="JSON bank files">
            {bankQuizzes.map((quiz) => (
              <div
                key={quiz.id}
                className={`bank-row ${activeSource === quiz.id ? 'active' : ''}`}
              >
                <button className="bank-item" onClick={() => loadBankQuiz(quiz)}>
                  <span className="bank-item-title">{quiz.label}</span>
                  {quiz.formattedTime && (
                    <span className="bank-item-time">{quiz.formattedTime}</span>
                  )}
                </button>
                <button
                  className="bank-delete"
                  onClick={() => deleteBankQuiz(quiz)}
                  disabled={isBankBusy}
                  aria-label={`Delete ${quiz.label}`}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {bankQuizzes.length === 0 && (
            <p className="sidebar-empty">No quizzes yet. Save current JSON or import one.</p>
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
                <button className="ghost" onClick={resetEditorToLatest}>
                  Reset Editor to Latest
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
