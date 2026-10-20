/*
 * Signatures for common third-party tags, written for this package (MIT).
 * Each one is a list of URL fragments that the tag's loader uses; we look for
 * them in the page's script, iframe, image and link URLs and in inline script
 * text. Tags injected later by another script (for example by a tag manager)
 * are not visible in the HTML and are not reported.
 */
import type { TagCategory } from '../types.js';

/** One tag the detector knows. */
export interface TagSignature {
  id: string;
  name: string;
  category: TagCategory;
  /** Lowercase URL fragments; any one matching means the tag is present. */
  match: string[];
  /** Pulls account or container IDs out of the matched text. */
  ids?: RegExp;
}

/** The signatures, by category. */
export const TAG_SIGNATURES: readonly TagSignature[] = [
  // Tag managers
  { id: 'google-tag-manager', name: 'Google Tag Manager', category: 'tag-manager', match: ['googletagmanager.com/gtm.js', 'googletagmanager.com/ns.html'], ids: /\bGTM-[A-Z0-9]{4,10}\b/g },
  { id: 'adobe-launch', name: 'Adobe Experience Platform Tags', category: 'tag-manager', match: ['assets.adobedtm.com'] },
  { id: 'tealium', name: 'Tealium iQ', category: 'tag-manager', match: ['tags.tiqcdn.com'] },
  // Analytics
  { id: 'google-analytics-4', name: 'Google Analytics 4 (gtag.js)', category: 'analytics', match: ['googletagmanager.com/gtag/js?id=g-', "'config', 'g-", '"config","g-', "'config','g-"], ids: /\bG-[A-Z0-9]{6,12}\b/g },
  { id: 'google-analytics-universal', name: 'Google Analytics (Universal, analytics.js)', category: 'analytics', match: ['google-analytics.com/analytics.js', 'google-analytics.com/ga.js'], ids: /\bUA-\d{4,10}-\d{1,4}\b/g },
  { id: 'plausible', name: 'Plausible Analytics', category: 'analytics', match: ['plausible.io/js/'] },
  { id: 'fathom', name: 'Fathom Analytics', category: 'analytics', match: ['cdn.usefathom.com'] },
  { id: 'simple-analytics', name: 'Simple Analytics', category: 'analytics', match: ['scripts.simpleanalyticscdn.com'] },
  { id: 'umami', name: 'Umami', category: 'analytics', match: ['cloud.umami.is/script.js', 'umami.js'] },
  { id: 'matomo', name: 'Matomo', category: 'analytics', match: ['matomo.js', 'piwik.js', 'matomo.cloud'] },
  { id: 'cloudflare-web-analytics', name: 'Cloudflare Web Analytics', category: 'analytics', match: ['static.cloudflareinsights.com/beacon'] },
  { id: 'vercel-analytics', name: 'Vercel Web Analytics', category: 'analytics', match: ['/_vercel/insights/script.js', 'va.vercel-scripts.com'] },
  { id: 'mixpanel', name: 'Mixpanel', category: 'analytics', match: ['cdn.mxpnl.com', 'mixpanel-2-latest'] },
  { id: 'amplitude', name: 'Amplitude', category: 'analytics', match: ['cdn.amplitude.com'] },
  { id: 'segment', name: 'Segment', category: 'analytics', match: ['cdn.segment.com/analytics.js'] },
  { id: 'heap', name: 'Heap', category: 'analytics', match: ['cdn.heapanalytics.com'] },
  { id: 'posthog', name: 'PostHog', category: 'analytics', match: ['i.posthog.com', 'posthog.com/static/array.js', 'posthog-js'] },
  { id: 'yandex-metrica', name: 'Yandex Metrica', category: 'analytics', match: ['mc.yandex.ru/metrika', 'mc.yandex.ru/watch'] },
  { id: 'hubspot', name: 'HubSpot tracking code', category: 'analytics', match: ['js.hs-scripts.com', 'js.hs-analytics.net'] },
  // Advertising
  { id: 'meta-pixel', name: 'Meta Pixel', category: 'advertising', match: ['connect.facebook.net/en_us/fbevents.js', '/fbevents.js', 'facebook.com/tr?'], ids: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g },
  { id: 'linkedin-insight', name: 'LinkedIn Insight Tag', category: 'advertising', match: ['snap.licdn.com/li.lms-analytics', 'px.ads.linkedin.com'] },
  { id: 'google-ads', name: 'Google Ads conversion tracking', category: 'advertising', match: ['googleadservices.com/pagead/conversion', 'googletagmanager.com/gtag/js?id=aw-', "'config', 'aw-", "'config','aw-"], ids: /\bAW-\d{6,12}\b/g },
  { id: 'google-adsense', name: 'Google AdSense', category: 'advertising', match: ['pagead2.googlesyndication.com'] },
  { id: 'doubleclick', name: 'Google Marketing Platform (DoubleClick)', category: 'advertising', match: ['doubleclick.net'] },
  { id: 'microsoft-uet', name: 'Microsoft Advertising UET', category: 'advertising', match: ['bat.bing.com'] },
  { id: 'tiktok-pixel', name: 'TikTok Pixel', category: 'advertising', match: ['analytics.tiktok.com'] },
  { id: 'x-pixel', name: 'X (Twitter) Pixel', category: 'advertising', match: ['static.ads-twitter.com'] },
  { id: 'pinterest-tag', name: 'Pinterest Tag', category: 'advertising', match: ['s.pinimg.com/ct/core.js'] },
  { id: 'snap-pixel', name: 'Snap Pixel', category: 'advertising', match: ['sc-static.net/scevent.min.js'] },
  { id: 'reddit-pixel', name: 'Reddit Pixel', category: 'advertising', match: ['redditstatic.com/ads/pixel.js'] },
  { id: 'criteo', name: 'Criteo', category: 'advertising', match: ['static.criteo.net'] },
  { id: 'quora-pixel', name: 'Quora Pixel', category: 'advertising', match: ['a.quora.com/qevents.js'] },
  // Consent managers
  { id: 'onetrust', name: 'OneTrust', category: 'consent', match: ['cdn.cookielaw.org', 'optanon.blob.core.windows.net', 'otsdkstub.js'] },
  { id: 'cookiebot', name: 'Cookiebot', category: 'consent', match: ['consent.cookiebot.com', 'consent.cookiebot.eu'] },
  { id: 'usercentrics', name: 'Usercentrics', category: 'consent', match: ['app.usercentrics.eu', 'web.cmp.usercentrics.eu'] },
  { id: 'didomi', name: 'Didomi', category: 'consent', match: ['sdk.privacy-center.org'] },
  { id: 'osano', name: 'Osano', category: 'consent', match: ['cmp.osano.com'] },
  { id: 'termly', name: 'Termly', category: 'consent', match: ['app.termly.io'] },
  { id: 'iubenda', name: 'iubenda', category: 'consent', match: ['cdn.iubenda.com', 'cs.iubenda.com'] },
  { id: 'cookieyes', name: 'CookieYes', category: 'consent', match: ['cdn-cookieyes.com'] },
  { id: 'quantcast-choice', name: 'Quantcast Choice', category: 'consent', match: ['cmp.quantcast.com', 'quantcast.mgr.consensu.org'] },
  { id: 'trustarc', name: 'TrustArc', category: 'consent', match: ['consent.trustarc.com'] },
  // Chat widgets
  { id: 'intercom', name: 'Intercom', category: 'chat', match: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { id: 'drift', name: 'Drift', category: 'chat', match: ['js.driftt.com'] },
  { id: 'crisp', name: 'Crisp', category: 'chat', match: ['client.crisp.chat'] },
  { id: 'tawk', name: 'tawk.to', category: 'chat', match: ['embed.tawk.to'] },
  { id: 'zendesk', name: 'Zendesk Web Widget', category: 'chat', match: ['static.zdassets.com'] },
  { id: 'hubspot-chat', name: 'HubSpot chat', category: 'chat', match: ['js.usemessages.com'] },
  { id: 'livechat', name: 'LiveChat', category: 'chat', match: ['cdn.livechatinc.com'] },
  { id: 'tidio', name: 'Tidio', category: 'chat', match: ['code.tidio.co'] },
  { id: 'freshchat', name: 'Freshchat', category: 'chat', match: ['wchat.freshchat.com'] },
  // Session replay and heatmaps
  { id: 'hotjar', name: 'Hotjar', category: 'session-replay', match: ['static.hotjar.com'], ids: /hjid\s*[:=]\s*(\d{5,10})/g },
  { id: 'microsoft-clarity', name: 'Microsoft Clarity', category: 'session-replay', match: ['clarity.ms/tag'] },
  { id: 'fullstory', name: 'FullStory', category: 'session-replay', match: ['edge.fullstory.com', 'fullstory.com/s/fs.js'] },
  { id: 'logrocket', name: 'LogRocket', category: 'session-replay', match: ['cdn.logrocket.io', 'cdn.lr-ingest.io', 'cdn.lr-in.com'] },
  { id: 'mouseflow', name: 'Mouseflow', category: 'session-replay', match: ['cdn.mouseflow.com'] },
  { id: 'smartlook', name: 'Smartlook', category: 'session-replay', match: ['web-sdk.smartlook.com', 'rec.smartlook.com'] },
  { id: 'lucky-orange', name: 'Lucky Orange', category: 'session-replay', match: ['tools.luckyorange.com', 'luckyorange.net'] },
  // Other common embeds
  { id: 'recaptcha', name: 'Google reCAPTCHA', category: 'other', match: ['google.com/recaptcha', 'gstatic.com/recaptcha', 'recaptcha.net/recaptcha'] },
  { id: 'turnstile', name: 'Cloudflare Turnstile', category: 'other', match: ['challenges.cloudflare.com/turnstile'] },
  { id: 'stripe-js', name: 'Stripe.js', category: 'other', match: ['js.stripe.com'] },
  { id: 'calendly', name: 'Calendly embed', category: 'other', match: ['assets.calendly.com', 'calendly.com/assets/external/widget'] },
  { id: 'youtube', name: 'YouTube embed', category: 'other', match: ['youtube.com/embed/', 'youtube-nocookie.com/embed/'] },
];
