import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

// ── pdf.js for client-side PDF parsing (Phase 5) ──
import * as pdfjsLib from 'pdfjs-dist';

// Use local .js worker script for 100% offline client-side PDF parsing in Capacitor Android
try {
    if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
    }
} catch (e) {
    console.warn("Failed to set PDF workerSrc:", e);
}

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
