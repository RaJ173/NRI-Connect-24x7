import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../NRI-Connect-247-code/app/client/src/auth/AuthContext';
import { ROLE_LABELS } from '../../NRI-Connect-247-code/app/shared/types';
import { demoUsers, switchPersona, resetDemo, inbox, exportDemo, storageStatus } from './demo-runtime.js';
import './demo.css';

export function DemoToolbar() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [mails, setMails] = useState<any[]>([]);
  const [panel, setPanel] = useState<'guide' | 'inbox' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      void demoUsers().then(setUsers);
      void inbox().then(setMails);
      setRevision(value => value + 1);
    };
    refresh();
    window.addEventListener('nri-demo-change', refresh);
    return () => window.removeEventListener('nri-demo-change', refresh);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const switchTo = async (id: string) => {
    if (!id) return;
    setBusy(true); setMessage('');
    try {
      const next = await switchPersona(id);
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
      queryClient.setQueryData(['me'], next);
      navigate('/app'); setPanel(null);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm('Reset this browser’s demo data and uploaded files? This does not affect the original application.')) return;
    setBusy(true);
    try {
      await resetDemo();
      queryClient.clear();
      navigate('/'); setPanel(null); setMessage('Demo reset. Choose a role to begin.');
    } catch { setMessage('The reset could not finish. Please reload and try again.'); }
    finally { setBusy(false); }
  };
  const storageMessage = storageStatus();
  return <>
    <div className="demo-toolbar" aria-label="Prototype controls">
      <div className="demo-identity"><span className="demo-dot" /> Interactive prototype <span className="demo-local">· browser-local sample data</span></div>
      <div className="demo-controls">
        <label className="sr-only" htmlFor="demo-persona">Preview as</label>
        <select id="demo-persona" value={user?.id || ''} disabled={busy} onChange={event => void switchTo(event.target.value)}>
          <option value="">Preview as…</option>
          {users.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{ROLE_LABELS[item.roles[0] as keyof typeof ROLE_LABELS]} · {item.name}</option>)}
        </select>
        <button type="button" onClick={() => setPanel(panel === 'guide' ? null : 'guide')} aria-expanded={panel === 'guide'}>Demo guide</button>
        <button type="button" onClick={() => setPanel(panel === 'inbox' ? null : 'inbox')} aria-expanded={panel === 'inbox'}>Demo inbox{mails.length ? ` (${mails.length})` : ''}</button>
        <button type="button" onClick={exportDemo} className="demo-export">Export data</button>
        <button type="button" disabled={busy} onClick={() => void reset()}>Reset demo</button>
      </div>
    </div>
    {(message || storageMessage) && <div className="demo-message" role="status">{storageMessage || message}<button type="button" aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    {panel && <div className="demo-panel-backdrop" onClick={() => setPanel(null)}>
      <section className="demo-panel" role="dialog" aria-modal="true" aria-label={panel === 'guide' ? 'Prototype guide' : 'Demo email inbox'} onClick={event => event.stopPropagation()}>
        <div className="demo-panel-heading"><div><span className="demo-eyebrow">NRI CONNECT 24/7</span><h2>{panel === 'guide' ? 'Explore the complete workflow' : 'Demo email inbox'}</h2></div><button type="button" className="icon-btn" aria-label="Close demo panel" onClick={() => setPanel(null)}>×</button></div>
        {panel === 'guide' ? <>
          <p>This standalone prototype uses the application’s actual screens and workflow rules. All changes stay in this browser. Accounts, messages and access controls are demonstrations, not a production service.</p>
          <div className="demo-flow"><span>Customer</span><b>→</b><span>Operations</span><b>→</b><span>Field / travel partner</span><b>→</b><span>Customer review</span></div>
          <ol className="demo-guide-steps">
            <li><b>Customer:</b> add or edit a property, submit a service or travel request, add files and invite a representative.</li>
            <li><b>Operations:</b> review a request, assign an engineer or travel partner, schedule a visit and manage priorities.</li>
            <li><b>Field engineer:</b> start the visit, finish its checklist, record notes, upload a photo and complete the work.</li>
            <li><b>Customer:</b> review the visit, acknowledge it, close the request or reopen it with a note.</li>
            <li><b>Local representative:</b> review shared properties and invitations. Customer permissions determine the available actions.</li>
            <li><b>Super admin:</b> manage users and roles, service categories, completion rules, the audit trail and email outbox.</li>
          </ol>
          <div className="demo-note"><b>Getting started</b><p>Use “Preview as” to switch roles without a password. You can also use the normal login forms: the seeded accounts use <code>Demo@1234</code>. Registration and password reset are simulated locally. Verification and reset links appear in the Demo inbox; no emails are sent.</p></div>
          <p className="muted small">Files are stored in this browser’s IndexedDB. Export downloads the sample record data, excluding credentials and file contents. Reset removes this prototype’s local records and files.</p>
        </> : <>
          <p className="muted">Messages created during the demo appear here. Nothing is sent to a real email address.</p>
          {!mails.length && <div className="demo-note">Register a sample account, request a password reset, invite a representative or update a request to create a message.</div>}
          <div className="demo-mails">{mails.map(mail => <article key={mail.id}>
            <div className="demo-mail-meta"><span>To: {mail.toEmail}</span><time>{new Date(mail.createdAt).toLocaleString()}</time></div>
            <h3>{mail.subject}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{mail.body}</p>
            {mail.link && <a className="btn primary" href={mail.link.startsWith('/') ? `#${mail.link}` : mail.link} onClick={() => setPanel(null)}>Open demo link</a>}
          </article>)}</div>
        </>}
      </section>
    </div>}
  </>;
}
