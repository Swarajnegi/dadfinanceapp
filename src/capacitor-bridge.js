import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

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
