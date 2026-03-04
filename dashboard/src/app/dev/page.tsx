"use client";

import { useEffect, useState, useCallback } from "react";

interface User {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface Skill {
  id: string;
  creatorId?: string;
  slug?: string;
  agentName: string;
  description: string;
  prompt: string;
  category: string;
  emoji: string;
  tools: string[];
  visibility: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function DevPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [mySkillsList, setMySkillsList] = useState<Skill[]>([]);
  const [mySkillsError, setMySkillsError] = useState<string>("");
  const [publicSkillsList, setPublicSkillsList] = useState<Skill[]>([]);
  const [createResult, setCreateResult] = useState<string>("");
  const [updateResult, setUpdateResult] = useState<string>("");
  const [deleteResult, setDeleteResult] = useState<string>("");

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPrompt, setCreatePrompt] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createEmoji, setCreateEmoji] = useState("");
  const [createTools, setCreateTools] = useState("");
  const [createVisibility, setCreateVisibility] = useState("private");

  const [updateId, setUpdateId] = useState("");
  const [updateName, setUpdateName] = useState("");
  const [updateDescription, setUpdateDescription] = useState("");
  const [updatePrompt, setUpdatePrompt] = useState("");
  const [updateCategory, setUpdateCategory] = useState("");
  const [updateEmoji, setUpdateEmoji] = useState("");
  const [updateTools, setUpdateTools] = useState("");
  const [updateVisibility, setUpdateVisibility] = useState("private");

  const [deleteId, setDeleteId] = useState("");

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
    listMySkills();
    listPublicSkills();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listMySkills = async () => {
    setMySkillsError("");
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      if (Array.isArray(data)) {
        setMySkillsList(data);
      } else {
        setMySkillsError(data.error || "Unexpected response");
      }
    } catch (e) {
      setMySkillsError(`${e}`);
    }
  };

  const listPublicSkills = async () => {
    try {
      const res = await fetch("/api/pool/templates");
      const data = await res.json();
      if (Array.isArray(data)) setPublicSkillsList(data);
    } catch {
      // ignore
    }
  };

  const createSkill = async () => {
    setCreateResult("Creating...");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: createName,
          prompt: createPrompt,
          description: createDescription,
          category: createCategory,
          emoji: createEmoji,
          tools: createTools ? createTools.split(",").map((s) => s.trim()).filter(Boolean) : [],
          visibility: createVisibility,
        }),
      });
      const data = await res.json();
      setCreateResult(JSON.stringify(data, null, 2));
      listMySkills();
    } catch (e) {
      setCreateResult(`Error: ${e}`);
    }
  };

  const selectSkillForUpdate = (id: string) => {
    setUpdateId(id);
    const skill = mySkillsList.find((s) => s.id === id);
    if (skill) {
      setUpdateName(skill.agentName);
      setUpdateDescription(skill.description);
      setUpdatePrompt(skill.prompt);
      setUpdateCategory(skill.category);
      setUpdateEmoji(skill.emoji);
      setUpdateTools((skill.tools || []).join(", "));
      setUpdateVisibility(skill.visibility);
    }
  };

  const updateSkill = async () => {
    if (!updateId) {
      setUpdateResult("Error: ID is required");
      return;
    }
    setUpdateResult("Updating...");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(updateId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: updateName,
          prompt: updatePrompt,
          description: updateDescription,
          category: updateCategory,
          emoji: updateEmoji,
          tools: updateTools ? updateTools.split(",").map((s) => s.trim()).filter(Boolean) : [],
          visibility: updateVisibility,
        }),
      });
      const data = await res.json();
      setUpdateResult(JSON.stringify(data, null, 2));
      listMySkills();
    } catch (e) {
      setUpdateResult(`Error: ${e}`);
    }
  };

  const deleteSkill = async () => {
    if (!deleteId) {
      setDeleteResult("Error: ID is required");
      return;
    }
    setDeleteResult("Deleting...");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(deleteId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      setDeleteResult(JSON.stringify(data, null, 2));
      setDeleteId("");
      listMySkills();
    } catch (e) {
      setDeleteResult(`Error: ${e}`);
    }
  };

  return (
    <div className="dev-page">
      <style>{`
        .dev-page {
          max-width: 960px;
          margin: 0 auto;
          padding: 80px 32px;
        }
        .dev-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          align-items: start;
        }
        .dev-page h1 {
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.8px;
          line-height: 1.2;
          margin-bottom: 8px;
        }
        .dev-subtitle {
          font-size: 14px;
          color: var(--color-foreground-secondary);
          margin-bottom: 32px;
        }
        .dev-card {
          background: var(--color-surface);
          border: 1px solid var(--color-edge);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .dev-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid var(--color-edge);
        }
        .dev-card-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.2px;
        }
        .dev-card-body {
          padding: 20px;
        }
        .dev-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .dev-field label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-foreground-secondary);
        }
        .dev-field input,
        .dev-field textarea,
        .dev-field select {
          padding: 10px 14px;
          border: 1px solid var(--color-edge);
          border-radius: 8px;
          font-size: 13px;
          font-family: inherit;
          background: var(--color-surface);
          color: var(--color-foreground);
          transition: border-color 0.2s;
        }
        .dev-field input:focus,
        .dev-field textarea:focus,
        .dev-field select:focus {
          outline: none;
          border-color: var(--color-brand);
          box-shadow: 0 0 0 3px rgba(252,79,55,0.06);
        }
        .dev-field textarea {
          resize: vertical;
          min-height: 60px;
        }
        .dev-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }
        .btn {
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid;
          transition: all 0.15s;
        }
        .btn-primary {
          background: var(--color-brand);
          color: var(--color-foreground-inverted);
          border-color: var(--color-brand);
        }
        .btn-primary:hover { opacity: 0.9; }
        .btn-secondary {
          background: var(--color-surface);
          color: var(--color-foreground-secondary);
          border-color: var(--color-edge);
        }
        .btn-secondary:hover {
          border-color: var(--color-foreground-tertiary);
          color: var(--color-foreground);
        }
        .btn-danger {
          background: var(--color-surface);
          color: var(--color-error);
          border-color: var(--color-error-bg);
        }
        .btn-danger:hover { background: var(--color-error-bg); }
        .dev-pre {
          background: var(--color-surface-muted);
          border: 1px solid var(--color-edge-muted);
          border-radius: 8px;
          padding: 12px 16px;
          margin-top: 12px;
          overflow: auto;
          max-height: 300px;
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          font-size: 11px;
          line-height: 1.5;
          color: var(--color-foreground-secondary);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .auth-status {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .auth-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .auth-dot.green { background: #34C759; }
        .auth-dot.red { background: var(--color-error); }
        .auth-label {
          font-size: 13px;
          font-weight: 500;
        }
        .auth-user-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .auth-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid var(--color-edge);
        }
        .auth-user-info {
          flex: 1;
          min-width: 0;
        }
        .auth-user-name {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.2px;
        }
        .auth-user-sub {
          font-size: 11px;
          color: var(--color-foreground-tertiary);
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dev-fields-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .dev-field.full {
          grid-column: 1 / -1;
        }
        .skill-card {
          padding: 14px 16px;
          border: 1px solid var(--color-edge-muted);
          border-radius: 8px;
          margin-bottom: 8px;
          background: var(--color-surface-hover);
        }
        .skill-card:last-child { margin-bottom: 0; }
        .skill-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .skill-card-name {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.2px;
          color: var(--color-foreground);
        }
        .skill-card-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .skill-card-badge.public { background: var(--color-success-bg); color: #065F46; }
        .skill-card-badge.private { background: #DBEAFE; color: #1D4ED8; }
        .skill-card-desc {
          font-size: 12px;
          color: var(--color-foreground-secondary);
          line-height: 1.5;
          margin-bottom: 4px;
        }
        .skill-card-prompt {
          font-size: 12px;
          color: var(--color-foreground-secondary);
          line-height: 1.5;
          margin-bottom: 8px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .skill-card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 10px;
          color: var(--color-foreground-tertiary);
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        }
        .skill-card-meta span { white-space: nowrap; }
        .skill-list-empty {
          font-size: 13px;
          color: var(--color-foreground-tertiary);
          padding: 12px 0;
        }
        .skill-section-header {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--color-foreground-tertiary);
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--color-edge-muted);
          margin-bottom: 8px;
        }
        .skill-section-header:first-child { padding-top: 0; }
        @media (max-width: 768px) {
          .dev-page { padding: 32px 16px; }
          .dev-page h1 { font-size: 24px; }
          .dev-grid { grid-template-columns: 1fr; }
          .dev-fields-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <h1>Dev Testing</h1>
      <p className="dev-subtitle">Skills CRUD + Auth0 integration testing</p>

      <div className="dev-grid">
        {/* Left column: Auth + Lists */}
        <div>
          {/* Auth */}
          <div className="dev-card">
            <div className="dev-card-header">
              <span className="dev-card-title">Auth</span>
            </div>
            <div className="dev-card-body">
              {authLoading ? (
                <p style={{ fontSize: 13, color: "var(--color-foreground-tertiary)" }}>Loading...</p>
              ) : user ? (
                <>
                  <div className="auth-status">
                    <span className="auth-dot green" />
                    <span className="auth-label">Logged in</span>
                  </div>
                  <div className="auth-user-row">
                    {user.picture && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="auth-avatar" src={user.picture} alt="" />
                    )}
                    <div className="auth-user-info">
                      <div className="auth-user-name">{user.name || user.email || "User"}</div>
                      <div className="auth-user-sub">{user.sub}</div>
                    </div>
                  </div>
                  <a href="/auth/logout?returnTo=/dev"><button className="btn btn-secondary">Logout</button></a>
                </>
              ) : (
                <>
                  <div className="auth-status">
                    <span className="auth-dot red" />
                    <span className="auth-label">Not logged in</span>
                  </div>
                  <a href="/auth/login?returnTo=/dev"><button className="btn btn-primary">Login</button></a>
                </>
              )}
            </div>
          </div>

          {/* My Skills */}
          <div className="dev-card">
            <div className="dev-card-header">
              <span className="dev-card-title">My Skills</span>
              <button className="btn btn-secondary" onClick={() => { listMySkills(); listPublicSkills(); }}>Refresh</button>
            </div>
            <div className="dev-card-body">
              {mySkillsError && <pre className="dev-pre">{mySkillsError}</pre>}

              {/* Private */}
              <div className="skill-section-header">Private ({mySkillsList.filter((s) => s.visibility === "private").length})</div>
              {mySkillsList.filter((s) => s.visibility === "private").length === 0 && (
                <p className="skill-list-empty">No private skills</p>
              )}
              {mySkillsList.filter((s) => s.visibility === "private").map((s) => (
                <div className="skill-card" key={s.id}>
                  <div className="skill-card-top">
                    <span className="skill-card-name">{s.emoji} {s.agentName}</span>
                    <span className="skill-card-badge private">private</span>
                  </div>
                  {s.description && <div className="skill-card-desc">{s.description}</div>}
                  {s.prompt && <div className="skill-card-prompt">{s.prompt}</div>}
                  <div className="skill-card-meta">
                    <span>id: {s.id}</span>
                    {s.category && <span>cat: {s.category}</span>}
                    {s.tools?.length > 0 && <span>tools: {s.tools.join(", ")}</span>}
                    {s.createdAt && <span>created: {new Date(s.createdAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}

              {/* Public (mine) */}
              <div className="skill-section-header">Public ({mySkillsList.filter((s) => s.visibility === "public").length})</div>
              {mySkillsList.filter((s) => s.visibility === "public").length === 0 && (
                <p className="skill-list-empty">No public skills</p>
              )}
              {mySkillsList.filter((s) => s.visibility === "public").map((s) => (
                <div className="skill-card" key={s.id}>
                  <div className="skill-card-top">
                    <span className="skill-card-name">{s.emoji} {s.agentName}</span>
                    <span className="skill-card-badge public">public</span>
                  </div>
                  {s.description && <div className="skill-card-desc">{s.description}</div>}
                  {s.prompt && <div className="skill-card-prompt">{s.prompt}</div>}
                  <div className="skill-card-meta">
                    <span>id: {s.id}</span>
                    {s.category && <span>cat: {s.category}</span>}
                    {s.tools?.length > 0 && <span>tools: {s.tools.join(", ")}</span>}
                    {s.createdAt && <span>created: {new Date(s.createdAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: CRUD forms */}
        <div>
          {/* Create Skill */}
          <div className="dev-card">
            <div className="dev-card-header">
              <span className="dev-card-title">Create Skill</span>
            </div>
            <div className="dev-card-body">
              <div className="dev-fields-grid">
                <div className="dev-field">
                  <label>Agent Name</label>
                  <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="my-agent" />
                </div>
                <div className="dev-field">
                  <label>Category</label>
                  <input value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} placeholder="Sports" />
                </div>
                <div className="dev-field">
                  <label>Emoji</label>
                  <input value={createEmoji} onChange={(e) => setCreateEmoji(e.target.value)} placeholder="🎾" />
                </div>
                <div className="dev-field">
                  <label>Tools (comma-separated)</label>
                  <input value={createTools} onChange={(e) => setCreateTools(e.target.value)} placeholder="Search, Browse" />
                </div>
              </div>
              <div className="dev-field">
                <label>Description</label>
                <input value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} placeholder="Short blurb..." />
              </div>
              <div className="dev-field">
                <label>Prompt</label>
                <textarea value={createPrompt} onChange={(e) => setCreatePrompt(e.target.value)} placeholder="You are a helpful assistant..." />
              </div>
              <div className="dev-field">
                <label>Visibility</label>
                <select value={createVisibility} onChange={(e) => setCreateVisibility(e.target.value)}>
                  <option value="private">private</option>
                  <option value="public">public</option>
                </select>
              </div>
              <div className="dev-actions">
                <button className="btn btn-primary" onClick={createSkill}>Create</button>
              </div>
              {createResult && <pre className="dev-pre">{createResult}</pre>}
            </div>
          </div>

          {/* Update Skill */}
          <div className="dev-card">
            <div className="dev-card-header">
              <span className="dev-card-title">Update Skill</span>
            </div>
            <div className="dev-card-body">
              <div className="dev-field">
                <label>Skill</label>
                <select value={updateId} onChange={(e) => selectSkillForUpdate(e.target.value)}>
                  <option value="">Select a skill...</option>
                  {mySkillsList.map((s) => (
                    <option key={s.id} value={s.id}>{s.agentName}</option>
                  ))}
                </select>
              </div>
              <div className="dev-fields-grid">
                <div className="dev-field">
                  <label>Agent Name</label>
                  <input value={updateName} onChange={(e) => setUpdateName(e.target.value)} placeholder="my-agent" />
                </div>
                <div className="dev-field">
                  <label>Category</label>
                  <input value={updateCategory} onChange={(e) => setUpdateCategory(e.target.value)} placeholder="Sports" />
                </div>
                <div className="dev-field">
                  <label>Emoji</label>
                  <input value={updateEmoji} onChange={(e) => setUpdateEmoji(e.target.value)} placeholder="🎾" />
                </div>
                <div className="dev-field">
                  <label>Tools (comma-separated)</label>
                  <input value={updateTools} onChange={(e) => setUpdateTools(e.target.value)} placeholder="Search, Browse" />
                </div>
              </div>
              <div className="dev-field">
                <label>Description</label>
                <input value={updateDescription} onChange={(e) => setUpdateDescription(e.target.value)} placeholder="Short blurb..." />
              </div>
              <div className="dev-field">
                <label>Prompt</label>
                <textarea value={updatePrompt} onChange={(e) => setUpdatePrompt(e.target.value)} placeholder="Updated prompt..." />
              </div>
              <div className="dev-field">
                <label>Visibility</label>
                <select value={updateVisibility} onChange={(e) => setUpdateVisibility(e.target.value)}>
                  <option value="private">private</option>
                  <option value="public">public</option>
                </select>
              </div>
              <div className="dev-actions">
                <button className="btn btn-primary" onClick={updateSkill}>Update</button>
              </div>
              {updateResult && <pre className="dev-pre">{updateResult}</pre>}
            </div>
          </div>

          {/* Delete Skill */}
          <div className="dev-card">
            <div className="dev-card-header">
              <span className="dev-card-title">Delete Skill</span>
            </div>
            <div className="dev-card-body">
              <div className="dev-field">
                <label>Skill</label>
                <select value={deleteId} onChange={(e) => setDeleteId(e.target.value)}>
                  <option value="">Select a skill...</option>
                  {mySkillsList.map((s) => (
                    <option key={s.id} value={s.id}>{s.agentName}</option>
                  ))}
                </select>
              </div>
              <div className="dev-actions">
                <button className="btn btn-danger" onClick={deleteSkill}>Delete</button>
              </div>
              {deleteResult && <pre className="dev-pre">{deleteResult}</pre>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
