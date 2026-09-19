/* tracking.js — the Google tag for the PUBLIC site: Google Analytics, Google Ads
 * conversions, and remembering which ad click a quote came from.
 *
 * ⭐ WHY THIS FILE EXISTS (2026-09-19). Dax: "we need to get google ads running,
 * make whatever modifications to make sure google ads are perfectly good and if we
 * are then ill decide the daily spending." Until today the site measured nothing:
 * G-44SCT38S6E sat in the Firebase config and nothing ever started it, and there was
 * no Google Ads tag at all. Ads bought without this is money with no way to tell
 * whether a single quote came from it — and no way for Google's bidding to learn
 * which searches turn into customers. Deciding a daily budget needs this first.
 *
 * WHAT IT COUNTS
 *   quote   — the Free Quote form saved a quote   (the conversion that matters)
 *   contact — the Get In Touch form sent a message
 *   call    — somebody tapped a tel: link on the site
 * Each goes to Analytics as an event and, once the Ads IDs below are filled in, to
 * Google Ads as a conversion.
 *
 * ⚠ LOADED AS A PLAIN <script> IN THE HEAD OF index.html ONLY, root-absolute for the
 * same reason as /js/money.js (the page answers at /q/<token> too). admin.html,
 * employee.html and connections.html must never load it: staff opening the office
 * screens all day would swamp the visitor numbers and could teach Ads that "an
 * office worker" is what a customer looks like. ads-tracking.test.js enforces both.
 *
 * ⛔ A LINK THAT CARRIES A CUSTOMER'S TOKEN IS NEVER TAGGED. /q/<token>, /r/<token>,
 * /s/<token>, ?ref=, ?p=, and any hash with token=/t=/p= are somebody's private key
 * to their own account — the tag would post the whole address to Google. Those
 * visitors are existing customers and friends of customers, not ad traffic, so the
 * tag is simply not started for them. Everybody else gets page_location with the
 * hash stripped and only the ad/utm parameters kept (cleanLocation).
 *
 * ⚠ OFF EVERYWHERE BUT THE REAL DOMAIN. Netlify deploy previews, localhost and the
 * Playwright server all run this file; counting them would put test clicks in the
 * numbers the budget is decided on.
 */
(function(root){
  'use strict';

  /* ⭐ THE ONLY LINES TO EDIT WHEN THE ADS ACCOUNT IS SET UP.
     ads      — the account's conversion ID, 'AW-' followed by digits. Found in Google
                Ads → Goals → a conversion action → Tag setup → "Install the tag
                yourself". Empty means Analytics runs and Ads is dormant.
     labels   — the part after the slash in each conversion's send_to
                ('AW-123/AbC-dEfG' → 'AbC-dEfG'). An empty label sends nothing for
                that event, so a half-filled table is safe.
     ⭐ FILLED IN 2026-09-19 from account 288-126-7540: the "Website quote request"
     conversion action (goal: Request quotes, Primary, count One, 90-day window).
     contact and call have no conversion action yet; they stay Analytics-only. */
  var CONFIG = {
    ga4: 'G-44SCT38S6E',
    ads: 'AW-961456324',
    labels: { quote: 'EJXXCM638v0cEMTRusoD', contact: '', call: '' },
    hosts: ['highlightingutah.com', 'www.highlightingutah.com']
  };

  /* The parameters an ad click or a tagged link arrives with. gclid is Google's own
     click id; gbraid/wbraid replace it on iPhones that block it. */
  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var PRIVATE_PATH = /^\/(q|r|s)\//;
  var PRIVATE_QUERY = ['ref', 'p', 'token', 't'];
  var PRIVATE_HASH = /[?&](token|t|p)=/;

  /* ⚠ 90 DAYS BECAUSE THAT IS GOOGLE'S LONGEST CLICK WINDOW. People see an ad in
     October, think about it, and ask for a quote a fortnight later from a bookmark.
     localStorage, not sessionStorage, for exactly that reason — unlike the referral
     token, a stale ad click cannot cost anybody money; it only labels a quote. */
  var AD_STORE = 'huAdClick';
  var AD_DAYS = 90;
  var DAY_MS = 86400000;

  function parseQuery(search){
    var out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function(pair){
      if(!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i);
      var v = i === -1 ? '' : pair.slice(i + 1);
      try{ k = decodeURIComponent(k); v = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch(e){ /* quiet on purpose: a malformed escape is kept as typed; it is only ever compared, never run */ }
      out[k] = v;
    });
    return out;
  }

  function carriesPrivateToken(loc){
    if(PRIVATE_PATH.test(loc.pathname || '')) return true;
    var q = parseQuery(loc.search);
    for(var i = 0; i < PRIVATE_QUERY.length; i++){
      if(Object.prototype.hasOwnProperty.call(q, PRIVATE_QUERY[i])) return true;
    }
    return PRIVATE_HASH.test(loc.hash || '');
  }

  /* The address Google is told. Hash dropped, every query parameter dropped except
     the ad ones, and a /q/ /r/ /s/ path cut back to its prefix as a second lock
     behind carriesPrivateToken. */
  function cleanLocation(loc){
    var m = PRIVATE_PATH.exec(loc.pathname || '/');
    var path = m ? '/' + m[1] + '/' : (loc.pathname || '/');
    var q = parseQuery(loc.search);
    var kept = CLICK_KEYS.filter(function(k){ return q[k]; })
      .map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); });
    return loc.origin + path + (kept.length ? '?' + kept.join('&') : '');
  }

  function readAdClick(search, now){
    var q = parseQuery(search);
    var hit = null;
    CLICK_KEYS.forEach(function(k){
      if(q[k]){ hit = hit || {}; hit[k] = String(q[k]).slice(0, 200); }
    });
    if(hit) hit.landedAt = new Date(now).toISOString();
    return hit;
  }

  function rememberAdClick(storage, click){
    if(!click) return;
    try{ storage.setItem(AD_STORE, JSON.stringify(click)); }
    catch(e){ /* quiet on purpose: private browsing. The quote still goes through, just unlabelled */ }
  }

  /* What goes on the quote as `adClick`, or null. ⚠ NULL IS OMITTED BY THE CALLER,
     never written as an empty object — same reasoning as referredByToken: an empty
     field on every quote would read as a click that failed to record. */
  function adClickForQuote(storage, now){
    try{
      var raw = storage.getItem(AD_STORE);
      if(!raw) return null;
      var c = JSON.parse(raw);
      var at = Date.parse(c && c.landedAt);
      if(!at || now - at > AD_DAYS * DAY_MS) return null;
      return c;
    }catch(e){ return null; }
  }

  /* Enhanced conversions want E.164. The form takes whatever was typed. */
  function e164(phone){
    var d = String(phone || '').replace(/\D/g, '');
    if(d.length === 10) return '+1' + d;
    if(d.length === 11 && d.charAt(0) === '1') return '+' + d;
    return '';
  }

  var enabled = false;
  function gtag(){ root.dataLayer.push(arguments); }

  function adsConversion(label, extra){
    if(!enabled || !CONFIG.ads || !label) return;
    gtag('event', 'conversion', Object.assign({ send_to: CONFIG.ads + '/' + label }, extra || {}));
  }

  function start(win, doc){
    var loc = win.location;
    var now = Date.now();
    if(CONFIG.hosts.indexOf(loc.hostname) === -1) return;
    if(carriesPrivateToken(loc)) return;
    try{ rememberAdClick(win.localStorage, readAdClick(loc.search, now)); }
    catch(e){ /* quiet on purpose: storage blocked — the tag still runs, the quote is just unlabelled */ }

    root.dataLayer = root.dataLayer || [];
    var s = doc.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.ads || CONFIG.ga4);
    doc.head.appendChild(s);

    var here = cleanLocation(loc);
    gtag('js', new Date());
    gtag('config', CONFIG.ga4, { page_location: here });
    if(CONFIG.ads) gtag('config', CONFIG.ads, { page_location: here, allow_enhanced_conversions: true });
    enabled = true;

    /* One listener for every tel: link, present and future — the phone number is
       written into the header, the footer, the contact page and several generated
       cards, and a per-link handler would miss whichever one is added next. */
    doc.addEventListener('click', function(ev){
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="tel:"]') : null;
      if(a) api.callClicked();
    }, true);
  }

  var api = {
    /* After the quote is SAVED, never on the button press: a submit that fails and
       says "please call instead" is not a lead, and counting it would pay Google
       for a failure. */
    quoteSubmitted: function(info){
      if(!enabled) return;
      info = info || {};
      var ud = {};
      if(info.email) ud.email = String(info.email).trim().toLowerCase();
      var ph = e164(info.phone);
      if(ph) ud.phone_number = ph;
      if(ud.email || ud.phone_number) gtag('set', 'user_data', ud);
      gtag('event', 'generate_lead', { form: 'quote' });
      /* transaction_id is the quote's own id, so a double-fire (a back button, a
         re-render) is counted once by Google rather than twice. */
      adsConversion(CONFIG.labels.quote, info.id ? { transaction_id: String(info.id) } : null);
    },
    contactSent: function(){
      if(!enabled) return;
      gtag('event', 'generate_lead', { form: 'contact' });
      adsConversion(CONFIG.labels.contact);
    },
    callClicked: function(){
      if(!enabled) return;
      gtag('event', 'click_to_call', {});
      adsConversion(CONFIG.labels.call);
    },
    adClickForQuote: function(){
      try{ return adClickForQuote(root.localStorage, Date.now()); }catch(e){ return null; }
    },
    /* Exposed for ads-tracking.test.js; nothing in the page calls these. */
    _test: { CONFIG: CONFIG, cleanLocation: cleanLocation, carriesPrivateToken: carriesPrivateToken,
             readAdClick: readAdClick, adClickForQuote: adClickForQuote, e164: e164, start: start,
             isEnabled: function(){ return enabled; } }
  };
  root.huTrack = api;

  if(root.document && root.location){
    try{ start(root, root.document); }
    catch(e){ /* quiet on purpose: measurement must never be the reason the site fails to load */ }
  }
})(typeof window !== 'undefined' ? window : this);
