import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MomentsPanel } from '@alpine/moments/react';
import '@alpine/moments/styles.css';
import './app.css';

function App() {
  const runRef = new URLSearchParams(location.search).get('run') || 'personal';
  const [tasks, setTasks] = useState([]), [title, setTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function request(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) throw Error('The request failed. Try again.');
    return response.json();
  }
  async function refresh() { setTasks(await request(`/api/tasks?runRef=${encodeURIComponent(runRef)}`)); }
  useEffect(() => { refresh().catch(error => setError(error.message)); }, []);
  async function mutate(operation) {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <><main className="task-app"><p className="task-app-kicker">Moments example</p><h1>A small task, from draft to done</h1>
    <p>Create one task and mark it complete. The checkpoint driver reads the real backend to verify each step.</p>
    <form onSubmit={event => { event.preventDefault(); void mutate(async () => {
      await request('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runRef, title }) }); setTitle('');
    }); }}><label htmlFor="title">Task title</label><input id="title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={160}/>
      <button type="submit" disabled={busy}>Create task</button></form>
    {error && <p role="alert">{error}</p>}
    <section aria-label="Tasks">{tasks.length === 0 ? <p>No tasks yet</p> : <ul>{tasks.map(task => <li key={task.id}>
      <span>{task.title}</span><span role="status">{task.completed ? 'Completed' : 'Open'}</span>
      {!task.completed && <button disabled={busy} onClick={() => void mutate(() => request(`/api/tasks/${task.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runRef, completed: true })
      }))}>Complete task</button>}</li>)}</ul>}</section>
    <p className="task-app-note">This page shows tasks for this browser run. Closing the Moments session removes only tasks created for that run.</p>
  </main><MomentsPanel/></>;
}
createRoot(document.getElementById('root')).render(<App/>);
