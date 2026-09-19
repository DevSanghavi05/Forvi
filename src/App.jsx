import { useEffect, useState } from 'react';
import Landing from './Landing';
import AuthPage from './AuthPage';
import Dashboard from './Dashboard';
import './App.css';

export default function App() {
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(null);

  // On load, check whether a Google session already exists (the OAuth
  // callback redirects back here after signing in).
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.user) {
          setUser(data.user);
          setView('app');
        }
      })
      .catch(() => {});

    // Strip the ?auth=success|error marker Google's callback left behind.
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const signOut = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        setUser(null);
        setView('landing');
      });
  };

  if (view === 'auth') {
    return (
      <AuthPage
        onGuest={() => {
          setUser(null);
          setView('app');
        }}
        onBack={() => setView('landing')}
      />
    );
  }

  if (view === 'app') {
    return <Dashboard user={user} onSignOut={signOut} />;
  }

  return <Landing onGetStarted={() => setView('auth')} />;
}
