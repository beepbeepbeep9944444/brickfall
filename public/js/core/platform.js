// Where this copy of the game is running (see /config.js). Builds hosted on another site (CrazyGames)
// call the API cross-origin and sign in with a bearer token instead of a cookie.
const cfg = window.BRICKFALL_CONFIG || {};
const param = new URLSearchParams(location.search).get('platform');

/** 'web' (our own site) or 'crazygames'. */
export const PLATFORM = param === 'crazygames' ? 'crazygames' : cfg.platform === 'crazygames' ? 'crazygames' : 'web';
export const ON_CRAZYGAMES = PLATFORM === 'crazygames';

/** Base URL of the Brickfall server ('' = same site). */
export const API_BASE = String(cfg.apiBase || '').replace(/\/+$/, '');

/** Use a bearer token (stored in this browser) instead of the session cookie. */
export const TOKEN_AUTH = ON_CRAZYGAMES || !!API_BASE;

/** Touch-first device (phones, tablets): shows on-screen controls. */
export const TOUCH = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
