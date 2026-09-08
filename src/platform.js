(() => {
  'use strict';

  const PLATFORM_VERSION = '2.0.0-pwa.4';
  const root = document.documentElement;
  let deferredInstallPrompt = null;
  let registration = null;

  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  const snapshot = () => Object.freeze({
    version: PLATFORM_VERSION,
    online: navigator.onLine,
    standalone: isStandalone(),
    installable: Boolean(deferredInstallPrompt),
    serviceWorker: registration?.active?.state || registration?.installing?.state || 'inactive',
  });

  const emit = (type, detail = snapshot()) => {
    window.dispatchEvent(new CustomEvent(`echobound:${type}`, { detail }));
  };

  const updateConnectivity = () => {
    root.dataset.connectivity = navigator.onLine ? 'online' : 'offline';
    emit(navigator.onLine ? 'online' : 'offline');
  };

  const observeWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      emit('service-worker-state', snapshot());
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        emit('update-ready', snapshot());
      }
    });
  };

  const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator) || !['http:', 'https:'].includes(location.protocol)) {
      emit('service-worker-unavailable');
      return null;
    }

    try {
      registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      });
      observeWorker(registration.installing);
      registration.addEventListener('updatefound', () => observeWorker(registration.installing));
      emit('service-worker-ready', snapshot());
      return registration;
    } catch (error) {
      emit('service-worker-error', Object.freeze({
        ...snapshot(),
        message: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  };

  const serviceWorkerReady = new Promise((resolve) => {
    const beginRegistration = () => void registerServiceWorker().then(resolve);
    if (document.readyState === 'complete') beginRegistration();
    else window.addEventListener('load', beginRegistration, { once: true });
  });

  window.addEventListener('online', updateConnectivity);
  window.addEventListener('offline', updateConnectivity);
  updateConnectivity();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    emit('install-available', snapshot());
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    emit('installed', snapshot());
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      emit('service-worker-controller', snapshot());
    });
  }

  const promptInstall = async () => {
    if (!deferredInstallPrompt) return Object.freeze({ outcome: 'unavailable' });

    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    emit('install-choice', Object.freeze({ ...snapshot(), outcome: choice.outcome }));
    return choice;
  };

  const requestUpdate = async () => {
    const activeRegistration = registration || await serviceWorkerReady;
    if (!activeRegistration) return false;
    await activeRegistration.update();
    return true;
  };

  window.ECHOboundPlatform = Object.freeze({
    version: PLATFORM_VERSION,
    ready: serviceWorkerReady,
    getStatus: snapshot,
    promptInstall,
    requestUpdate,
  });
})();
