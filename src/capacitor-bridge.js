import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

// ── pdf.js for client-side PDF parsing (Phase 5) ──
import * as pdfjsLib from 'pdfjs-dist';

// Disable worker for simplicity — runs synchronously in main thread.
// This is fine for single-file CAS PDFs (typically <100 pages).
// A web worker can be added later for performance if needed.
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

window.AppPlugins = {
    Capacitor,
    App,
    NativeBiometric,
    SplashScreen,
    StatusBar,
    Style,
    Filesystem,
    Directory,
    LocalNotifications
};

window.pdfjsLib = pdfjsLib;
