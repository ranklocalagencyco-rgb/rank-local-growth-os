// HTML fixtures for the challenge detector (RL-067). Not a test file (no .test suffix).
// Every challenge fixture is sanitized: no session, ray, incident or challenge token values, only the structural identifiers the
// detector reads. Placeholder values are the literal string "REDACTED".

/**
 * Reconstruction of the document that caused the false SC Roofing audit on 2026-09-19. The original HTML was never stored (the
 * crawler keeps parsed facts only), so this is rebuilt from the facts that run recorded: HTTP 200, title "One moment, please...",
 * 8 visible words, 0 links, no H1, and a body that is only a verification message plus an inline reload script. It carries no vendor
 * marker on purpose: the regression must hold on the title + structure alone.
 */
export const scRoofingInterstitial = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>One moment, please...</title>
<style>body{background:#f6f7f8;font-family:sans-serif;text-align:center}.loader{margin:40px auto;width:48px;height:48px;border:4px solid #ccc;border-top-color:#333;border-radius:50%}</style>
</head>
<body>
<div class="loader"></div>
<p>Please wait while your request is being verified...</p>
<script>(function(){var token="REDACTED";setTimeout(function(){window.location.reload();},5000);})();</script>
</body>
</html>`;

/** Cloudflare managed-challenge shape: has an H1 and ~30 words, so only the vendor internals identify it reliably. */
export const cloudflareChallenge = `<!DOCTYPE html>
<html lang="en-US">
<head>
<title>Just a moment...</title>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="390">
</head>
<body class="no-js">
<div class="main-wrapper" role="main"><div class="main-content">
<h1 class="zone-name-title h1">example-roofing.co.uk</h1>
<h2 class="h2" id="challenge-running">Verifying you are human. This may take a few seconds.</h2>
<div id="challenge-stage"></div>
<div id="challenge-body-text" class="core-msg spacer">example-roofing.co.uk needs to review the security of your connection before proceeding.</div>
<noscript><div id="challenge-error-title"><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></div></noscript>
</div></div>
<script>(function(){window._cf_chl_opt={cvId:'3',cZone:'example-roofing.co.uk',cType:'managed',cRay:'REDACTED',cH:'REDACTED'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=REDACTED';document.getElementsByTagName('head')[0].appendChild(a);}());</script>
<div class="footer" role="contentinfo"><div class="footer-inner">Performance &amp; security by <a rel="noopener noreferrer" href="https://www.cloudflare.com/" target="_blank">Cloudflare</a></div></div>
</body>
</html>`;

/** Browser-verification redirect page with a known vendor internal (Sucuri CloudProxy) and an unremarkable title. */
export const sucuriVerification = `<html><head><title>You are being redirected...</title>
<noscript>Javascript is required. Please enable javascript before you are allowed to see this page.</noscript>
<script>var s={},u,c,U,r,i,l=0,a,e=eval,w=String.fromCharCode,sucuri_cloudproxy_js='',S='REDACTED';</script>
</head><body></body></html>`;

/** No vendor marker at all: a challenge title on a document that contains nothing else. */
export const challengeTitleTinyBody = `<html><head><title>Checking your browser</title></head><body><div class="spinner"></div><p>This process is automatic.</p></body></html>`;

/**
 * A vendor block document that is larger than the structural gate: >80 words and >2 same-site links (help, status, contact).
 * Only the challenge-only internal identifies it.
 */
export const largeChallengeWithStrongMarker = `<html><head><title>example-roofing.co.uk</title></head><body>
<h1>Please confirm you are a person</h1>
<p>${"We have detected unusual traffic from your network and need to confirm that this request was made by a person and not by an automated program before the page can be shown. ".repeat(4)}</p>
<ul><li><a href="/help/why-am-i-seeing-this">Why am I seeing this?</a></li><li><a href="/help/accessibility">Accessibility options</a></li><li><a href="/status">Service status</a></li><li><a href="/contact-support">Contact support</a></li></ul>
<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=REDACTED&amp;hash=REDACTED" title="DataDome CAPTCHA" width="100%" height="400"></iframe>
</body></html>`;

// ---------------------------------------------------------------------------
// Ordinary pages that must never be detected
// ---------------------------------------------------------------------------

/** Small brochure homepage: little text, a few links, an H1. Thin, but it is the website. */
export const sparseTradeHomepage = `<html lang="en"><head><title>Smith Roofing | Roofers in Uxbridge</title><meta name="description" content="Family-run roofers in Uxbridge."></head><body>
<header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
<h1>Roofers in Uxbridge</h1><p>Family-run roofing company covering Uxbridge and Hillingdon. Call us for a free quote.</p><a href="tel:01895123456">01895 123456</a>
</body></html>`;

/** WordPress homepage behind Cloudflare: carries the JavaScript-detections script and a Turnstile-protected form, like many real sites. */
export const wordpressHomepage = `<html lang="en-GB"><head><title>Home - Example Roofing Ltd</title><meta name="generator" content="WordPress 6.6"><link rel="canonical" href="https://example-roofing.co.uk/"></head><body class="home page-template">
<header class="site-header"><nav><ul><li><a href="/">Home</a></li><li><a href="/services/">Services</a><ul><li><a href="/services/flat-roofing/">Flat roofing</a></li><li><a href="/services/roof-repairs/">Roof repairs</a></li></ul></li><li><a href="/areas-we-cover/">Areas we cover</a></li><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li></ul></nav></header>
<main><h1>Roofing contractors in West London</h1><p>${"Example Roofing Ltd has repaired and replaced roofs across West London for over twenty years, from slipped tiles to full flat roof replacements. ".repeat(6)}</p>
<form action="/contact/" method="post"><input name="name"><div class="cf-turnstile" data-sitekey="REDACTED"></div><button type="submit">Request a quote</button></form></main>
<footer class="site-footer"><a href="/privacy-policy/">Privacy</a></footer>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>(function(){var d=document,s=d.createElement('script');s.src='/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js';d.getElementsByTagName('head')[0].appendChild(s);})();</script>
</body></html>`;

/** Client-rendered app shell: near-empty, no links, but no challenge signal. Stays the SPA classifier's business. */
export const spaShell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Roofing</title><meta name="viewport" content="width=device-width"><script type="module" crossorigin src="/assets/index-4f3a9c21.js"></script></head><body><div id="root"></div></body></html>`;

/** Holding page during site work. Says "please wait" and has almost no text, but nothing identifies a verification step. */
export const maintenancePage = `<html><head><title>Site under maintenance</title></head><body><h1>We'll be back soon</h1><p>Our website is being updated. Please wait a little while and try again, or call us on 01895 123456.</p></body></html>`;

/** Ordinary content page whose copy happens to contain "please wait" and "one moment". */
export const pleaseWaitInBodyCopy = `<html lang="en"><head><title>Emergency roof repairs | Example Roofing</title></head><body>
<nav><a href="/">Home</a><a href="/services">Services</a><a href="/emergency">Emergency</a><a href="/contact">Contact</a></nav>
<h1>Emergency roof repairs</h1><p>${"If water is coming through the ceiling, please wait for our engineer in a safe room and move valuables away from the leak. One moment of care now prevents further damage. ".repeat(5)}</p>
</body></html>`;

/** Cookie-consent gate: tiny, one link, a button. Not a verification step. */
export const cookieConsentPage = `<html><head><title>Cookie preferences</title></head><body><div class="cookie-banner"><p>We use cookies to improve your experience on this website.</p><a href="/privacy-policy">Privacy policy</a><button type="button">Accept all</button><button type="button">Reject</button></div></body></html>`;

/** Near-empty page whose only challenge-related content is a CAPTCHA widget on a form: a weak marker alone. */
export const tinyTurnstileForm = `<html><head><title>Get a quote</title></head><body><h1>Get a quote</h1><form action="/quote" method="post"><input name="email"><div class="cf-turnstile" data-sitekey="REDACTED"></div><button>Send</button></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`;

/** A page with 300 words and full navigation that merely uses a challenge phrase as its title: outside the structural gate. */
export const challengeTitleOnRealPage = `<html><head><title>Just a moment...</title></head><body><nav><a href="/">Home</a><a href="/services">Services</a><a href="/about">About</a><a href="/contact">Contact</a></nav><h1>Just a moment</h1><p>${"Take just a moment to read how we look after your roof through the winter months. ".repeat(20)}</p></body></html>`;

// ---------------------------------------------------------------------------
// Below-blocking confidence
// ---------------------------------------------------------------------------

/** Medium: verification wording + a CAPTCHA widget on a near-empty page, with an ordinary title and no vendor internal. */
export const mediumVerificationPage = `<html><head><title>Example Roofing</title></head><body><p>Please verify you are human to continue.</p><div class="g-recaptcha" data-sitekey="REDACTED"></div><script src="https://www.google.com/recaptcha/api.js"></script></body></html>`;

/** Low: a challenge title inside the gate, but the page has an H1 and ordinary copy, and nothing corroborates it. */
export const lowTitleOnlyPage = `<html><head><title>Just a moment...</title></head><body><h1>Example Roofing</h1><p>Our new website is nearly ready. Call 01895 123456 for roof repairs in Uxbridge in the meantime, or email the office and we will reply the same day.</p></body></html>`;
