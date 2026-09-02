import { useEffect, useState } from 'react';
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
  createdAt: item.created_at,
});

function App() {
  const [websiteUrlInput, setWebsiteUrlInput] = useState('');
  const [cachedWebsites, setCachedWebsites] = useState([]);
  const [activeSiteId, setActiveSiteId] = useState('');
  const [websiteNotice, setWebsiteNotice] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');

  const activeSite = cachedWebsites.find((site) => site.id === activeSiteId) ?? null;

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
        .select('id, title, url, topic, snapshot_html, snapshot_created_at, created_at')
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
    const trimmedUrl = websiteUrlInput.trim();

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
    const title = normalizeSiteName(normalizedUrl);
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
        .select('id, title, url, topic, snapshot_html, snapshot_created_at, created_at')
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
      setIsBusy(false);
      return;
    }

    setWebsiteError('Supabase is not configured. The website was not saved.');
    setIsBusy(false);
  };

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
            <button className="modal-close" onClick={() => setActiveSiteId('')}>
              ✕
            </button>
            <div className="modal-header">
              <h2>{activeSite.title}</h2>
              <div className="modal-actions">
                <a href={activeSite.url} target="_blank" rel="noreferrer" className="btn-link">
                  Open original
                </a>
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
            <iframe
              title={activeSite.title}
              src={activeSite.snapshotHtml ? undefined : activeSite.url}
              srcDoc={activeSite.snapshotHtml || undefined}
              className="modal-iframe"
              sandbox="allow-same-origin allow-popups allow-forms"
            />
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

