import { InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

/**
 * The comms desk's own BFF route.
 *
 * Separate from API_BASE_URL because it is a different service behind a
 * different gateway route — the resource server knows nothing about reports.
 */
export const COMMS_BASE_URL = new InjectionToken<string>('COMMS_BASE_URL');
