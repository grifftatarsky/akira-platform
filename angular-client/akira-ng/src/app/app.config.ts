import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { httpErrorInterceptor } from './common/http/http-error.interceptor';
import { environment } from '../environments/environment';
import { API_BASE_URL, COMMS_BASE_URL } from './app.tokens';
import { OozeShellBridge } from './shell/ooze-shell-bridge';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withXhr(), withInterceptors([httpErrorInterceptor])),
    {
      provide: API_BASE_URL,
      useValue: `${environment.apiBaseUrl}${environment.bffPath}/api`,
    },
    {
      provide: COMMS_BASE_URL,
      useValue: `${environment.apiBaseUrl}${environment.bffPath}${environment.commsPath}`,
    },
    // Eagerly construct the federation bridge so the shell auth API is on
    // globalThis before the ooze remote ever loads.
    provideAppInitializer((): void => {
      inject(OozeShellBridge);
    }),
  ],
};

export const reverseProxyUri = `${environment.apiBaseUrl}${environment.bffPath}`;
export const baseUri: string = environment.apiBaseUrl || window.location.origin;
