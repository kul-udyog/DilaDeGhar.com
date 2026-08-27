// ============================================================
// Truecaller verification support — ADD this to your EXISTING
// Apps Script project (the one behind LEADS_ENDPOINT in index.html).
// ============================================================
//
// What this does:
//   1) Receives Truecaller's server-to-server callback (a POST) when a
//      website visitor completes or declines verification on their phone,
//      and caches the result for a few minutes.
//   2) Lets the website poll (GET, JSONP) for that result while the
//      visitor is looking at the "Verifying with Truecaller…" screen.
//
// What this does NOT do: it does not write anything to your Leads sheet
// itself. Once the browser sees a "verified" result, it calls your
// EXISTING lead-submission code path (the same one already used for the
// manual name+phone form) with the verified name/phone, tagged
// "(Truecaller verified)" in the Interest column — so verified leads land
// in your sheet exactly like every other lead, through code you already
// have and already trust.

var TRUECALLER_CACHE_TTL_SECONDS = 300; // 5 minutes — comfortably longer than the ~20s poll window

/**
 * STEP 1 — Call this from the VERY TOP of your existing doPost(e),
 * before any of your current lead-handling code:
 *
 *   function doPost(e) {
 *     var tcResponse = handleTruecallerCallbackIfApplicable_(e);
 *     if (tcResponse) return tcResponse;
 *
 *     // ... all of your existing doPost code continues here, unchanged ...
 *   }
 *
 * This function returns `null` (and does nothing) for every request that
 * ISN'T a Truecaller callback, so it's safe to add without touching the
 * rest of your existing logic — normal lead submissions fall straight
 * through untouched.
 */
function handleTruecallerCallbackIfApplicable_(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return null; // not JSON — definitely not a Truecaller callback
  }

  // Truecaller's callback payloads always include "requestId" plus either
  // "status" or "accessToken". Your normal lead payloads never include a
  // "requestId" field, so this check can't collide with a real lead.
  if (!body || !body.requestId || (!body.status && !body.accessToken)) {
    return null;
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'tc_' + body.requestId;

  // Handshake sent the instant the Truecaller app opens on the visitor's phone.
  if (body.status === 'flow_invoked') {
    cache.put(cacheKey, JSON.stringify({ status: 'flow_invoked' }), TRUECALLER_CACHE_TTL_SECONDS);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  }

  // Sent if the visitor dismisses the Truecaller prompt / picks "enter manually".
  if (body.status === 'user_rejected') {
    cache.put(cacheKey, JSON.stringify({ status: 'rejected' }), TRUECALLER_CACHE_TTL_SECONDS);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  }

  // Sent if the visitor taps "Continue" — this is the success case.
  if (body.accessToken && body.endpoint) {
    try {
      var resp = UrlFetchApp.fetch(body.endpoint, {
        headers: { Authorization: 'Bearer ' + body.accessToken },
        muteHttpExceptions: true
      });
      var profile = JSON.parse(resp.getContentText());
      var rawPhone = (profile.phoneNumbers && profile.phoneNumbers[0]) || '';
      var phone = rawPhone ? '+' + rawPhone : '';
      var first = (profile.name && profile.name.first) || '';
      var last = (profile.name && profile.name.last) || '';
      var name = (first + ' ' + last).trim();

      cache.put(cacheKey, JSON.stringify({ status: 'verified', name: name, phone: phone }), TRUECALLER_CACHE_TTL_SECONDS);
    } catch (err) {
      cache.put(cacheKey, JSON.stringify({ status: 'error' }), TRUECALLER_CACHE_TTL_SECONDS);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * STEP 2 — doGet
 *
 * If your script does NOT already have a doGet(e) function, add this
 * whole function as-is (your site currently only POSTs, so this is the
 * likely case).
 *
 * If you DO already have a doGet(e) for something else, don't add a
 * second one (Apps Script won't allow two functions with the same name)
 * — instead, add just the "if (e.parameter.action === ...)" block below
 * as the FIRST thing inside your existing doGet, same idea as Step 1.
 */
function doGet(e) {
  if (e.parameter.action === 'truecallerStatus') {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('tc_' + e.parameter.requestId);
    var result = cached ? JSON.parse(cached) : { status: 'pending' };
    var callback = e.parameter.callback || 'callback';
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ... if you already have other doGet logic for something else, keep it here ...
  return ContentService.createTextOutput('OK');
}
