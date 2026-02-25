export default function Home() {
  return (
    <main className="form-wrapper">
      <div className="form-center">
        {/* Paste input area - shown when pool has idle instances */}
        <div className="paste-input-wrap">
          <input
            className="paste-input"
            type="text"
            placeholder="Paste a group chat link to add an assistant"
            disabled
          />
        </div>

        {/* Empty state - shown when pool has no idle instances */}
        <div className="empty-state" style={{ display: "none" }}>
          <div className="empty-scene">
            <p>No assistants available right now</p>
          </div>
        </div>
      </div>
    </main>
  );
}
