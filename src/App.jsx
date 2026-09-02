import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { supabase } from './lib/supabaseClient';

const normalizeSiteName = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'Saved website';
  }
};

const mapSupabaseSite = (item) => ({
  id: item.id,
  title: item.title || normalizeSiteName(item.url),
  url: item.url,
  topic: item.topic || 'General',
  snapshotHtml: item.snapshot_html,
  snapshotCreatedAt: item.snapshot_created_at,
  annotations: Array.isArray(item.annotations) ? item.annotations : [],
  createdAt: item.created_at,
});

function App() {
  const [websiteTitleInput, setWebsiteTitleInput] = useState('');
  const [websiteUrlInput, setWebsiteUrlInput] = useState('');
  const [cachedWebsites, setCachedWebsites] = useState([]);
  const [activeSiteId, setActiveSiteId] = useState('');
  const [websiteNotice, setWebsiteNotice] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [penEnabled, setPenEnabled] = useState(false);
  const [penMode, setPenMode] = useState('underline');
  const [penColor, setPenColor] = useState('#ef4444');
  const [penSize, setPenSize] = useState(4);
  const [snapshotHeight, setSnapshotHeight] = useState(720);
  const [draftAnnotations, setDraftAnnotations] = useState([]);
  const [textInput, setTextInput] = useState(null);
  const [laserStroke, setLaserStroke] = useState(null);
  const [laserOpacity, setLaserOpacity] = useState(0);
  const annotationCanvasRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const drawFrameRef = useRef(null);
  const pendingAnnotationsRef = useRef([]);
  const textDragRef = useRef(null);
  const laserFadeFrameRef = useRef(null);
  const snapshotViewerRef = useRef(null);

  const activeSite = cachedWebsites.find((site) => site.id === activeSiteId) ?? null;
  const hasUnsavedAnnotationChanges =
    JSON.stringify(draftAnnotations) !== JSON.stringify(activeSite?.annotations ?? []);

  // Filter websites by search and topic
  const filteredWebsites = cachedWebsites.filter((site) => {
    const matchesSearch =
      site.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      site.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTopic = !selectedTopic || site.topic === selectedTopic;
    return matchesSearch && matchesTopic;
  });

  // Sort by most recent first
  const sortedWebsites = [...filteredWebsites].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  useEffect(() => {
    const loadSites = async () => {
      setIsBusy(true);

      if (!supabase) {
        setCachedWebsites([]);
        setActiveSiteId('');
        setWebsiteNotice('Supabase is not configured. Saved websites are unavailable.');
        setIsBusy(false);
        return;
      }

      const { data, error } = await supabase
        .from('saved_websites')
        .select('id, title, url, topic, snapshot_html, snapshot_created_at, annotations, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        setCachedWebsites([]);
        setActiveSiteId('');
        setWebsiteError(`Unable to load saved websites: ${error.message}`);
        setIsBusy(false);
        return;
      }

      const remoteSites = (data || []).map(mapSupabaseSite);
      setCachedWebsites(remoteSites);
      setActiveSiteId('');
      setWebsiteNotice('');
      setIsBusy(false);
    };

    loadSites();
  }, []);

  const handleSaveWebsite = async () => {
    const trimmedTitle = websiteTitleInput.trim();
    const trimmedUrl = websiteUrlInput.trim();

    if (!trimmedTitle) {
      setWebsiteError('Please enter an article title first.');
      setWebsiteNotice('');
      return;
    }

    if (!trimmedUrl) {
      setWebsiteError('Please enter a website URL first.');
      setWebsiteNotice('');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      setWebsiteError('Please enter a valid URL, such as https://example.com');
      setWebsiteNotice('');
      return;
    }

    const normalizedUrl = parsedUrl.href;
    const title = trimmedTitle;
    const topic = selectedTopic || 'General';

    if (cachedWebsites.some((site) => site.url.toLowerCase() === normalizedUrl.toLowerCase())) {
      setWebsiteError('This website is already saved.');
      setWebsiteNotice('');
      return;
    }

    setIsBusy(true);
    setWebsiteError('');

    if (supabase) {
      const { data, error } = await supabase
        .from('saved_websites')
        .insert({ title, url: normalizedUrl, topic })
        .select('id, title, url, topic, snapshot_html, snapshot_created_at, annotations, created_at')
        .single();

      if (error) {
        setWebsiteError(`Unable to save website: ${error.message}`);
        setIsBusy(false);
        return;
      }

      let savedSite = mapSupabaseSite(data);
      const { data: snapshotData, error: snapshotError } = await supabase.functions.invoke(
        'capture-website',
        {
          body: { websiteId: savedSite.id, url: savedSite.url },
        },
      );

      if (snapshotError || !snapshotData?.website) {
        setWebsiteNotice(
          'Website saved, but its content snapshot could not be created. Deploy capture-website in Supabase.',
        );
      } else {
        savedSite = { ...savedSite, ...snapshotData.website };
      }
      setCachedWebsites((previous) => [savedSite, ...previous]);
      setActiveSiteId(savedSite.id);
      if (!snapshotError && snapshotData?.website) {
        setWebsiteNotice('Website and its current content were saved to Supabase.');
      }
      setWebsiteUrlInput('');
      setWebsiteTitleInput('');
      setIsBusy(false);
      return;
    }

    setWebsiteError('Supabase is not configured. The website was not saved.');
    setIsBusy(false);
  };

  const refreshSnapshot = async (site) => {
    if (!supabase) {
      setWebsiteError('Supabase is not configured.');
      return;
    }

    setIsBusy(true);
    setWebsiteError('');
    const { data, error } = await supabase.functions.invoke('capture-website', {
      body: { websiteId: site.id, url: site.url },
    });

    if (error || !data?.website) {
      setWebsiteError('Unable to refresh the snapshot. Check that capture-website is deployed.');
      setIsBusy(false);
      return;
    }

    const updatedSite = { ...site, ...data.website };
    setCachedWebsites((previous) =>
      previous.map((cachedSite) => (cachedSite.id === site.id ? updatedSite : cachedSite)),
    );
    setWebsiteNotice('Website snapshot refreshed.');
    setIsBusy(false);
  };

  const drawAnnotations = (annotations, temporaryLaser = null, temporaryLaserOpacity = 0) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const toCanvasPoint = (point, stroke) =>
      stroke.coordinateSpace === 'relative'
        ? { x: point.x * width, y: point.y * height }
        : point;

    const drawStroke = (stroke, isLaser = false) => {
      if (stroke.mode === 'text') {
        if (!stroke.text || !stroke.points?.[0]) return;
        const point = toCanvasPoint(stroke.points[0], stroke);
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = stroke.color;
        context.font = `${Math.max(stroke.size * 4, 14)}px Segoe UI, sans-serif`;
        context.fillText(stroke.text, point.x, point.y);
        return;
      }
      if (!stroke.points || stroke.points.length < 2) return;
      const points = stroke.points.map((point) => toCanvasPoint(point, stroke));
      context.beginPath();
      context.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.size;
      if (isLaser) {
        context.globalAlpha = temporaryLaserOpacity;
        context.shadowColor = stroke.color;
        context.shadowBlur = 12;
      }
      context.moveTo(points[0].x, points[0].y);
      if (stroke.mode === 'underline') {
        const endPoint = points[points.length - 1];
        context.lineTo(endPoint.x, endPoint.y);
      } else {
        for (let index = 1; index < points.length - 1; index += 1) {
          const point = points[index];
          const nextPoint = points[index + 1];
          context.quadraticCurveTo(
            point.x,
            point.y,
            (point.x + nextPoint.x) / 2,
            (point.y + nextPoint.y) / 2,
          );
        }
        const lastPoint = points[points.length - 1];
        context.lineTo(lastPoint.x, lastPoint.y);
      }
      context.stroke();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    annotations.forEach((stroke) => drawStroke(stroke));
    if (temporaryLaser) drawStroke(temporaryLaser, true);
    context.globalCompositeOperation = 'source-over';
  };

  const scheduleAnnotationDraw = (annotations) => {
    pendingAnnotationsRef.current = annotations;
    if (drawFrameRef.current) return;

    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawAnnotations(pendingAnnotationsRef.current);
      drawFrameRef.current = null;
    });
  };

  useEffect(() => {
    setDraftAnnotations(activeSite?.annotations ?? []);
  }, [activeSiteId]);

  useEffect(() => {
    if (activeSite?.snapshotHtml) drawAnnotations(draftAnnotations, laserStroke, laserOpacity);
  }, [activeSite?.snapshotHtml, draftAnnotations, laserOpacity, laserStroke, snapshotHeight]);

  useEffect(() => {
    const viewer = snapshotViewerRef.current;
    if (!viewer || !activeSite?.snapshotHtml) return undefined;
    const observer = new ResizeObserver(() => {
      drawAnnotations(draftAnnotations, laserStroke, laserOpacity);
    });
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [activeSite?.snapshotHtml, draftAnnotations, laserOpacity, laserStroke]);

  useEffect(
    () => () => {
      if (laserFadeFrameRef.current) window.cancelAnimationFrame(laserFadeFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const undoLastStroke = (event) => {
      if (
        !penEnabled ||
        !activeSite?.snapshotHtml ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'z'
      ) {
        return;
      }

      event.preventDefault();
      setDraftAnnotations((previous) => previous.slice(0, -1));
    };

    window.addEventListener('keydown', undoLastStroke);
    return () => window.removeEventListener('keydown', undoLastStroke);
  }, [activeSite?.snapshotHtml, penEnabled]);

  const getCanvasPoint = (event) => {
    const bounds = annotationCanvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };

  const getDisplayPoint = (point) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return point;
    return { x: point.x * canvas.clientWidth, y: point.y * canvas.clientHeight };
  };

  const startAnnotation = (event) => {
    if (!penEnabled || !activeSite?.snapshotHtml) return;
    event.preventDefault();
    if (penMode === 'text') {
      const point = getCanvasPoint(event.nativeEvent);
      setTextInput({ ...point, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (penMode === 'laser' && laserFadeFrameRef.current) {
      window.cancelAnimationFrame(laserFadeFrameRef.current);
      laserFadeFrameRef.current = null;
    }
    currentStrokeRef.current = {
      mode: penMode,
      color: penColor,
      size: penMode === 'erase' ? Math.max(penSize * 3, 14) : penMode === 'laser' ? Math.max(penSize, 3) : penSize,
      coordinateSpace: 'relative',
      points: [getCanvasPoint(event)],
    };
    if (penMode === 'laser') {
      setLaserOpacity(1);
      setLaserStroke({ ...currentStrokeRef.current, points: [...currentStrokeRef.current.points] });
    }
  };

  const extendAnnotation = (event) => {
    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    if (stroke.mode === 'underline') {
      const pointerEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
      const point = getCanvasPoint(pointerEvents[pointerEvents.length - 1]);
      stroke.points[1] = { x: point.x, y: stroke.points[0].y };
      scheduleAnnotationDraw([...draftAnnotations, stroke]);
      return;
    }
    const pointerEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    pointerEvents.forEach((pointerEvent) => stroke.points.push(getCanvasPoint(pointerEvent)));
    if (stroke.mode === 'laser') {
      setLaserStroke({ ...stroke, points: [...stroke.points] });
      return;
    }
    scheduleAnnotationDraw([...draftAnnotations, stroke]);
  };

  const finishAnnotation = () => {
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (!stroke || stroke.points.length < 2) return;
    if (stroke.mode === 'laser') {
      const fadeStart = performance.now();
      const fadeLaser = (now) => {
        const opacity = Math.max(0, 1 - (now - fadeStart) / 900);
        setLaserOpacity(opacity);
        if (opacity > 0) {
          laserFadeFrameRef.current = window.requestAnimationFrame(fadeLaser);
        } else {
          setLaserStroke(null);
          laserFadeFrameRef.current = null;
        }
      };
      laserFadeFrameRef.current = window.requestAnimationFrame(fadeLaser);
      return;
    }
    setDraftAnnotations((previous) => [...previous, stroke]);
  };

  const finishTextAnnotation = () => {
    if (!textInput) return;
    const text = textInput.value.trim();
    if (text) {
      setDraftAnnotations((previous) => [
        ...previous,
        {
          mode: 'text',
          color: penColor,
          size: penSize,
          coordinateSpace: 'relative',
          points: [{ x: textInput.x, y: textInput.y }],
          text,
        },
      ]);
    }
    setTextInput(null);
  };

  const startTextDrag = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    textDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      textX: textInput.x,
      textY: textInput.y,
    };
  };

  const moveTextDrag = (event) => {
    const drag = textDragRef.current;
    if (!drag) return;
    setTextInput((previous) => ({
      ...previous,
      x: drag.textX + (event.clientX - drag.startX) / annotationCanvasRef.current.clientWidth,
      y: drag.textY + (event.clientY - drag.startY) / annotationCanvasRef.current.clientHeight,
    }));
  };

  const finishTextDrag = () => {
    textDragRef.current = null;
  };

  const saveAnnotations = async () => {
    if (!activeSite || !supabase) return;
    setIsBusy(true);
    const { error } = await supabase
      .from('saved_websites')
      .update({ annotations: draftAnnotations })
      .eq('id', activeSite.id);

    if (error) {
      setWebsiteError(`Unable to save pen marks: ${error.message}`);
      setIsBusy(false);
      return;
    }

    setCachedWebsites((previous) =>
      previous.map((site) =>
        site.id === activeSite.id ? { ...site, annotations: draftAnnotations } : site,
      ),
    );
    setWebsiteNotice('Pen marks saved to Supabase.');
    setIsBusy(false);
  };

  const clearAnnotations = () => setDraftAnnotations([]);

  const addTopic = () => {
    const newTopic = window.prompt('Enter topic name:');
    if (!newTopic) return;
    if (topics.includes(newTopic)) {
      alert('Topic already exists.');
      return;
    }
    const updated = [...topics, newTopic];
    setTopics(updated);
  };

  const removeTopic = (topic) => {
    const updated = topics.filter((t) => t !== topic);
    setTopics(updated);
    if (selectedTopic === topic) {
      setSelectedTopic('');
    }
  };

  const removeCachedWebsite = async (siteId) => {
    const site = cachedWebsites.find((item) => item.id === siteId);
    if (!site) return;

    if (!window.confirm(`Delete "${site.title}"? This also removes its saved snapshot and marks.`)) {
      return;
    }

    setIsBusy(true);

    if (supabase) {
      const { error } = await supabase.from('saved_websites').delete().eq('id', siteId);
      if (error) {
        setWebsiteError(error.message);
        setIsBusy(false);
        return;
      }
    }

    setCachedWebsites((previous) => {
      const next = previous.filter((item) => item.id !== siteId);
      if (activeSiteId === siteId) {
        setActiveSiteId(next[0]?.id ?? '');
      }
      return next;
    });

    setWebsiteError('');
    setWebsiteNotice('Saved website removed from Supabase.');
    setIsBusy(false);
  };

  const formatDate = (isoDate) => {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  return (
    <div className="app-wrapper">
      {/* Modal overlay for site preview */}
      {activeSite && (
        <div className="modal-overlay" onClick={() => setActiveSiteId('')}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{activeSite.title}</h2>
              <div className="modal-actions">
                <button type="button" className="back-button" onClick={() => setActiveSiteId('')}>
                  Back to cache
                </button>
                <a href={activeSite.url} target="_blank" rel="noreferrer" className="btn-link">
                  Open original
                </a>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => refreshSnapshot(activeSite)}
                  disabled={isBusy}
                >
                  {isBusy ? 'Refreshing...' : 'Refresh snapshot'}
                </button>
                <button
                  type="button"
                  className="btn-delete"
                  onClick={() => {
                    removeCachedWebsite(activeSite.id);
                    setActiveSiteId('');
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <div ref={snapshotViewerRef} className="snapshot-viewer">
              <iframe
                title={activeSite.title}
                src={activeSite.snapshotHtml ? undefined : activeSite.url}
                srcDoc={activeSite.snapshotHtml || undefined}
                className="modal-iframe"
                sandbox="allow-same-origin allow-popups allow-forms"
                style={{ height: activeSite.snapshotHtml ? `${snapshotHeight}px` : undefined }}
                onLoad={(event) => {
                  if (!activeSite.snapshotHtml) return;
                  const document = event.currentTarget.contentDocument;
                  if (!document) return;
                  const pageHeight = Math.max(
                    document.body?.scrollHeight || 0,
                    document.documentElement.scrollHeight,
                  );
                  setSnapshotHeight(Math.max(720, pageHeight));
                }}
              />
              {activeSite.snapshotHtml && (
                <canvas
                  ref={annotationCanvasRef}
                  className={`annotation-canvas ${penEnabled ? 'drawing' : ''}`}
                  style={{ height: `${snapshotHeight}px` }}
                  onPointerDown={startAnnotation}
                  onPointerMove={extendAnnotation}
                  onPointerUp={finishAnnotation}
                  onPointerCancel={finishAnnotation}
                />
              )}
              {textInput && (
                <div
                  className="annotation-text-editor"
                  style={{
                    left: `${getDisplayPoint(textInput).x}px`,
                    top: `${getDisplayPoint(textInput).y - 24}px`,
                  }}
                >
                  <button
                    type="button"
                    className="text-drag-handle"
                    aria-label="Move text"
                    onPointerDown={startTextDrag}
                    onPointerMove={moveTextDrag}
                    onPointerUp={finishTextDrag}
                    onPointerCancel={finishTextDrag}
                  >
                    ::
                  </button>
                  <input
                    autoFocus
                    className="annotation-text-input"
                    style={{
                      color: penColor,
                      fontSize: `${Math.max(penSize * 4, 14)}px`,
                      width: `${Math.max(textInput.value.length + 2, 8)}ch`,
                    }}
                    value={textInput.value}
                    onChange={(event) =>
                      setTextInput((previous) => ({ ...previous, value: event.target.value }))
                    }
                    onBlur={finishTextAnnotation}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') finishTextAnnotation();
                      if (event.key === 'Escape') setTextInput(null);
                    }}
                  />
                </div>
              )}
            </div>
            {activeSite.snapshotHtml && (
              <div className="annotation-toolbar">
                <button
                  type="button"
                  className={penEnabled && penMode === 'underline' ? 'underline-toggle active' : 'underline-toggle'}
                  onClick={() => {
                    if (penEnabled && penMode === 'underline') {
                      setPenEnabled(false);
                    } else {
                      setPenMode('underline');
                      setPenEnabled(true);
                    }
                  }}
                >
                  Underline
                </button>
                <button
                  type="button"
                  className={penEnabled && penMode === 'text' ? 'text-toggle active' : 'text-toggle'}
                  onClick={() => {
                    if (penEnabled && penMode === 'text') {
                      setPenEnabled(false);
                    } else {
                      setPenMode('text');
                      setPenEnabled(true);
                    }
                  }}
                >
                  Text
                </button>
                <button
                  type="button"
                  className={penEnabled && penMode === 'laser' ? 'laser-toggle active' : 'laser-toggle'}
                  onClick={() => {
                    if (penEnabled && penMode === 'laser') {
                      setPenEnabled(false);
                    } else {
                      setPenMode('laser');
                      setPenEnabled(true);
                    }
                  }}
                >
                  Laser
                </button>
                <label className="pen-size">
                  Size
                  <input
                    type="range"
                    min="1"
                    max="18"
                    value={penSize}
                    onChange={(event) => setPenSize(Number(event.target.value))}
                  />
                </label>
                {['#ef4444', '#16a34a', '#facc15'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`pen-swatch ${penColor === color ? 'active' : ''}`}
                    style={{ '--swatch-color': color }}
                    aria-label={`Use ${color} pen`}
                    onClick={() => setPenColor(color)}
                  />
                ))}
                <label className="custom-color-picker" title="Choose a custom RGB color">
                  <input
                    type="color"
                    value={penColor}
                    aria-label="Choose a custom RGB color"
                    onChange={(event) => setPenColor(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={penEnabled && penMode === 'erase' ? 'eraser-swatch active' : 'eraser-swatch'}
                  aria-label="Use eraser"
                  title="Eraser"
                  onClick={() => {
                    if (penEnabled && penMode === 'erase') {
                      setPenEnabled(false);
                    } else {
                      setPenMode('erase');
                      setPenEnabled(true);
                    }
                  }}
                >
                  <Eraser size={17} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="clear-annotations"
                  onClick={clearAnnotations}
                  disabled={draftAnnotations.length === 0 || isBusy}
                >
                  Clear marks
                </button>
                <button
                  type="button"
                  className="save-annotations"
                  onClick={saveAnnotations}
                  disabled={isBusy || !hasUnsavedAnnotationChanges}
                >
                  {isBusy ? 'Saving...' : 'Save marks'}
                </button>
              </div>
            )}
            <p className="modal-tip">
              {activeSite.snapshotCreatedAt
                ? `Showing the saved snapshot from ${formatDate(activeSite.snapshotCreatedAt)}.`
                : 'No snapshot is available. Use the "Open original" link to view the live website.'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">YOUR CURATED TECHNICAL CACHE</h1>
        </div>
        <div className="header-search">
          <input
            type="text"
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button className="search-btn">🔍</button>
        </div>
        <div className="header-right">
          <div className="user-dropdown">
            <span>👤 User</span>
            <span className="dropdown-icon">▼</span>
          </div>
        </div>
      </header>

      <div className="app-container">
        {/* Sidebar with topics */}
        <aside className="app-sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-title">TOPICS</h3>
            <button className="topic-item add-topic-btn" onClick={addTopic}>
              + Add New Topic
            </button>
            {topics.length === 0 && !selectedTopic && (
              <button className="topic-item general-topic" onClick={() => setSelectedTopic('')}>
                All Topics
              </button>
            )}
            {topics.map((topic) => (
              <div key={topic} className="topic-wrapper">
                <button
                  className={`topic-item ${selectedTopic === topic ? 'active' : ''}`}
                  onClick={() => setSelectedTopic(selectedTopic === topic ? '' : topic)}
                >
                  {topic}
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="app-main">
          {/* Save section */}
          <div className="save-section">
            <h2 className="section-title">Add New Article</h2>
            <div className="save-form">
              <input
                type="text"
                value={websiteTitleInput}
                onChange={(e) => setWebsiteTitleInput(e.target.value)}
                placeholder="Article title"
                className="title-input"
              />
              <input
                type="url"
                value={websiteUrlInput}
                onChange={(e) => setWebsiteUrlInput(e.target.value)}
                placeholder="https://example.com"
                className="url-input"
              />
              <select
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                className="topic-select"
              >
                <option value="">Select Topic...</option>
                {topics.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSaveWebsite}
                disabled={isBusy}
                className="btn-save"
              >
                {isBusy ? 'Saving...' : 'Save'}
              </button>
            </div>
            {websiteError && <p className="error-text">{websiteError}</p>}
            {websiteNotice && <p className="success-text">{websiteNotice}</p>}
          </div>

          {/* Recently saved section */}
          <section className="articles-section">
            <h2 className="section-title">
              {selectedTopic
                ? `Articles in "${selectedTopic}"`
                : 'Recently Added & Saved Articles'}
            </h2>

            {sortedWebsites.length === 0 ? (
              <div className="empty-state-large">
                {cachedWebsites.length === 0
                  ? 'No articles saved yet. Add one to get started!'
                  : 'No articles match your search or topic.'}
              </div>
            ) : (
              <div className="articles-grid">
                {sortedWebsites.map((site) => (
                  <div
                    key={site.id}
                    className="article-card"
                    onClick={() => setActiveSiteId(site.id)}
                  >
                    <div className="card-header">
                      <span className="card-domain">{site.topic || 'General'}</span>
                    </div>
                    <h3 className="card-title">{site.title}</h3>
                    <p className="card-url">{site.url}</p>
                    <p className="card-date">Added {formatDate(site.createdAt)}</p>
                    <div className="card-actions">
                      <button
                        className="action-btn view-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSiteId(site.id);
                        }}
                      >
                        👁 View
                      </button>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer"
                        className="action-btn open-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗 Open
                      </a>
                      <button
                        className="action-btn delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCachedWebsite(site.id);
                        }}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;

