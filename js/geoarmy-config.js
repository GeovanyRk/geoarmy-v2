// ===== Config compartida de Supabase para todo el sitio (Fase 1 — Mi Geo Army) =====
// Pega aquí, UNA SOLA VEZ, los valores reales de tu proyecto de Supabase
// (Project Settings -> API -> Project URL / anon public key).
// Estos dos valores son PÚBLICOS por diseño (protegidos por RLS en el propio
// schema.sql) — es normal y seguro que vivan en el código del sitio. Lo que
// NUNCA va aquí es la Service Role Key ni el Client Secret de Twitch.
//
// Este archivo se carga ANTES de js/geoarmy-account.js en cada página
// (index-v3.html, mi-geoarmy.html, auth/callback/index.html), así que solo
// hay que editar los valores en este único lugar.
window.GEOARMY_SUPABASE_URL = 'https://zhegmjppvpgvrnhlevsc.supabase.co';
window.GEOARMY_SUPABASE_ANON_KEY = 'sb_publishable_NOs6VaVgUOQiib5r0GJQiQ_ZoWt1_qb';
