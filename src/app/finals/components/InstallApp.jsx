'use client';

import { useEffect, useState } from 'react';

// Platform-aware add-to-home-screen instructions, condensed from the main
// app's /pages/install page so the rules one-pager can carry them inline.
const STEPS = {
  ios: {
    title: 'iPhone / iPad (Safari)',
    steps: [
      <>Open this page in <strong>Safari</strong> (iOS only allows installing from Safari).</>,
      <>Tap the <strong>Share</strong> button (square with the up arrow) at the bottom of the screen.</>,
      <>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</>,
    ],
  },
  android: {
    title: 'Android (Chrome)',
    steps: [
      <>Open this page in <strong>Chrome</strong>.</>,
      <>Tap the <strong>three-dot menu</strong> (⋮) in the top right.</>,
      <>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then confirm.</>,
    ],
  },
  desktop: {
    title: 'Desktop (Chrome / Edge)',
    steps: [
      <>Look for the <strong>install icon</strong> in the address bar, or open the browser menu.</>,
      <>Click <strong>Install</strong> — the app opens in its own window with a shortcut on your desktop.</>,
    ],
  },
};

export default function InstallApp() {
  const [platform, setPlatform] = useState('desktop');
  const [isStandalone, setIsStandalone] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const ua = window.navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) setPlatform('ios');
    else if (/Android/i.test(ua)) setPlatform('android');
    else setPlatform('desktop');

    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true
    );

    const handler = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const triggerInstall = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  if (isStandalone) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
        You&apos;re already running this as an installed app. Nice.
      </div>
    );
  }

  const current = STEPS[platform];
  const others = Object.entries(STEPS).filter(([key]) => key !== platform);

  return (
    <div className="space-y-4">
      <p>
        Add Duzza Finals to your home screen for a faster, full-screen experience — no app
        store needed. Combined with your saved login, it&apos;s one tap from icon to entering
        your team.
      </p>

      {installPromptEvent && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex items-center justify-between gap-4">
          <div className="text-sm">
            <div className="font-bold text-blue-900">Quick install available</div>
            <div className="text-blue-800">Your browser supports one-click install.</div>
          </div>
          <button
            type="button"
            onClick={triggerInstall}
            className="shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm"
          >
            Install
          </button>
        </div>
      )}

      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
        <div className="font-bold text-slate-900 mb-2 flex items-center gap-2">
          {current.title}
          <span className="dz-badge bg-blue-100 text-blue-800">You&apos;re here</span>
        </div>
        <ol className="space-y-2">
          {current.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <details className="text-sm text-slate-500">
        <summary className="cursor-pointer select-none font-semibold text-slate-600">
          On a different device?
        </summary>
        <div className="mt-3 space-y-3">
          {others.map(([key, info]) => (
            <div key={key} className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="font-bold text-slate-900 mb-2">{info.title}</div>
              <ol className="space-y-2">
                {info.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-700">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-400 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
