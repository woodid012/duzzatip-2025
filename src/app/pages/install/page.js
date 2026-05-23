'use client'

import { useEffect, useState } from 'react';
import Logo from '@/app/components/Logo';

export default function InstallPage() {
  const [platform, setPlatform] = useState('unknown');
  const [isStandalone, setIsStandalone] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = window.navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/i.test(ua);
    if (isIOS) setPlatform('ios');
    else if (isAndroid) setPlatform('android');
    else setPlatform('desktop');

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(standalone);

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

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="flex flex-col items-center text-center mb-8">
        <Logo width={120} height={120} className="rounded-2xl shadow-md mb-4" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Install DuzzaTip</h1>
        <p className="text-gray-600 mt-2 max-w-xl">
          Add DuzzaTip to your home screen for a faster, full-screen experience — no app store needed.
        </p>
      </div>

      {isStandalone && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-center">
          You&apos;re already running DuzzaTip as an installed app. Nice.
        </div>
      )}

      {installPromptEvent && !isStandalone && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-blue-900">Quick install available</div>
            <div className="text-sm text-blue-800">Your browser supports one-click install.</div>
          </div>
          <button
            onClick={triggerInstall}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            Install
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* iOS / Safari */}
        <section
          className={`bg-white rounded-lg shadow border p-5 ${
            platform === 'ios' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl"></span>
            <h2 className="text-lg font-bold text-gray-900">iPhone / iPad (Safari)</h2>
            {platform === 'ios' && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                You&apos;re here
              </span>
            )}
          </div>
          <ol className="space-y-3 text-sm text-gray-800">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                1
              </span>
              <span>
                Open this page in <strong>Safari</strong> (not Chrome or another browser — iOS only allows installing from Safari).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                2
              </span>
              <span>
                Tap the <strong>Share</strong> button (the square with an arrow pointing up) at the bottom of the screen.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                3
              </span>
              <span>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                4
              </span>
              <span>
                Tap <strong>Add</strong> in the top right. The DuzzaTip icon will appear on your home screen.
              </span>
            </li>
          </ol>
        </section>

        {/* Android / Chrome */}
        <section
          className={`bg-white rounded-lg shadow border p-5 ${
            platform === 'android' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl"></span>
            <h2 className="text-lg font-bold text-gray-900">Android (Chrome)</h2>
            {platform === 'android' && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                You&apos;re here
              </span>
            )}
          </div>
          <ol className="space-y-3 text-sm text-gray-800">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                1
              </span>
              <span>
                Open this page in <strong>Chrome</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                2
              </span>
              <span>
                Tap the <strong>three-dot menu</strong> (⋮) in the top right corner.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                3
              </span>
              <span>
                Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong> if shown).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                4
              </span>
              <span>
                Tap <strong>Install</strong> or <strong>Add</strong> to confirm. DuzzaTip will appear in your app drawer.
              </span>
            </li>
          </ol>
        </section>

        {/* Desktop */}
        <section
          className={`bg-white rounded-lg shadow border p-5 md:col-span-2 ${
            platform === 'desktop' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl"></span>
            <h2 className="text-lg font-bold text-gray-900">Desktop (Chrome / Edge)</h2>
            {platform === 'desktop' && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                You&apos;re here
              </span>
            )}
          </div>
          <ol className="space-y-3 text-sm text-gray-800">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                1
              </span>
              <span>
                Look for the <strong>install icon</strong> in the address bar (a small monitor with a down arrow), or open the
                browser menu.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                2
              </span>
              <span>
                Click <strong>Install DuzzaTip</strong>. The app opens in its own window and gets a shortcut on your desktop /
                start menu.
              </span>
            </li>
          </ol>
        </section>
      </div>

      <div className="mt-8 text-center text-sm text-gray-500">
        Tip: once installed, DuzzaTip launches without browser tabs, address bars, or distractions.
      </div>
    </div>
  );
}
