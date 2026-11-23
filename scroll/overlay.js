// Milo's Scroll: overlay. Dark glass pill: Milo, a court phrase, the project, an action button.
// Run by scroll.sh: osascript -l JavaScript overlay.js - <slot> <bundle-id> <dir>  (hook JSON on stdin)
// Blue = news. Orange = Claude needs you (question / permission).

ObjC.import('Cocoa');

var PHRASES = {
  complete:   ['It is done, my lord', 'The work is finished', 'Victory, my lord', 'The battle is won',
               'Your orders have been carried out', 'The ravens bring good news', 'The banners fly high tonight',
               'The keep stands. The work is done', 'Word from the field: it is done', 'The deed is done'],
  question:   ['My lord, a word', 'Your counsel is needed', 'A messenger awaits your reply',
               'The steward awaits your answer', 'A choice must be made, my lord', 'A question for the council'],
  permission: ['Your seal is needed, my lord', 'None pass without your leave', 'The gates stay shut without your word',
               'The guards await your command', 'Give the order, my lord'],
  idle:       ['The hall is quiet, my lord', 'The men await your orders', 'All is still at the keep', 'The hearth burns low'],
  limit:      ['The stores run low, my lord', 'Supplies grow thin', 'The scribes trim the scrolls', 'The ledger is near full']
};
var BUTTONS = { complete: 'Open', question: 'Answer', permission: 'Review', idle: 'Open', limit: 'Open' };
var DEFAULTS = { enabled: true, position: 'top-center', seconds: 4, all_screens: true, only_when_away: true };

function readText(path) {
  var s = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
  return s.isNil() ? null : ObjC.unwrap(s);
}
function writeText(path, text) {
  $(text).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, null);
}
function rgb(hex, a) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(
    parseInt(hex.substr(1, 2), 16) / 255, parseInt(hex.substr(3, 2), 16) / 255,
    parseInt(hex.substr(5, 2), 16) / 255, a === undefined ? 1 : a);
}
function label(text, font, color, frame) {
  var f = $.NSTextField.alloc.initWithFrame(frame);
  f.setStringValue($(text));
  f.setBezeled(false); f.setDrawsBackground(false); f.setEditable(false); f.setSelectable(false);
  f.setTextColor(color); f.setFont(font);
  f.setLineBreakMode($.NSLineBreakByTruncatingTail); f.cell.setWraps(false);
  return f;
}

// Hook event -> scroll type. Returns '' for events Milo stays quiet on.
function scrollType(hook) {
  if (hook.test) return hook.test;
  switch (hook.hook_event_name) {
    case 'Stop': return 'complete';
    case 'PermissionRequest': return 'permission';
    case 'PreCompact': return 'limit';
    case 'Notification':
      if (hook.notification_type === 'elicitation_dialog') return 'question';
      if (hook.notification_type === 'idle_prompt') return 'idle';
  }
  return '';
}

// Session Deck (Tools/Session Deck) writes state.json about once a second while it runs.
function deckAccepting() {
  try {
    var st = JSON.parse(readText(ObjC.unwrap($.NSHomeDirectory()) +
      '/Library/Application Support/SessionDeck/state.json') || '{}');
    return st.accepting === true && Date.now() - (st.updatedAt || 0) < 5000;
  } catch (e) { return false; }
}

function readStdin() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var s = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  return s.isNil() ? '' : ObjC.unwrap(s);
}

function run(argv) {
  var hook = {};
  // "-" = hook JSON on stdin (scroll.sh); a JSON argument still works for older callers
  try { hook = JSON.parse((argv[0] === '-' ? readStdin() : argv[0]) || '{}'); } catch (e) {}
  var slot = parseInt(argv[1], 10) || 0;
  var bundleId = argv[2] || '';
  var dir = ObjC.unwrap($(argv[3] || '').stringByStandardizingPath) ||
            ObjC.unwrap($.NSHomeDirectory()) + '/.claude/milos-scroll';

  var cfg = DEFAULTS;
  try { cfg = Object.assign({}, DEFAULTS, JSON.parse(readText(dir + '/config.json') || '{}')); } catch (e) {}
  if (!cfg.enabled && !hook.test) return;

  var type = scrollType(hook);
  if (!PHRASES[type]) return;
  // events: which kinds of scroll to show (Milo Kit settings). Missing = all.
  if (!hook.test && Array.isArray(cfg.events) && cfg.events.indexOf(type) < 0) return;

  // Session Deck is up (you are away from VS Code): it shows finishes, questions and permission
  // prompts itself and turns into Milo's pop when every session is done. Only compaction stays here.
  if (!hook.test && type !== 'limit' && deckAccepting()) return;

  // Claude re-sends idle_prompt every minute while you are away. Stay quiet for an hour after "complete".
  var session = String(hook.session_id || '').replace(/[^\w-]/g, '');
  var stamp = dir + '/state/' + session;
  var now = Date.now() / 1000;
  if (session && type === 'complete') {
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(dir + '/state'), true, $(), null);
    writeText(stamp, String(now));
  }
  if (session && type === 'idle' && now - (parseFloat(readText(stamp)) || 0) < 3600) return;

  // You are already in the app Claude runs in (VS Code, terminal): stay quiet.
  if (cfg.only_when_away && !hook.test && bundleId) {
    var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    if (front && !front.isNil() && ObjC.unwrap(front.bundleIdentifier) === bundleId) return;
  }

  var pool = PHRASES[type];
  var phrase = pool[Math.floor(Math.random() * pool.length)];
  var realm = hook.test ? "Milo's Scroll" : String(hook.cwd || '').split('/').filter(Boolean).pop() || '';
  var urgent = type === 'question' || type === 'permission';
  // Blue = news. Orange = Claude needs you.
  var tint = urgent ? rgb('#7a3510', 0.5) : rgb('#14336e', 0.5);
  var edge = urgent ? rgb('#e8875f', 0.45) : rgb('#82a9f5', 0.35);
  var action = BUTTONS[type] || 'Open';

  $.NSApplication.sharedApplication;
  $.NSApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  // sound: 'chime' plays a soft built-in macOS sound once.
  if (cfg.sound === 'chime') { var snd = $.NSSound.soundNamed($('Glass')); if (snd && !snd.isNil()) { snd.setVolume(0.35); snd.play; } }

  // Pill: full radius, neutral dark glass, hairline edge.
  var W = 480, H = 64, R = H / 2, margin = 10, pad = 12;
  var dismissName = $('milos-scroll.dismiss.' + slot);
  // Click: bring the editor forward and close this scroll on every screen.
  ObjC.registerSubclass({
    name: 'ScrollClick', superclass: 'NSObject',
    methods: { 'click:': { types: ['void', ['id']], implementation: function () {
      if (bundleId) {
        var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(bundleId));
        if (apps.count > 0) apps.objectAtIndex(0).activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
      }
      $.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObject(dismissName, $());
      $.NSApp.terminate(null);
    } } }
  });
  ObjC.registerSubclass({
    name: 'ScrollDismiss', superclass: 'NSObject',
    methods: { 'dismiss:': { types: ['void', ['id']], implementation: function () { $.NSApp.terminate(null); } } }
  });
  var clicker = $.ScrollClick.alloc.init;
  var dismisser = $.ScrollDismiss.alloc.init;
  $.NSDistributedNotificationCenter.defaultCenter.addObserverSelectorNameObject(dismisser, 'dismiss:', dismissName, $());

  var screens = $.NSScreen.screens, first = 0, last = screens.count;
  if (!cfg.all_screens) {
    var m = $.NSEvent.mouseLocation;
    for (var s = 0; s < screens.count; s++) {
      var sf = screens.objectAtIndex(s).frame;
      if (m.x >= sf.origin.x && m.x <= sf.origin.x + sf.size.width && m.y >= sf.origin.y && m.y <= sf.origin.y + sf.size.height) { first = s; last = s + 1; break; }
    }
    if (last === screens.count && screens.count > 1) last = first + 1;
  }

  var titleFont = $.NSFont.systemFontOfSizeWeight(15, 0.4);
  var subFont = $.NSFont.systemFontOfSizeWeight(13, 0);
  var btnFont = $.NSFont.systemFontOfSizeWeight(13, 0.23);
  var milo = $.NSImage.alloc.initWithContentsOfFile($(dir + '/milo.png'));
  for (var i = first; i < last; i++) {
    var vf = screens.objectAtIndex(i).visibleFrame;
    var off = margin + slot * (H + margin);
    var pos = cfg.position;
    var x = pos.indexOf('left') >= 0 ? vf.origin.x + margin
          : pos.indexOf('right') >= 0 ? vf.origin.x + vf.size.width - W - margin
          : vf.origin.x + (vf.size.width - W) / 2;
    var y = pos.indexOf('bottom') === 0 ? vf.origin.y + off : vf.origin.y + vf.size.height - H - off;

    var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
      $.NSMakeRect(x, y, W, H), $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
    win.setOpaque(false);
    win.setBackgroundColor($.NSColor.clearColor);
    win.setHasShadow(true);
    win.setLevel($.NSStatusWindowLevel);
    win.setCollectionBehavior($.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorStationary);
    var view = win.contentView;
    view.wantsLayer = true;
    view.layer.cornerRadius = R;
    view.layer.masksToBounds = true;

    // Frosted glass, then a tinted NSBox on top. (Setting layer CGColor from JXA crashes osascript.)
    var glass = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));
    glass.setMaterial(13); glass.setBlendingMode(0); glass.setState(1);
    view.addSubview(glass);
    var card = $.NSBox.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));
    card.setBoxType(4); card.setTitlePosition(0);
    card.setFillColor(tint); card.setBorderColor(edge);
    card.setBorderWidth(1); card.setCornerRadius(R);
    view.addSubview(card);

    var textX = pad + 10;
    if (!milo.isNil()) {
      var icon = $.NSImageView.alloc.initWithFrame($.NSMakeRect(pad + 6, (H - 44) / 2, 56, 44));
      icon.setImage(milo);
      icon.setImageScaling($.NSImageScaleProportionallyUpOrDown);
      view.addSubview(icon);
      textX = pad + 6 + 56 + 12;
    }

    // Action pill on the right, outlined like a secondary button.
    var btnTextW = Math.ceil(ObjC.unwrap($(action).sizeWithAttributes($({ NSFont: btnFont })).width) || 40);
    var bW = btnTextW + 36, bH = 36;
    var bX = W - pad - 2 - bW, bY = (H - bH) / 2;
    var pill = $.NSBox.alloc.initWithFrame($.NSMakeRect(bX, bY, bW, bH));
    pill.setBoxType(4); pill.setTitlePosition(0);
    pill.setFillColor(rgb('#ffffff', 0.06)); pill.setBorderColor(rgb('#ffffff', 0.22));
    pill.setBorderWidth(1); pill.setCornerRadius(bH / 2);
    view.addSubview(pill);
    var btnH = btnFont.ascender - btnFont.descender + 2;
    // Centre by measured width: NSTextField alignment constants misbehave from JXA.
    var btnLabel = label(action, btnFont, rgb('#ffffff', 0.9), $.NSMakeRect(bX + (bW - btnTextW) / 2 - 2, bY + (bH - btnH) / 2, btnTextW + 4, btnH));
    view.addSubview(btnLabel);

    var textW = bX - textX - 12;
    var titleH = titleFont.ascender - titleFont.descender + 2;
    var subH = realm ? subFont.ascender - subFont.descender + 2 : 0;
    var baseY = (H - titleH - subH) / 2;
    if (realm) view.addSubview(label(realm, subFont, rgb('#ffffff', 0.55), $.NSMakeRect(textX, baseY, textW, subH)));
    view.addSubview(label(phrase, titleFont, rgb('#ffffff'), $.NSMakeRect(textX, baseY + subH, textW, titleH)));

    var btn = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));
    btn.setTitle($('')); btn.setBordered(false); btn.setTransparent(true);
    btn.setTarget(clicker); btn.setAction('click:');
    view.addSubview(btn);

    win.orderFrontRegardless;
  }

  var secs = parseFloat(cfg.seconds);
  if (secs > 0) $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(secs, $.NSApp, 'terminate:', null, false);
  $.NSApp.run;
}
