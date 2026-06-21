import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
// WPFでいう App.xaml.cs のような役割を担うファイル
bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
