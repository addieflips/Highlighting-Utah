/**
 * Highlighting Utah — inbound texts, from Google Voice into the admin Inbox.
 *
 * WHAT THIS IS FOR
 * We text from Google Voice, which has no send API, so nothing in the app can send a
 * text. Replies are the half that CAN be automated: Google Voice will forward every
 * inbound text to email, and this script reads those and posts them to the
 * `inboundText` Cloud Function, which raises a note in the admin Inbox and — the point
 * of the whole exercise — honours a STOP.
 *
 * Before this existed, a STOP reply was a message sitting in Google Voice that somebody
 * had to notice. Nobody was watching. Twilio used to catch it (error 21610) and the
 * quote screen recorded it; Twilio is gone.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SETUP, in order. It takes about ten minutes.
 *
 * 1. Google Voice → Settings → Messages → turn ON "Forward messages to email".
 *    Do this on the account that owns the business number (service@highlightingutah.com).
 *
 * 2. Deploy the function and set its token:
 *       firebase functions:secrets:set INBOUND_TEXT_TOKEN     (any long random string)
 *       firebase deploy --only functions:inboundText
 *    Copy the URL it prints.
 *
 * 3. script.google.com → New project → paste this file in.
 *
 * 4. Project Settings → Script Properties, add two:
 *       HU_INBOUND_URL    the URL from step 2
 *       HU_INBOUND_TOKEN  the same string you set as INBOUND_TEXT_TOKEN
 *
 * 5. Run `dryRun` FIRST and read the log. ⚠ DO NOT SKIP THIS. It shows exactly what
 *    would be posted for the newest few messages without writing anything anywhere. If
 *    the numbers or the message text come out wrong, fix `parseVoiceEmail` below — that
 *    is what it is for, and it is why the parsing lives here rather than on the server.
 *
 * 6. Once dryRun looks right: Triggers → Add Trigger → `pollGoogleVoice`, time-driven,
 *    every 5 minutes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ THE EMAIL FORMAT IS GOOGLE'S TO CHANGE AND IS NOT DOCUMENTED. That is the whole
 * reason this file exists separately from the Cloud Function: when Google changes the
 * wording, this is a two-minute fix in a web editor, not a redeploy. The function it
 * posts to is handed a number and a body it can trust, and is tested on its own.
 *
 * ⚠ AND IT FAILS TOWARDS TELLING SOMEBODY. A message it cannot parse is NOT dropped and
 * NOT marked done — it is posted with whatever it could find and flagged, and left
 * unlabelled so the next run tries again. A silently skipped message could be a STOP.
 */

/** Gmail search for the forwarded texts. Both senders are used in the wild. */
var GV_QUERY = '(from:txt.voice.google.com OR from:voice-noreply@google.com OR ' +
               'from:no-reply@voice.google.com) -label:hu-text-done';
var DONE_LABEL = 'hu-text-done';
/** Kept small: a trigger every 5 minutes has no reason to sweep hundreds. */
var MAX_THREADS = 25;

function prop_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Script Property ' + name + ' is not set — see SETUP step 4.');
  return v;
}

/**
 * Pulls the sender's number and the message text out of one forwarded email.
 *
 * ⚠ THE REPLY ADDRESS IS TRIED FIRST AND IS THE ONLY RELIABLE SOURCE. Google builds it
 * as <yournumber>.<theirnumber>.<key>@txt.voice.google.com — structured data, not prose,
 * so it survives every wording change. The subject and body are guesses and are only
 * reached when that address is absent.
 *
 * Returns {number, text, how} — `how` says which source won, which is what makes
 * dryRun worth reading.
 */
function parseVoiceEmail(msg) {
  var replyTo = '';
  try { replyTo = msg.getReplyTo() || ''; } catch (e) { replyTo = ''; }
  var from = msg.getFrom() || '';
  var subject = msg.getSubject() || '';
  var body = '';
  try { body = msg.getPlainBody() || ''; } catch (e) { body = ''; }

  var number = '';
  var how = '';

  // 1. The per-conversation reply address: <ours>.<theirs>.<key>@txt.voice.google.com
  var addr = (replyTo + ' ' + from).match(/(\d{10,11})\.(\d{10,11})\.[^@\s]+@txt\.voice\.google\.com/);
  if (addr) { number = addr[2]; how = 'reply-address'; }

  // 2. The subject line, e.g. "SMS from +1 801 555 1234" / "New text message from ...".
  if (!number) {
    var sub = subject.match(/(?:from|From)\D{0,12}(\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4})/);
    if (sub) { number = sub[1]; how = 'subject'; }
  }

  // 3. The body, same shape. Last resort — the body also quotes OUR number back.
  if (!number) {
    var b = body.match(/(\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4})/);
    if (b) { number = b[1]; how = 'body (guess)'; }
  }

  /* The message itself. Google puts the text above a block of boilerplate about
     replying and account settings; everything from the first of those markers on is
     dropped. Unrecognised boilerplate is left in rather than risking cutting the
     customer's actual words — a note with a footer is readable, a truncated one is not. */
  var text = body;
  var cuts = [
    'To respond to this text message',
    'YOUR ACCOUNT',
    'Sent from Google Voice',
    'This message was sent to you',
    'https://voice.google.com'
  ];
  for (var i = 0; i < cuts.length; i++) {
    var at = text.indexOf(cuts[i]);
    if (at > 0) text = text.slice(0, at);
  }

  return { number: digits_(number), text: text.trim(), how: how || 'nothing found' };
}

function digits_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d;
}

function post_(payload) {
  var res = UrlFetchApp.fetch(prop_('HU_INBOUND_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-hu-token': prop_('HU_INBOUND_TOKEN') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

/**
 * ⚠ READ THE LOG BEFORE ARMING THE TRIGGER. Writes nothing, posts nothing, marks
 * nothing — it only shows what the parser makes of the newest few messages.
 */
function dryRun() {
  var threads = GmailApp.search(GV_QUERY, 0, 5);
  if (!threads.length) {
    Logger.log('No matching messages. Either forwarding is not on yet, or nobody has ' +
               'texted since it was. Text the business number from your own phone and re-run.');
    return;
  }
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var p = parseVoiceEmail(m);
      Logger.log('---\nsubject : %s\nfound by: %s\nnumber  : %s\ntext    : %s',
        m.getSubject(), p.how, p.number || '(NONE — this one would be flagged)',
        p.text.slice(0, 300));
    });
  });
  Logger.log('\n--- nothing was posted or marked. If the numbers and text above are ' +
             'right, add the pollGoogleVoice trigger. ---');
}

/** The trigger target. */
function pollGoogleVoice() {
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var threads = GmailApp.search(GV_QUERY, 0, MAX_THREADS);
  threads.forEach(function (thread) {
    var allOk = true;
    thread.getMessages().forEach(function (m) {
      var p = parseVoiceEmail(m);
      if (!p.number) {
        /* ⛔ NOT DROPPED AND NOT MARKED DONE. An unparseable message could be a STOP,
           so it is posted with the raw body under a placeholder number and left for the
           next run as well — a duplicate note is a nuisance, a missed STOP is a customer
           we keep texting after they asked us not to. The function de-duplicates on the
           message id, so the retry is free. */
        var flagged = post_({
          messageId: m.getId(),
          fromNumber: '0000000000',
          text: '[COULD NOT READ THE NUMBER — the raw email follows]\n\n' + p.text.slice(0, 1500)
        });
        Logger.log('unparsed message %s -> %s', m.getId(), flagged.code);
        allOk = false;
        return;
      }
      var r = post_({ messageId: m.getId(), fromNumber: p.number, text: p.text });
      if (r.code !== 200) {
        /* Left unlabelled on purpose so the next run tries it again. */
        Logger.log('post failed for %s: %s %s', m.getId(), r.code, r.body);
        allOk = false;
      }
    });
    /* Only a thread whose every message landed is marked done. */
    if (allOk) thread.addLabel(label);
  });
}
